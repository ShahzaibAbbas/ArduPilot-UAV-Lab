import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { managedWslCommand, stopManagedWslSession } from "./wslSession.js";

const execFileAsync = promisify(execFile);
const ownedChildren = new Set();
const pendingStops = new WeakMap();
let closingChildren = false;

export function trackOwnedProcess(child) {
  ownedChildren.add(child);
  let cleanupStarted = false;
  const cleanup = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    // Descendants can hold inherited output pipes open after the group leader
    // exits. Start cleanup on exit so those pipes cannot prevent close forever.
    if (process.platform !== "win32" && Number.isInteger(child.pid)) {
      void stopProcessTree(child).catch(() => undefined).finally(() => ownedChildren.delete(child));
    } else ownedChildren.delete(child);
  };
  if (process.platform !== "win32") child.once("exit", cleanup);
  // Failed spawns do not emit exit, so close must still release their ownership.
  child.once("close", cleanup);
  if (closingChildren) void stopProcessTree(child).catch(() => undefined);
  return child;
}

export function spawnOwnedProcess(command, args, options = {}) {
  if (closingChildren) throw new Error("The lab is shutting down; no new process can start.");
  return trackOwnedProcess(spawn(command, args, { ...options, detached: process.platform !== "win32" }));
}

export function runOwnedFile(command, args, options = {}) {
  if (closingChildren) return Promise.reject(new Error("The lab is shutting down; no new process can start."));
  return new Promise((resolve, reject) => {
    const launch = managedWslCommand(command, args);
    const { timeout = 0, maxBuffer = 1024 * 1024, encoding = "utf8", signal, ...spawnOptions } = options;
    if (typeof maxBuffer !== "number" || maxBuffer < 0 || Number.isNaN(maxBuffer)) throw new RangeError("maxBuffer must be a non-negative number.");
    if (!Number.isFinite(timeout) || timeout < 0) throw new RangeError("timeout must be a non-negative finite number.");
    if (encoding !== null && encoding !== "buffer" && !Buffer.isEncoding(encoding)) throw new TypeError("Unknown output encoding.");
    if (signal?.aborted) return reject(Object.assign(new Error("The command was aborted."), { code: "ABORT_ERR", cause: signal.reason }));
    const child = spawnOwnedProcess(launch.command, launch.args, { ...spawnOptions, stdio: "pipe" });
    child.uavLabGuestSession = launch.guestSession;
    const output = { stdout: [], stderr: [] };
    const lengths = { stdout: 0, stderr: 0 };
    let failure;
    let stopping;
    let timer;
    const collectedOutput = () => Object.fromEntries(["stdout", "stderr"].map((stream) => {
      const buffer = Buffer.concat(output[stream], lengths[stream]);
      return [stream, encoding === null || encoding === "buffer" ? buffer : buffer.toString(encoding)];
    }));
    const stop = (error) => {
      if (failure) return;
      failure = error;
      // execFile's output-limit kill stops only the parent on Windows. Keep
      // the parent alive until the owned process tree has been terminated.
      stopping = stopProcessTree(child).catch((stopError) => {
        failure = stopError;
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        reject(Object.assign(stopError, collectedOutput()));
      });
    };
    for (const stream of ["stdout", "stderr"]) {
      child[stream].on("data", (chunk) => {
        const remaining = Math.max(0, maxBuffer - lengths[stream]);
        const kept = chunk.subarray(0, remaining);
        if (kept.length) output[stream].push(kept);
        lengths[stream] += kept.length;
        if (chunk.length > remaining) stop(Object.assign(new Error(`${stream} exceeded the command output limit and was stopped.`), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true }));
      });
    }
    const aborted = () => stop(Object.assign(new Error("The command was aborted."), { code: "ABORT_ERR", cause: signal.reason, killed: true }));
    signal?.addEventListener("abort", aborted, { once: true });
    if (timeout > 0) timer = setTimeout(() => stop(Object.assign(new Error("The command exceeded its timeout and was stopped."), { code: "ETIMEDOUT", killed: true })), timeout);
    child.once("error", (error) => { failure ??= error; });
    child.once("close", async (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      try { await (stopping ?? pendingStops.get(child)); }
      catch (error) { failure ??= error; }
      const result = collectedOutput();
      if (!failure && (code !== 0 || exitSignal)) failure = Object.assign(new Error(`Command failed: ${command}${exitSignal ? ` (${exitSignal})` : ` (exit ${code})`}`), { code, signal: exitSignal, killed: child.killed });
      if (failure) reject(Object.assign(failure, result));
      else resolve(result);
    });
  });
}

export async function closeOwnedProcesses() {
  closingChildren = true;
  const results = await Promise.allSettled([...ownedChildren].map((child) => stopProcessTree(child)));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) throw new Error(`${failed.length} lab-owned process tree(s) could not stop. Check server logs.`);
}

export function waitForExit(child, timeoutMs = 8000) {
  if (!Number.isInteger(child.pid) || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const exited = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.off("exit", exited); resolve(false); }, timeoutMs);
    child.once("exit", exited);
  });
}

async function stopUnixProcessGroup(pid) {
  const alive = () => {
    try { process.kill(-pid, 0); return true; }
    catch (error) { if (error.code === "ESRCH") return false; throw error; }
  };
  if (!alive()) return;
  process.kill(-pid, "SIGTERM");
  const deadline = Date.now() + 3000;
  while (alive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  if (alive()) process.kill(-pid, "SIGKILL");
}

export function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve(child);
    };
    const onError = (error) => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

// Only call for children created and tracked by this API. On Unix those children
// are started in their own process group so MAVProxy/SITL descendants stop too.
export function stopProcessTree(child) {
  const pending = pendingStops.get(child);
  if (pending) return pending;
  const stopping = stopProcessTreeNow(child).finally(() => pendingStops.delete(child));
  pendingStops.set(child, stopping);
  return stopping;
}

async function stopProcessTreeNow(child) {
  if (!Number.isInteger(child.pid) || child.pid <= 0) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    if (process.platform !== "win32") await stopUnixProcessGroup(child.pid);
    return;
  }
  try {
    if (child.uavLabGuestSession) {
      // The WSL supervisor exits only after guest cleanup; killing wsl.exe alone is insufficient.
      await stopManagedWslSession(child, execFileAsync);
      if (!(await waitForExit(child))) throw new Error("The WSL supervisor did not exit");
      return;
    }
    if (process.platform === "win32") {
      await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 64 * 1024
      });
    } else {
      await stopUnixProcessGroup(child.pid);
    }
    if (!(await waitForExit(child))) throw new Error("Process did not acknowledge termination");
  } catch (error) {
    if (child.exitCode !== null || child.signalCode !== null || error.code === "ESRCH") return;
    throw Object.assign(new Error("A lab-owned process could not be stopped. Retry Stop and check the server logs."), { statusCode: 409, cause: error });
  }
}
