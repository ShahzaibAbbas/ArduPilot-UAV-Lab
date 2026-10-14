import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import dgram from "node:dgram";
import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// This intentionally lives outside npm test: it starts an installed ArduPilot simulator.
if (!process.argv.includes("--run")) {
  console.log("Usage: node scripts/sitl-integration.mjs --run\nOptional: UAV_LAB_SIM_VEHICLE_PATH, UAV_LAB_SITL_REBUILD=1, and UAV_LAB_SITL_TIMEOUT_MS (10000–600000).\nUses an existing SITL binary by default. Starts a private API and a disarmed simulator; sends only a version request and a mission download.");
  process.exit(0);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const startupTimeout = Number(process.env.UAV_LAB_SITL_TIMEOUT_MS || 180000);
assert.ok(Number.isInteger(startupTimeout) && startupTimeout >= 10000 && startupTimeout <= 600000,
  "UAV_LAB_SITL_TIMEOUT_MS must be an integer between 10000 and 600000.");
const designName = `sitl-integration-${randomUUID()}`;
const paramPath = path.join(projectRoot, "data", "exports", `${designName}.param`);
const report = { startedAt: new Date().toISOString(), passed: false, checks: [] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let apiChild;
let apiOutput = "";
let apiUrl;
let sitl;
let managedPid;
let launchAttempted = false;
let failure;

function record(check, details = {}) {
  report.checks.push({ check, ...details });
  console.log(`PASS ${check}`);
}

async function request(route, { method = "GET", body, timeout = 10000 } = {}) {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { throw new Error(`${method} ${route} returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(`${method} ${route}: ${result.error || `HTTP ${response.status}`}`);
  return result;
}

async function until(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastProgress = Date.now();
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    if (Date.now() - lastProgress >= 15000) {
      console.log(`Waiting: ${message}`);
      lastProgress = Date.now();
    }
    await delay(250);
  }
  throw new Error(message);
}

async function freeTcpPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function freeUdpPort() {
  const socket = dgram.createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function tcpOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

const simulatorPattern = /(?:^|[\s/\\])(?:sim_vehicle\.py|arducopter|arduplane|ardurover|ardusub|mavproxy(?:\.py)?)(?:\.exe)?(?:\s|$)/i;

async function nativeSimulatorProcesses() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"],
    { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
    const data = JSON.parse(stdout || "[]");
    return (Array.isArray(data) ? data : [data]).filter((entry) =>
      simulatorPattern.test(`${entry.Name} ${entry.CommandLine || ""}`)).map((entry) => entry.ProcessId);
  }
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,comm=,args="], { timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter((line) => simulatorPattern.test(line)).map((line) => Number(line.trim().split(/\s+/)[0]));
}

async function guestSimulatorProcesses(runtime) {
  let command;
  let args;
  if (runtime.source === "wsl") {
    command = "wsl.exe";
    args = ["-d", runtime.distro, "--exec", "bash", "-lc", "ps -eo pid=,comm=,args="];
  } else if (runtime.source === "cygwin") {
    command = runtime.command;
    args = ["-lc", "ps -eo pid=,comm=,args="];
  } else return [];
  const { stdout } = await execFileAsync(command, args, { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter((line) => simulatorPattern.test(line)).map((line) => Number(line.trim().split(/\s+/)[0]));
}

async function assertSimulatorIdle() {
  const [native, guest, tcp] = await Promise.all([
    nativeSimulatorProcesses(), guestSimulatorProcesses(sitl), tcpOpen(5760)
  ]);
  assert.deepEqual(native, [], "An existing native SITL/MAVProxy process is running. Stop it before running this isolated test.");
  assert.deepEqual(guest, [], "An existing SITL/MAVProxy process is running in the selected guest runtime. Stop it before running this isolated test.");
  assert.equal(tcp, false, "SITL TCP port 5760 is already occupied. Stop the existing simulator before this test.");
}

async function ensureManagedSimulation() {
  const state = await request("/api/sitl/processes");
  assert.deepEqual(state.processes, [managedPid], "The isolated simulator exited before integration completed.");
  return state;
}

async function stopOwnedSimulation() {
  if (!launchAttempted) return;
  const state = await request("/api/sitl/processes");
  // A launch request can time out after the private API has spawned its child.
  if (!managedPid && state.processes.length === 1) {
    [managedPid] = state.processes;
  }
  if (!managedPid && state.processes.length === 0) {
    launchAttempted = false;
    return;
  }
  if (state.processes.includes(managedPid)) {
    await request(`/api/sitl/processes/${managedPid}`, { method: "DELETE", timeout: 25000 });
  }
  await until(async () => (await request("/api/sitl/processes")).processes.length === 0,
    "Managed SITL process did not stop.", 25000);
  await until(async () => {
    const [native, guest, tcp] = await Promise.all([
      nativeSimulatorProcesses(), guestSimulatorProcesses(sitl), tcpOpen(5760)
    ]);
    return native.length === 0 && guest.length === 0 && !tcp;
  }, "SITL or MAVProxy remained alive after Stop.", 30000);
  launchAttempted = false;
  record("Stop removes the managed simulator and its runtime descendants");
}

async function stopApi() {
  if (!apiChild || apiChild.exitCode !== null || apiChild.signalCode !== null) return;
  const exited = once(apiChild, "exit");
  apiChild.kill();
  await Promise.race([exited, delay(5000)]);
  if (apiChild.exitCode === null && apiChild.signalCode === null) {
    apiChild.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
  }
}

try {
  const apiPort = await freeTcpPort();
  const udpPort = await freeUdpPort();
  apiUrl = `http://127.0.0.1:${apiPort}`;
  apiChild = spawn(process.execPath, [path.join(projectRoot, "server", "index.js")], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(apiPort), CLIENT_PORT: String(apiPort === 5173 ? 5174 : 5173), ARDUPILOT_LAUNCHER_PID: String(process.pid) },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  apiChild.stdout.on("data", (chunk) => { apiOutput = (apiOutput + chunk.toString()).slice(-8000); });
  apiChild.stderr.on("data", (chunk) => { apiOutput = (apiOutput + chunk.toString()).slice(-8000); });
  apiChild.on("error", (error) => { apiOutput = (apiOutput + error.message).slice(-8000); });
  await until(async () => {
    if (apiChild.exitCode !== null) throw new Error(`Private API exited: ${apiOutput}`);
    try { return (await request("/api/health", { timeout: 500 })).ok !== false; } catch { return false; }
  }, "Private API did not become ready.", 15000);
  record("Private API starts on an available TCP port", { apiPort, udpPort });

  const system = await request("/api/sitl/locate", {
    method: "POST", body: { simVehiclePath: process.env.UAV_LAB_SIM_VEHICLE_PATH }, timeout: 90000
  });
  sitl = system.sitl;
  assert.equal(sitl?.available, true, "No installed SITL was detected. Set UAV_LAB_SIM_VEHICLE_PATH to sim_vehicle.py or its checkout.");
  await assertSimulatorIdle();
  record("SITL detection and existing-process preflight", { source: sitl.source });

  const design = {
    name: designName,
    nodes: [], edges: [],
    settings: {
      vehicle: "ArduCopter", frame: "quad-x", physicsBackend: "sitl", speedup: 1,
      simVehiclePath: sitl.configPath || process.env.UAV_LAB_SIM_VEHICLE_PATH,
      sitlHeadless: true, sitlRebuild: process.env.UAV_LAB_SITL_REBUILD === "1",
      labTelemetryPort: udpPort, gcsTargets: [], swarmCount: 1
    }
  };
  launchAttempted = true;
  const launched = await request("/api/sitl/launch", { method: "POST", body: design, timeout: 120000 });
  managedPid = launched.pid;
  assert.ok(Number.isInteger(managedPid) && managedPid > 0);
  assert.equal(launched.plan.available, true);
  assert.equal(launched.plan.headless, true);
  assert.equal(launched.plan.telemetry.port, udpPort);
  assert.deepEqual(launched.plan.outputs.map(({ host, port }) => ({ host, port })), [launched.plan.telemetry],
    "The smoke simulator must send UDP only to its private lab listener.");
  assert.ok(launched.plan.args.includes("--no-extra-ports"), "MAVProxy default external outputs must be disabled.");
  assert.equal(launched.plan.args.includes("--no-rebuild"), !design.settings.sitlRebuild);
  record("Real SITL launches through the application API");

  const vehicle = await until(async () => {
    await ensureManagedSimulation();
    const telemetry = await request("/api/telemetry");
    assert.equal(telemetry.listener.active, true, "SITL launch did not start the telemetry listener.");
    assert.equal(telemetry.listener.port, udpPort);
    const autopilots = telemetry.vehicles.filter((entry) => entry.heartbeat?.autopilot === 3);
    assert.ok(autopilots.length <= 1, "Unexpected second autopilot on the isolated telemetry port; no commands will be sent.");
    return autopilots[0];
  }, "No ArduPilot heartbeat arrived from the launched simulator.", startupTimeout);
  assert.equal(vehicle.heartbeat.armed, false, "The integration simulator must remain disarmed.");
  const target = { sysid: vehicle.sysid, compid: vehicle.compid };
  record("Real UDP heartbeat reaches the automatically connected lab listener", target);

  await ensureManagedSimulation();
  const commandStarted = Date.now();
  await request("/api/telemetry/command", {
    method: "POST", body: { ...target, action: "custom", commandId: 512, params: [148] }
  });
  await until(async () => {
    await ensureManagedSimulation();
    const telemetry = await request("/api/telemetry");
    const current = telemetry.vehicles.find((entry) => entry.sysid === target.sysid && entry.compid === target.compid);
    assert.equal(current?.heartbeat?.armed, false);
    const ack = current.commandAck;
    if (!ack || ack.command !== 512 || Date.parse(ack.receivedAt) < commandStarted) return false;
    assert.equal(ack.result, 0, `Version request was rejected: ${ack.resultName}`);
    return true;
  }, "The simulator did not acknowledge the read-only AUTOPILOT_VERSION request.", 20000);
  record("Read-only MAVLink version command receives a successful ACK");

  await request("/api/mission/download", { method: "POST", body: target });
  const mission = await until(async () => {
    await ensureManagedSimulation();
    const { mission: state } = await request("/api/mission/status");
    if (state.active) return false;
    assert.equal(typeof state.missionText, "string", `Mission download failed: ${state.message}`);
    assert.match(state.missionText, /^QGC WPL 110/);
    assert.equal(state.downloadedCount, state.expectedCount);
    return state;
  }, "Read-only mission download did not complete.", 20000);
  record("Real mission download completes", { items: mission.downloadedCount });

  const trace = await request(`/api/telemetry/trace?systemId=${target.sysid}&messageId=77&limit=20`);
  assert.ok(trace.events.some((entry) => entry.direction === "rx" && entry.checksumStatus === "valid"), "No valid command ACK in the packet trace.");
  const jsonTrace = await request(`/api/telemetry/trace/export?format=json&systemId=${target.sysid}`);
  assert.ok(Array.isArray(jsonTrace.events) && jsonTrace.events.length > 0);
  const csvResponse = await fetch(`${apiUrl}/api/telemetry/trace/export?format=csv&systemId=${target.sysid}`, { signal: AbortSignal.timeout(5000) });
  assert.equal(csvResponse.ok, true);
  assert.match(await csvResponse.text(), /"messageId"/);
  record("Real packet filtering and JSON/CSV exports contain telemetry");

  await stopOwnedSimulation();
  const runtime = await request("/api/runtime");
  assert.equal(runtime.sitl.running, false);
  assert.deepEqual(runtime.sitl.processes, []);
  await request("/api/telemetry/listener", { method: "DELETE" });
  assert.equal((await request("/api/telemetry")).listener.active, false);
  record("Runtime and UDP listener report stopped state");
} catch (error) {
  failure = error;
  report.error = error.message;
  if (apiUrl) {
    try {
      const logs = await request("/api/logs?source=sitl&limit=30", { timeout: 2000 });
      report.sitlLogs = (logs.logs || []).filter((entry) => entry.source === "sitl").slice(-30)
        .map(({ level, message }) => ({ level, message: message.slice(-2000) }));
    } catch { /* The API may have failed before it was ready. */ }
  }
} finally {
  try { await stopOwnedSimulation(); } catch (error) {
    report.cleanupError = error.message;
    failure ||= error;
  }
  await stopApi();
  // Only the UUID-named parameter export created by this invocation is removed.
  await rm(paramPath, { force: true });
  report.finishedAt = new Date().toISOString();
  report.passed = !failure;
  await mkdir(path.join(projectRoot, "test-results"), { recursive: true });
  await writeFile(path.join(projectRoot, "test-results", "sitl-integration.json"), `${JSON.stringify(report, null, 2)}\n`);
}

if (failure) {
  console.error(`SITL integration failed: ${failure.message}`);
  if (report.cleanupError) console.error(`Cleanup: ${report.cleanupError}`);
  console.error("See test-results/sitl-integration.json for bounded simulator diagnostics.");
  process.exitCode = 1;
} else console.log("SITL integration passed: launch, telemetry, command ACK, mission download, trace export, and shutdown.");
