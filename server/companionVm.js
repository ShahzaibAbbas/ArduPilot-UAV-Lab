import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;
const ACTIVE = new Set(["starting", "running", "stopping"]);
const LIMITS = Object.freeze({ memoryMb: { min: 512, max: 8192 }, cpus: { min: 1, max: 4 }, diskGb: { min: 8, max: 128 }, maxMachines: 4 });

export class CompanionVmError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "CompanionVmError";
    this.statusCode = statusCode;
  }
}

function machineId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
    throw new CompanionVmError("Companion VM identifier is invalid.");
  }
  return value;
}

function boundedSetting(value, name, fallback) {
  const result = value ?? fallback;
  const { min, max } = LIMITS[name];
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new CompanionVmError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return result;
}

export function companionVmSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CompanionVmError("VM settings must be an object.");
  const boot = value.boot ?? "disk";
  if (boot !== "installer" && boot !== "disk") throw new CompanionVmError("Choose installer or disk boot.");
  return {
    memoryMb: boundedSetting(value.memoryMb, "memoryMb", 2048),
    cpus: boundedSetting(value.cpus, "cpus", 2),
    diskGb: boundedSetting(value.diskGb, "diskGb", 16),
    boot
  };
}

async function regularFile(file, missingAllowed = false) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new CompanionVmError("VM storage must use regular files, without symbolic links.", 422);
    return info;
  } catch (error) {
    if (missingAllowed && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function availablePort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function publicMachine(machine) {
  const { nodeId, state, diskExists, memoryMb, cpus, diskGb, boot, displayMode, vncPort, pid, error } = machine;
  return { nodeId, state, diskExists, memoryMb, cpus, diskGb, boot, displayMode, vncPort, pid, error };
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

async function stopOwnedQemu(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  // QEMU's monitor quit flushes its managed disk. No guest shell command is used.
  const exited = waitForExit(child, 3000);
  if (child.stdin?.writable) child.stdin.write("quit\n");
  if (await exited) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 2000)) return;
  // A wedged QEMU must not survive application shutdown. SIGKILL is scoped to
  // the exact child spawned by this store after the graceful monitor and TERM
  // paths fail; it never targets an uploaded image or an unrelated VM.
  child.kill("SIGKILL");
  if (!(await waitForExit(child, 2000))) throw new CompanionVmError("The companion VM could not be stopped after its monitor and force-stop paths. Check the VM process and retry.", 409);
}

export function companionVmArgs({ memoryMb, cpus, boot, displayMode = "vnc", vncPort }, diskPath, isoPath) {
  const args = [
    "-no-user-config", "-nodefaults", "-machine", "pc,accel=tcg", "-m", String(memoryMb), "-smp", String(cpus),
    "-device", "VGA", "-display", displayMode === "window" ? "default" : "none", "-vnc", `127.0.0.1:${vncPort - 5900}`,
    "-monitor", "stdio", "-serial", "none", "-no-reboot",
    "-netdev", "user,id=net0", "-device", "virtio-net-pci,netdev=net0",
    "-blockdev", JSON.stringify({ driver: "qcow2", "node-name": "disk0", file: { driver: "file", filename: diskPath } }),
    "-device", "virtio-blk-pci,drive=disk0", "-boot", boot === "installer" ? "order=d" : "order=c"
  ];
  if (boot === "installer") {
    args.push("-blockdev", JSON.stringify({ driver: "raw", "node-name": "installer", "read-only": true, file: { driver: "file", filename: isoPath } }),
      "-device", "ide-cd,drive=installer");
  }
  return args;
}

/** Owns only QEMU children launched by this instance; uploaded firmware is never referenced. */
export class CompanionVmStore {
  constructor({ root, execute = execFileAsync, spawnProcess = spawn, stopChild = stopOwnedQemu, portAvailable = availablePort,
    qemu = process.env.QEMU_SYSTEM_X86_64 || "qemu-system-x86_64", qemuImg = process.env.QEMU_IMG || "qemu-img" } = {}) {
    if (!root) throw new Error("Companion VM storage root is required.");
    this.root = path.resolve(root);
    this.execute = execute;
    this.spawnProcess = spawnProcess;
    this.stopChild = stopChild;
    this.portAvailable = portAvailable;
    this.qemu = qemu;
    this.qemuImg = qemuImg;
    this.machines = new Map();
    this.closed = false;
  }

  paths(id) {
    const directory = path.join(this.root, createHash("sha256").update(machineId(id)).digest("hex"));
    return { directory, disk: path.join(directory, "disk.qcow2"), metadata: path.join(directory, "machine.json") };
  }

  async ensureDirectory(directory = this.root) {
    await mkdir(this.root, { recursive: true });
    if (!(await lstat(this.root)).isDirectory() || (await lstat(this.root)).isSymbolicLink()) {
      throw new CompanionVmError("Companion VM storage must be a local directory without symbolic links.", 422);
    }
    if (directory !== this.root) await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new CompanionVmError("VM storage directory is invalid.", 422);
  }

  async runtime() {
    if (this.runtimeCache && Date.now() - this.runtimeCache.checkedAt < 5000) return this.runtimeCache.value;
    if (this.runtimePending) return this.runtimePending;
    this.runtimePending = this.detectRuntime();
    try {
      const value = await this.runtimePending;
      this.runtimeCache = { value, checkedAt: Date.now() };
      return value;
    } finally { this.runtimePending = undefined; }
  }

  async detectRuntime() {
    const results = await Promise.allSettled([this.qemu, this.qemuImg].map((command) =>
      this.execute(command, ["--version"], { windowsHide: true, shell: false, timeout: 5000, maxBuffer: 64 * 1024 })));
    const qemuAvailable = results[0].status === "fulfilled";
    const qemuImgAvailable = results[1].status === "fulfilled";
    return { available: qemuAvailable && qemuImgAvailable, qemuAvailable, qemuImgAvailable,
      message: qemuAvailable && qemuImgAvailable
        ? "QEMU is available. Use an x86-64 Linux installer ISO, then use the local VNC display or request a native QEMU window from the companion controls."
        : "Install QEMU with qemu-system-x86_64 and qemu-img, add both to PATH (or set QEMU_SYSTEM_X86_64 and QEMU_IMG), then restart the lab." };
  }

  async readStored(id) {
    const paths = this.paths(id);
    try {
      const directory = await lstat(paths.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new CompanionVmError("VM storage directory is invalid.", 422);
      const info = await regularFile(paths.metadata);
      if (info.size > 4096) throw new CompanionVmError("Saved VM settings are too large.", 422);
      const saved = JSON.parse(await readFile(paths.metadata, "utf8"));
      if (saved.nodeId !== id) throw new CompanionVmError("Saved VM identifier does not match.", 422);
      return { nodeId: id, ...companionVmSettings(saved), state: "stopped", diskExists: Boolean(await regularFile(paths.disk, true)) };
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      if (error instanceof CompanionVmError) throw error;
      throw new CompanionVmError("Saved VM settings could not be read. Check the managed VM storage.", 422);
    }
  }

  async status() {
    await this.ensureDirectory();
    const stored = new Map();
    const directories = (await readdir(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)).slice(0, 100);
    for (const entry of directories) {
      try {
        const metadata = path.join(this.root, entry.name, "machine.json");
        const info = await regularFile(metadata);
        if (info.size > 4096) continue;
        const saved = JSON.parse(await readFile(metadata, "utf8"));
        if (path.basename(this.paths(saved.nodeId).directory) !== entry.name) continue;
        const machine = await this.readStored(saved.nodeId);
        if (machine) stored.set(machine.nodeId, publicMachine(machine));
      } catch { /* Ignore incomplete records and keep all returned paths private. */ }
    }
    for (const [id, machine] of this.machines) stored.set(id, publicMachine(machine));
    return { runtime: await this.runtime(), machines: [...stored.values()], limits: structuredClone(LIMITS) };
  }

  checkStarting(machine) {
    if (this.closed || machine.state !== "starting") throw new CompanionVmError("Companion VM start was cancelled.", 409);
  }

  async prepareDisk(machine, paths) {
    await this.ensureDirectory(paths.directory);
    const disk = await regularFile(paths.disk, true);
    if (!disk) {
      if (machine.boot !== "installer") throw new CompanionVmError("Install Linux from an ISO before starting this VM from disk.", 409);
      const temporary = path.join(paths.directory, `disk-${randomUUID()}.qcow2`);
      try {
        await this.execute(this.qemuImg, ["create", "-f", "qcow2", temporary, `${machine.diskGb}G`], {
          windowsHide: true, shell: false, timeout: 20000, maxBuffer: 64 * 1024, signal: machine.controller.signal
        });
        this.checkStarting(machine);
        await regularFile(temporary);
        await rename(temporary, paths.disk);
      } finally { await rm(temporary, { force: true }); }
    }
    // Reject backing files and unexpected formats even if a managed disk was replaced locally.
    const result = await this.execute(this.qemuImg, ["info", "--output=json", paths.disk], {
      windowsHide: true, shell: false, timeout: 10000, maxBuffer: 64 * 1024, signal: machine.controller.signal
    });
    let info;
    try { info = JSON.parse(result.stdout); } catch { throw new CompanionVmError("QEMU could not inspect the managed disk.", 422); }
    if (info.format !== "qcow2" || info["backing-filename"] || info["full-backing-filename"] ||
      !Number.isSafeInteger(info["virtual-size"]) || info["virtual-size"] !== machine.diskGb * GIB) {
      throw new CompanionVmError("The managed disk format or size does not match. Keep the original disk size; external backing files are not supported.", 422);
    }
    machine.diskExists = true;
    const saved = { nodeId: machine.nodeId, memoryMb: machine.memoryMb, cpus: machine.cpus, diskGb: machine.diskGb, boot: machine.boot };
    const temporary = path.join(paths.directory, `settings-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(saved), { flag: "wx" });
      await rename(temporary, paths.metadata);
    } finally { await rm(temporary, { force: true }); }
  }

  async start(id, value = {}) {
    const safeId = machineId(id);
    const settings = companionVmSettings(value);
    const displayMode = value.displayMode ?? "vnc";
    if (displayMode !== "vnc" && displayMode !== "window") throw new CompanionVmError("Choose the VNC display or a native QEMU window.");
    if (this.closed) throw new CompanionVmError("The lab is shutting down. Restart it before launching a VM.", 409);
    if (ACTIVE.has(this.machines.get(safeId)?.state)) throw new CompanionVmError("This companion VM is already active.", 409);
    if ([...this.machines.values()].filter((machine) => ACTIVE.has(machine.state)).length >= LIMITS.maxMachines) {
      throw new CompanionVmError("Stop a companion VM before starting another; at most four can run.", 409);
    }
    // Reserve synchronously before any runtime or storage await to prevent duplicate starts.
    const machine = { nodeId: safeId, ...settings, displayMode, state: "starting", diskExists: false, controller: new AbortController() };
    this.machines.set(safeId, machine);
    // Retain a bounded set of inactive runtime records. Persisted disks remain untouched.
    for (const [oldId, oldMachine] of this.machines) {
      if (this.machines.size <= 100) break;
      if (!ACTIVE.has(oldMachine.state)) this.machines.delete(oldId);
    }
    try {
      const runtime = await this.runtime();
      if (!runtime.available) throw new CompanionVmError(runtime.message, 503);
      this.checkStarting(machine);
      let isoPath;
      if (settings.boot === "installer") {
        if (typeof value.isoPath !== "string" || value.isoPath.length > 4096 || !path.isAbsolute(value.isoPath) ||
          /[\x00-\x1f]/.test(value.isoPath) || path.extname(value.isoPath).toLowerCase() !== ".iso") {
          throw new CompanionVmError("Choose an absolute path to a local x86-64 Linux .iso file.");
        }
        isoPath = path.resolve(value.isoPath);
        try {
          const info = await regularFile(isoPath);
          if (!info.size) throw new Error("empty");
        } catch { throw new CompanionVmError("The Linux ISO could not be read. Choose an existing, non-empty regular .iso file."); }
      }
      const paths = this.paths(safeId);
      const saved = await this.readStored(safeId);
      if (saved?.diskExists && saved.diskGb !== machine.diskGb) {
        throw new CompanionVmError(`This VM has a ${saved.diskGb} GiB disk. Keep that disk size when starting it.`, 409);
      }
      await this.prepareDisk(machine, paths);
      this.checkStarting(machine);
      for (let port = 5901; port <= 5904; port += 1) {
        if ([...this.machines.values()].some((other) => ACTIVE.has(other.state) && other.vncPort === port)) continue;
        // Reserve before awaiting the port probe, then check cancellation before spawn.
        machine.vncPort = port;
        if (await this.portAvailable(port)) break;
        machine.vncPort = undefined;
      }
      if (!machine.vncPort) throw new CompanionVmError("Local VNC ports 5901–5904 are busy. Close another VNC server or VM and retry.", 409);
      this.checkStarting(machine);
      const child = this.spawnProcess(this.qemu, companionVmArgs(machine, paths.disk, isoPath), {
        cwd: paths.directory, windowsHide: true, shell: false, stdio: ["pipe", "ignore", "pipe"]
      });
      machine.child = child;
      child.stdin?.on("error", () => undefined);
      child.stderr?.on("data", () => undefined); // Drain bounded streams without retaining paths or guest output.
      child.once("exit", (code) => {
        machine.state = machine.state === "stopping" || code === 0 ? "stopped" : "failed";
        if (machine.state === "failed") machine.error = "QEMU exited unexpectedly. Check the ISO architecture, disk, and available host memory, then retry.";
        machine.pid = undefined;
        machine.child = undefined;
      });
      child.on("error", () => {
        machine.state = "failed";
        machine.error = "QEMU could not run. Verify its installation and available host resources.";
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      if (machine.state === "starting" && !this.closed) {
        machine.state = "running";
        machine.pid = child.pid;
      } else if (machine.child) await this.stop(safeId);
      return publicMachine(machine);
    } catch (error) {
      if (machine.state === "stopped" || machine.state === "stopping" || this.closed) return publicMachine(machine);
      machine.state = "failed";
      machine.error = error instanceof CompanionVmError ? error.message : "The companion VM could not start. Check QEMU, the Linux ISO, disk permissions, and free disk space.";
      throw error instanceof CompanionVmError ? error : new CompanionVmError(machine.error, 500);
    }
  }

  async stop(id) {
    const safeId = machineId(id);
    const machine = this.machines.get(safeId) ?? await this.readStored(safeId);
    if (!machine) throw new CompanionVmError("Companion VM was not found.", 404);
    if (!ACTIVE.has(machine.state) && !machine.child) return publicMachine(machine);
    machine.state = "stopping";
    machine.controller?.abort();
    try {
      if (machine.child) await this.stopChild(machine.child);
      machine.state = "stopped";
      machine.pid = undefined;
      machine.child = undefined;
      return publicMachine(machine);
    } catch {
      machine.error = "The companion VM could not be stopped. Retry Stop before closing the lab.";
      throw new CompanionVmError(machine.error, 409);
    }
  }

  async close() {
    this.closed = true;
    const results = await Promise.allSettled([...this.machines.keys()].map((id) => this.stop(id)));
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length) throw new CompanionVmError(`${failures.length} companion VM(s) could not be stopped. Check the VM process before closing the lab.`, 409);
  }
}
