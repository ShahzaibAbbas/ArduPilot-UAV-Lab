import cors from "cors";
import express from "express";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  generateGazeboWorldArtifact,
  generateJsonBridgeArtifact,
  generateMissionArtifact,
  generatePrearmArtifact,
  generateBomCsvArtifact,
  generateBomHtmlArtifact,
  generateSimulatorBundleArtifact
} from "./artifacts.js";
import { deleteCustomComponent, listCustomComponents, saveCustomComponent } from "./customComponents.js";
import { DESIGN_ID_PATTERN, listDesigns, loadDesign, saveDesign } from "./designStore.js";
import { compileGazeboPlugins, gazeboStatus } from "./gazebo.js";
import { FirmwareError, FirmwareStore } from "./firmware.js";
import { CompanionVmStore } from "./companionVm.js";
import { clearLogs, listLogs, loggerError, loggerInfo, loggerWarn, readLogFileTail } from "./logger.js";
import { isAllowedLocalOrigin } from "./localOrigin.js";
import { prepareLocalFolders, setupDiagnostics } from "./setup.js";
import { closeOwnedProcesses, runOwnedFile as execFileAsync, spawnOwnedProcess as spawn, stopProcessTree, waitForSpawn } from "./processLifecycle.js";
import { managedWslLaunch, sitlProcessEnvironment } from "./wslSession.js";
import { runtimePorts, serverListenError } from "./runtimeConfig.js";
import { buildSitlPlan, generateParamContent, generateParamExplanation, getSystemStatus } from "./sitl.js";
import { runTerminalCommand } from "./terminal.js";
import { writeSitlConsoleInput } from "./sitlConsole.js";
import { sitlTelemetryWarning } from "./sitlHealth.js";
import {
  clearTelemetryTrace,
  configureGcsBridge,
  downloadMission,
  exportTelemetryTrace,
  missionSyncStatus,
  pauseTelemetryTrace,
  resumeTelemetryTrace,
  sendMavlinkCommand,
  shutdownTelemetry,
  startTelemetryListener,
  stopTelemetryListener,
  detachGcsBridgeUpstream,
  telemetryTrace,
  telemetryTraceStats,
  telemetryStatus,
  uploadMission
} from "./telemetry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const app = express();
const { apiPort: port } = runtimePorts();
const firmwareUploadLimitBytes = z.coerce.number().int().min(1024).max(64 * 1024 * 1024)
  .catch(16 * 1024 * 1024).parse(process.env.FIRMWARE_UPLOAD_LIMIT_BYTES);
const firmwareStore = new FirmwareStore({
  root: path.join(projectRoot, "data", "firmware"),
  maxUploadBytes: firmwareUploadLimitBytes
});
const companionVmStore = new CompanionVmStore({ root: path.join(projectRoot, "data", "companion-vms") });
const activeProcesses = new Map();
const sitlLifecycleEvents = [];
const recentSitlProcesses = new Map();
let lastSitlFailure;
const launcherPid = Number(process.env.ARDUPILOT_LAUNCHER_PID || 0);
let softwareUpdateRunning = false;
let sitlLaunchPending = false;
let shuttingDown = false;
let httpServer;
const MAX_SITL_CONSOLE_LINES = 800;
const MAX_SITL_CONSOLE_LINE_LENGTH = 4096;
const MAX_RECENT_SITL_PROCESSES = 4;
const MAX_RECENT_SITL_LINES = 200;

function lastSitlProcess() {
  const recent = [...recentSitlProcesses.values()].at(-1);
  if (!recent) return undefined;
  return sitlProcessMeta(recent);
}

function sitlProcessMeta(recent) {
  const { lines: _lines, ...meta } = recent;
  return meta;
}

function rememberSitlProcess(meta, lines = []) {
  if (!meta?.pid) return;
  recentSitlProcesses.set(meta.pid, {
    ...meta,
    console: {
      ...(meta.console ?? {}),
      available: false,
      state: meta.console?.state === "failed" ? "failed" : "stopped",
      lineCount: lines.length,
      lastOutputAt: meta.console?.lastOutputAt
    },
    lines: lines.slice(-MAX_RECENT_SITL_LINES)
  });
  while (recentSitlProcesses.size > MAX_RECENT_SITL_PROCESSES) {
    recentSitlProcesses.delete(recentSitlProcesses.keys().next().value);
  }
}

function noteSitlFailure(message, details = {}) {
  lastSitlFailure = {
    at: new Date().toISOString(),
    message,
    ...details
  };
}

function appendSitlConsole(child, stream, chunk) {
  child.uavLabConsole ??= { lines: [], partial: {}, startupTail: "" };
  const prefix = stream === "stderr" ? "[stderr] " : "";
  const text = String(chunk ?? "").replace(/\0/g, "");
  child.uavLabConsole.startupTail = `${child.uavLabConsole.startupTail ?? ""}${text}`.slice(-512);
  if (child.uavLabMeta?.console?.state === "starting" && /SIM_VEHICLE:\s*Run MavProxy\b|\bWaiting for heartbeat\b|\bMAV>\s*$/i.test(child.uavLabConsole.startupTail)) {
    child.uavLabMeta.console = {
      ...child.uavLabMeta.console,
      available: Boolean(child.stdin?.writable && !child.stdin.destroyed),
      state: child.stdin?.writable && !child.stdin.destroyed ? "ready" : "unavailable",
      reason: child.stdin?.writable && !child.stdin.destroyed ? "MAVProxy launch observed; command pipe is writable." : "MAVProxy input pipe closed."
    };
    child.uavLabMeta.mavproxyStartedAt ??= new Date().toISOString();
  }
  const pending = `${child.uavLabConsole.partial?.[stream] ?? ""}${text}`;
  const parts = pending.split(/\r?\n/);
  child.uavLabConsole.partial ??= {};
  child.uavLabConsole.partial[stream] = (parts.pop() ?? "").slice(-MAX_SITL_CONSOLE_LINE_LENGTH);
  for (const line of parts) {
    if (!line.trim()) continue;
    child.uavLabConsole.lines.push({ at: new Date().toISOString(), stream, text: `${prefix}${line}`.slice(0, MAX_SITL_CONSOLE_LINE_LENGTH) });
  }
  if (child.uavLabConsole.lines.length > MAX_SITL_CONSOLE_LINES) {
    child.uavLabConsole.lines.splice(0, child.uavLabConsole.lines.length - MAX_SITL_CONSOLE_LINES);
  }
  if (child.uavLabMeta?.console) {
    child.uavLabMeta.console.lineCount = child.uavLabConsole.lines.length + Object.values(child.uavLabConsole.partial).filter(Boolean).length;
    child.uavLabMeta.console.lastOutputAt = new Date().toISOString();
  }
}

function sitlConsoleLines(child) {
  const lines = [...(child.uavLabConsole?.lines ?? [])];
  for (const [stream, value] of Object.entries(child.uavLabConsole?.partial ?? {})) {
    if (value?.trim()) lines.push({ at: child.uavLabMeta?.console?.lastOutputAt ?? new Date().toISOString(), stream, text: `${stream === "stderr" ? "[stderr] " : ""}${value}` });
  }
  return lines.slice(-MAX_SITL_CONSOLE_LINES);
}

function addSitlLifecycleEvent(state, message, meta = {}) {
  sitlLifecycleEvents.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    origin: "SITL",
    state,
    message,
    ...meta
  });
  sitlLifecycleEvents.splice(0, Math.max(0, sitlLifecycleEvents.length - 200));
}

const designSchema = z.object({
  id: z.string().regex(DESIGN_ID_PATTERN, "Design id must use the canonical UUID format.").optional(),
  name: z.string().trim().min(1).max(240),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  settings: z.record(z.unknown()),
  lab: z.record(z.unknown()).optional()
});

const locateSchema = z.object({
  simVehiclePath: z.string().trim().max(4096).optional()
});

const designListSchema = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const telemetryListenerSchema = z.object({
  port: z.number().int().min(1024).max(65535).optional(),
  host: z.string().trim().max(64).regex(/^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})$/).optional()
});

const mavlinkCommandSchema = z.object({
  sysid: z.number().int().min(1).max(255),
  compid: z.number().int().min(0).max(255).optional(),
  action: z.enum(["arm", "disarm", "takeoff", "land", "rtl", "mode", "custom"]),
  mode: z.string().optional(),
  altitudeM: z.number().min(0).max(10000).optional(),
  commandId: z.number().int().min(0).max(65535).optional(),
  params: z.array(z.number()).max(7).optional()
});

const sitlConsoleInputSchema = z.object({
  input: z.string().max(2048)
});

const missionSyncSchema = z.object({
  sysid: z.number().int().min(1).max(255),
  compid: z.number().int().min(0).max(255).optional(),
  missionText: z.string().optional()
});

const customComponentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  baseType: z.string().min(1),
  summary: z.string().optional(),
  category: z.string().optional(),
  properties: z.record(z.union([z.string(), z.number(), z.boolean()])).default({})
});

const terminalRunSchema = z.object({
  command: z.string().min(1).max(2000)
});

const firmwareUploadSchema = z.object({
  name: z.string().min(1).max(240),
  selectedNodeId: z.string().max(120).optional(),
  selectedBoard: z.string().max(120).optional(),
  selectedComponentType: z.string().max(120).optional(),
  linkedVehicle: z.string().max(60).optional()
});

const firmwareAttachmentSchema = firmwareUploadSchema.omit({ name: true }).extend({
  selectedNodeId: z.string().trim().min(1).max(120),
  selectedComponentType: z.literal("flight-controller")
});

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function runMaintenanceStep(command, args) {
  loggerInfo("maintenance", `Running ${command} ${args.join(" ")}`.trim());
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: projectRoot,
    env: process.env,
    maxBuffer: 1024 * 1024 * 8,
    windowsHide: true,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    timeout: 5 * 60 * 1000
  });

  const result = {
    command: [command, ...args].join(" "),
    output: [stdout, stderr].filter(Boolean).join("\n").trim()
  };
  loggerInfo("maintenance", `Finished ${result.command}`, { outputLength: result.output.length });
  return result;
}

function requireLocalOrigin(request, response, next) {
  if (!isAllowedLocalOrigin(request.get("origin"))) {
    response.status(403).json({ error: "Only local browser origins are allowed." });
    return;
  }

  next();
}

function launcherIsAlive() {
  if (!launcherPid || launcherPid === process.pid) {
    return true;
  }

  try {
    process.kill(launcherPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  loggerInfo("server", `Shutting down ArduPilot UAV Lab API: ${reason}`);
  console.log(`Shutting down ArduPilot UAV Lab API: ${reason}`);
  firmwareStore.close();
  const results = await Promise.allSettled([
    closeOwnedProcesses(),
    shutdownTelemetry(),
    companionVmStore.close()
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    exitCode = 1;
    loggerError("server", "Some owned resources could not be closed", { count: failures.length });
  }

  if (!httpServer) {
    process.exit(exitCode);
  }

  httpServer.close(() => {
    process.exit(exitCode);
  });

  setTimeout(() => process.exit(exitCode), 2500).unref();
}

app.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedLocalOrigin(origin));
    }
  })
);
app.use(requireLocalOrigin);
app.use(express.json({ limit: "10mb" }));
app.use((_request, response, next) => {
  if (shuttingDown) return response.status(503).json({ error: "The lab is shutting down. Restart the launcher to continue." });
  next();
});
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on("finish", () => {
    if (
      request.path === "/api/health" ||
      request.path.startsWith("/api/logs") ||
      (request.method === "GET" && request.path.startsWith("/api/telemetry"))
    ) {
      return;
    }

    const level = response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info";
    addRequestLog(level, request, response, Date.now() - startedAt);
  });
  next();
});

function addRequestLog(level, request, response, durationMs) {
  const log = level === "error" ? loggerError : level === "warn" ? loggerWarn : loggerInfo;
  log("api", `${request.method} ${request.path} ${response.statusCode}`, {
    statusCode: response.statusCode,
    durationMs
  });
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/application/exit", (request, response) => {
  if (request.get("X-UAV-Lab-Action") !== "exit") {
    response.status(400).json({ error: "Use the lab Exit application action to shut down owned processes." });
    return;
  }
  response.once("finish", () => { void shutdown("Exit application requested"); });
  response.json({ status: "shutting-down", message: "Stopping lab-owned processes and closing the local API." });
});

app.get("/api/runtime", (_request, response) => {
  const address = httpServer?.address();
  const actualPort = address && typeof address === "object" ? address.port : port;
  const processes = Array.from(activeProcesses.values()).map((child) => ({ ...child.uavLabMeta }));
  const liveTelemetry = telemetryStatus();
  response.json({
    checkedAt: new Date().toISOString(),
    api: {
      host: "127.0.0.1", port: actualPort, url: `http://127.0.0.1:${actualPort}`,
      protocol: "http", listening: Boolean(httpServer?.listening), pid: process.pid
    },
    telemetry: { ...liveTelemetry.listener, protocol: "udp", gcsBridge: liveTelemetry.gcsBridge },
    gcsBridge: liveTelemetry.gcsBridge,
    sitl: {
      running: processes.some((child) => child.status === "running"),
      processes,
      lastProcess: lastSitlProcess(),
      lastFailure: lastSitlFailure
    }
  });
});

app.get("/api/logs", (request, response) => {
  response.json({ logs: listLogs(Number(request.query.limit) || 200) });
});

app.get("/api/logs/file", async (_request, response, next) => {
  try {
    response.type("text/plain").send(await readLogFileTail());
  } catch (error) {
    next(error);
  }
});

app.delete("/api/logs", async (_request, response, next) => {
  try {
    await clearLogs();
    response.json({ cleared: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/terminal/run", async (request, response, next) => {
  try {
    const { command } = terminalRunSchema.parse(request.body);
    loggerInfo("terminal", `Running command: ${command}`);
    const result = await runTerminalCommand(command, { cwd: projectRoot });
    const log = result.exitCode === 0 ? loggerInfo : loggerWarn;
    log("terminal", `Command finished: ${command}`, {
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      timedOut: result.timedOut
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/software/update", async (_request, response, next) => {
  if (softwareUpdateRunning) {
    response.status(409).json({ error: "A software update is already running." });
    return;
  }

  // Claim the update before any await so two clicks cannot both pass the check.
  softwareUpdateRunning = true;
  try {
    if (!(await exists(path.join(projectRoot, ".git")))) {
      response.status(409).json({
        error: "This folder is not a Git checkout. Clone the project from Git first, then use Update Software."
      });
      return;
    }

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const steps = [];

    steps.push(await runMaintenanceStep("git", ["pull", "--ff-only"]));
    steps.push(await runMaintenanceStep(npmCommand, ["install"]));
    steps.push(await runMaintenanceStep(npmCommand, ["run", "build"]));

    response.json({
      updated: true,
      message: "Software updated from Git and compiled successfully.",
      steps
    });
  } catch (error) {
    next(error);
  } finally {
    softwareUpdateRunning = false;
  }
});

app.get("/api/system", async (_request, response, next) => {
  try {
    response.json(await getSystemStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/setup/diagnostics", async (request, response, next) => {
  try {
    const options = z.object({ simVehiclePath: z.string().trim().max(1024).optional() }).parse(request.query);
    response.json(await setupDiagnostics(projectRoot, options));
  } catch (error) {
    next(error);
  }
});

app.get("/api/companion-vm", async (_request, response, next) => {
  try { response.json(await companionVmStore.status()); } catch (error) { next(error); }
});

app.post("/api/companion-vm/:nodeId/start", async (request, response, next) => {
  try { response.json({ machine: await companionVmStore.start(request.params.nodeId, request.body) }); }
  catch (error) { next(error); }
});

app.post("/api/companion-vm/:nodeId/stop", async (request, response, next) => {
  try { response.json({ machine: await companionVmStore.stop(request.params.nodeId) }); }
  catch (error) { next(error); }
});

app.get("/api/firmware", async (_request, response, next) => {
  try {
    response.json({
      firmware: await firmwareStore.list(),
      uploadLimitBytes: firmwareUploadLimitBytes,
      executionPolicy: "Uploaded firmware is stored for metadata inspection and is never executed by the web server."
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/firmware",
  express.raw({ type: "application/octet-stream", limit: firmwareUploadLimitBytes }),
  async (request, response, next) => {
    try {
      const metadata = firmwareUploadSchema.parse(request.query ?? {});
      const firmware = await firmwareStore.upload({
        originalName: metadata.name,
        bytes: request.body,
        selectedNodeId: metadata.selectedNodeId,
        selectedBoard: metadata.selectedBoard,
        selectedComponentType: metadata.selectedComponentType,
        linkedVehicle: metadata.linkedVehicle
      });
      loggerInfo("firmware", `Firmware metadata stored for ${firmware.originalName}`, {
        firmwareId: firmware.id,
        byteSize: firmware.byteSize,
        sha256: firmware.sha256,
        compatibility: firmware.compatibility.status
      });
      response.status(201).json({ firmware, uploadLimitBytes: firmwareUploadLimitBytes });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/firmware/:id", async (request, response, next) => {
  try {
    response.json({ firmware: await firmwareStore.get(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/firmware/:id", async (request, response, next) => {
  try {
    const deleted = await firmwareStore.delete(request.params.id);
    loggerInfo("firmware", "Firmware record and stored bytes removed", { firmwareId: deleted });
    response.json({ deleted });
  } catch (error) {
    next(error);
  }
});

app.post("/api/firmware/:id/attach", async (request, response, next) => {
  try {
    const metadata = firmwareAttachmentSchema.parse(request.body);
    response.json({ firmware: await firmwareStore.attach(request.params.id, metadata) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/firmware/:id/workflow/start", async (request, response, next) => {
  try {
    const workflow = await firmwareStore.startWorkflow(request.params.id);
    loggerInfo("firmware", "Visual firmware workflow started", { firmwareId: request.params.id });
    response.json({ workflow });
  } catch (error) {
    next(error);
  }
});

app.post("/api/firmware/:id/workflow/stop", async (request, response, next) => {
  try {
    const workflow = await firmwareStore.stopWorkflow(request.params.id);
    loggerInfo("firmware", "Visual firmware workflow stopped", { firmwareId: request.params.id });
    response.json({ workflow });
  } catch (error) {
    next(error);
  }
});

app.post("/api/firmware/:id/workflow/wipe", async (request, response, next) => {
  try {
    const workflow = await firmwareStore.wipeWorkflow(request.params.id);
    loggerInfo("firmware", "Visual firmware workflow state wiped", { firmwareId: request.params.id });
    response.json({ workflow });
  } catch (error) {
    next(error);
  }
});

app.post("/api/firmware/:id/workflow/reset", async (request, response, next) => {
  try {
    const workflow = await firmwareStore.resetWorkflow(request.params.id);
    loggerInfo("firmware", "Visual firmware workflow reset", { firmwareId: request.params.id });
    response.json({ workflow });
  } catch (error) {
    next(error);
  }
});

app.get("/api/firmware/:id/workflow", async (request, response, next) => {
  try {
    await firmwareStore.get(request.params.id);
    response.json({ workflow: firmwareStore.workflow(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/telemetry", (_request, response) => {
  response.json(telemetryStatus());
});

app.get("/api/telemetry/trace", (request, response) => {
  response.json(telemetryTrace(request.query));
});

app.get("/api/telemetry/trace/stats", (_request, response) => {
  response.json(telemetryTraceStats());
});

app.post("/api/telemetry/trace/clear", (_request, response) => {
  response.json(clearTelemetryTrace());
});

app.post("/api/telemetry/trace/pause", (_request, response) => {
  response.json(pauseTelemetryTrace());
});

app.post("/api/telemetry/trace/resume", (_request, response) => {
  response.json(resumeTelemetryTrace());
});

app.get("/api/telemetry/trace/export", (request, response, next) => {
  try {
    const format = request.query.format === "csv" ? "csv" : request.query.format === undefined || request.query.format === "json" ? "json" : undefined;
    if (!format) {
      response.status(400).json({ error: "Trace export format must be json or csv." });
      return;
    }
    const artifact = exportTelemetryTrace(format, request.query);
    response.type(artifact.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename="${artifact.fileName}"`);
    response.send(artifact.content);
  } catch (error) {
    next(error);
  }
});

app.post("/api/telemetry/listener", async (request, response, next) => {
  try {
    const options = telemetryListenerSchema.parse(request.body ?? {});
    let status = await startTelemetryListener(options);
    // Restarting the reader stops the relay. Bring it back for a running SITL that
    // still sends to this port, so Mission Planner can reconnect without a relaunch.
    const running = [...activeProcesses.values()].find((child) => child.uavLabMeta?.status === "running" && child.uavLabMeta.gcsBridge);
    if (running && !status.gcsBridge.active && running.uavLabMeta.telemetry?.port === status.listener.port) {
      status = await configureGcsBridge(running.uavLabMeta.gcsBridge);
    }
    response.json(status);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/telemetry/listener", async (_request, response, next) => {
  try {
    response.json(await stopTelemetryListener());
  } catch (error) {
    next(error);
  }
});

app.post("/api/telemetry/command", async (request, response, next) => {
  try {
    const command = mavlinkCommandSchema.parse(request.body ?? {});
    const result = await sendMavlinkCommand(command);
    loggerInfo("mavlink", result.message, {
      command: result.command,
      target: result.target,
      bytes: result.bytes
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/mission/status", (_request, response) => {
  response.json({ mission: missionSyncStatus() });
});

app.post("/api/mission/upload", async (request, response, next) => {
  try {
    const payload = missionSyncSchema.extend({ missionText: z.string().min(1) }).parse(request.body ?? {});
    const result = await uploadMission(payload);
    loggerInfo("mavlink", result.message, { target: result.target, direction: result.direction });
    response.json({ mission: result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/mission/download", async (request, response, next) => {
  try {
    const payload = missionSyncSchema.parse(request.body ?? {});
    const result = await downloadMission(payload);
    loggerInfo("mavlink", result.message, { target: result.target, direction: result.direction });
    response.json({ mission: result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sitl/locate", async (request, response, next) => {
  try {
    const { simVehiclePath } = locateSchema.parse(request.body);
    response.json(await getSystemStatus(simVehiclePath));
  } catch (error) {
    next(error);
  }
});

app.get("/api/components/custom", async (_request, response, next) => {
  try {
    response.json({ components: await listCustomComponents() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/components/custom", async (request, response, next) => {
  try {
    const component = customComponentSchema.parse(request.body);
    response.json({ component: await saveCustomComponent(component) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/components/custom/:id", async (request, response, next) => {
  try {
    const deleted = await deleteCustomComponent(request.params.id);
    if (!deleted) {
      response.status(404).json({ error: "Custom component not found" });
      return;
    }
    response.json({ deleted: request.params.id });
  } catch (error) {
    next(error);
  }
});

app.get("/api/designs", async (request, response, next) => {
  try {
    const { q: query, limit } = designListSchema.parse(request.query);
    response.json({ designs: await listDesigns({ query, limit }) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/designs/:id", async (request, response, next) => {
  try {
    response.json({ design: await loadDesign(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/designs", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json({ design: await saveDesign(design) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/mission", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json(generateMissionArtifact(design));
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/prearm", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json(generatePrearmArtifact(design));
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/bom/csv", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json(generateBomCsvArtifact(design));
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/bom/html", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json(generateBomHtmlArtifact(design));
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/json-bridge", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json(generateJsonBridgeArtifact(design));
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/gazebo-world", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json(generateGazeboWorldArtifact(design));
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/bundle", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    const bundle = generateSimulatorBundleArtifact(design);
    response.setHeader("Content-Type", bundle.mimeType);
    response.setHeader("Content-Disposition", `attachment; filename="${bundle.fileName}"`);
    response.send(bundle.content);
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/params", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    const fileName = `${design.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "uav-design"}.param`;
    response.json({ fileName, content: generateParamContent(design) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/export/params/explain", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json({ explanations: generateParamExplanation(design) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sitl/plan", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json({ plan: await buildSitlPlan(design, { telemetryListener: telemetryStatus().listener }) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sitl/launch", async (request, response, next) => {
  if (sitlLaunchPending || activeProcesses.size > 0) {
    response.status(409).json({ error: "SITL is already running or starting. Stop the current process before launching another instance on the same ports." });
    return;
  }
  sitlLaunchPending = true;
  let telemetryChangedByLaunch = false;
  let beforeTelemetry;
  try {
    const design = designSchema.parse(request.body);
    beforeTelemetry = telemetryStatus().listener;
    const plan = await buildSitlPlan(design, { telemetryListener: beforeTelemetry });

    if (!plan.available) {
      throw Object.assign(new Error("sim_vehicle.py was not found after searching native paths, Cygwin, and WSL. Locate the file or ArduPilot checkout and try again."), { statusCode: 409 });
    }

    const telemetryHost = beforeTelemetry.active && beforeTelemetry.host === "0.0.0.0"
      ? beforeTelemetry.host
      : plan.telemetry.bindHost || plan.telemetry.host;
    telemetryChangedByLaunch = !beforeTelemetry.active || beforeTelemetry.port !== plan.telemetry.port || beforeTelemetry.host !== telemetryHost;
    await startTelemetryListener({ port: plan.telemetry.port, host: telemetryHost });
    await configureGcsBridge(plan.gcsBridge);
    const launch = managedWslLaunch(plan);
    const environment = sitlProcessEnvironment(plan.headless);
    const child = spawn(launch.command, launch.args, {
      cwd: plan.cwd,
      env: environment,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    child.uavLabGuestSession = launch.guestSession;

    try {
      await waitForSpawn(child);
    } catch (error) {
      addSitlLifecycleEvent("PROCESS_FAILED", "SITL process failed to start", { status: "failed" });
      loggerError("sitl", "SITL process failed to start", { code: error.code });
      throw Object.assign(new Error("SITL could not start. Re-run Auto-detect and check the Python interpreter and ArduPilot installation."), { statusCode: 409 });
    }
    child.uavLabMeta = {
      pid: child.pid,
      startedAt: new Date().toISOString(),
      status: "running",
      vehicle: design.settings.vehicle,
      frame: design.settings.frame,
      source: plan.source,
      distro: plan.distro,
      telemetry: { host: telemetryHost, port: plan.telemetry.port, bindHost: plan.telemetry.bindHost },
      gcsBridge: plan.gcsBridge,
      console: {
        available: false,
        state: child.stdin && child.stdin.writable ? "starting" : "unavailable",
        reason: child.stdin && child.stdin.writable ? "Waiting for MAVProxy launch output." : "The SITL launcher did not expose a writable MAVProxy input pipe.",
        lineCount: 1
      }
    };
    child.uavLabConsole = { lines: [{ at: new Date().toISOString(), stream: "system", text: `SITL process started${plan.headless ? " (headless)" : " with MAVProxy GUI requested"}. Waiting for MAVProxy launch.` }], partial: {}, startupTail: "" };
    activeProcesses.set(child.pid, child);
    lastSitlFailure = undefined;
    addSitlLifecycleEvent("PROCESS_STARTED", `SITL process ${child.pid} started`, child.uavLabMeta);
    loggerInfo("sitl", `Firmware build and SITL process started as PID ${child.pid}`, { command: plan.commandLine, cwd: plan.cwd, source: plan.source });
    child.stdout?.on("data", (chunk) => {
      appendSitlConsole(child, "stdout", chunk);
      loggerInfo("sitl", chunk.toString("utf8").trim(), { pid: child.pid, stream: "stdout" });
    });
    child.stderr?.on("data", (chunk) => {
      appendSitlConsole(child, "stderr", chunk);
      loggerWarn("sitl", chunk.toString("utf8").trim(), { pid: child.pid, stream: "stderr" });
    });
    child.stdin?.on("error", (error) => {
      if (!child.uavLabMeta) return;
      const reason = `MAVProxy command pipe failed (${error.code || "stream error"}). Check the SITL output.`;
      child.uavLabMeta.console = { ...child.uavLabMeta.console, available: false, state: "unavailable", reason, error: reason };
      loggerWarn("sitl", reason, { pid: child.pid, code: error.code });
    });
    // Report a running simulator whose MAVLink never reaches the lab listener.
    const telemetryWatch = setInterval(() => {
      if (child.uavLabMeta?.status !== "running") return;
      const live = telemetryStatus();
      const warning = sitlTelemetryWarning({
        mavproxyStartedAt: child.uavLabMeta.mavproxyStartedAt,
        listener: live.listener,
        // The relay or the reader itself may hold the newest vehicle heartbeat.
        upstreamConnected: live.gcsBridge.upstreamConnected || (live.listener.active && live.vehicles.some((vehicle) => vehicle.heartbeat && Date.now() - Date.parse(vehicle.lastSeenAt) < 15000)),
        plan
      });
      if (warning && warning !== child.uavLabMeta.telemetryWarning) {
        loggerWarn("sitl", warning, { pid: child.pid });
        addSitlLifecycleEvent("TELEMETRY_MISSING", warning, { pid: child.pid, status: child.uavLabMeta.status });
      }
      if (!warning && child.uavLabMeta.telemetryWarning) addSitlLifecycleEvent("TELEMETRY_CONNECTED", `SITL process ${child.pid} telemetry reached the lab`, { pid: child.pid, status: child.uavLabMeta.status });
      child.uavLabMeta.telemetryWarning = warning;
    }, 5000);
    telemetryWatch.unref();
    child.once("close", (code, signal) => {
      clearInterval(telemetryWatch);
      activeProcesses.delete(child.pid);
      // Keep the relay listening so Mission Planner's TCP link survives a relaunch.
      if (activeProcesses.size === 0) void detachGcsBridgeUpstream().catch(() => loggerWarn("sitl", "Could not release the GCS relay simulator link after SITL exited."));
      const stopped = child.uavLabMeta.status === "stopping";
      const endedAt = new Date().toISOString();
      child.uavLabMeta = {
        ...child.uavLabMeta,
        status: stopped ? "stopped" : "exited",
        exitCode: code,
        signal,
        endedAt,
        console: {
          ...child.uavLabMeta.console,
          available: false,
          state: stopped ? "stopped" : code === 0 ? "stopped" : "unavailable",
          reason: stopped ? "SITL was stopped." : `SITL exited${code === null ? "" : ` with code ${code}`}.`
        }
      };
      rememberSitlProcess(child.uavLabMeta, sitlConsoleLines(child));
      if (!stopped && code !== 0) noteSitlFailure(child.uavLabMeta.console.reason, { pid: child.pid, code: code ?? signal });
      addSitlLifecycleEvent(stopped ? "PROCESS_STOPPED" : "PROCESS_EXITED", `SITL process ${child.pid} ${stopped ? "stopped" : "exited"}`, {
        ...child.uavLabMeta,
        status: child.uavLabMeta.status
      });
      loggerInfo("sitl", `SITL process exited`, { pid: child.pid });
    });
    child.on("error", (error) => {
      // A kill/send error does not prove that the process has exited.
      loggerError("sitl", "SITL process reported an error", { pid: child.pid, code: error.code });
      child.uavLabMeta ??= { pid: child.pid, status: "failed" };
      const reason = `SITL process reported ${error.code || "an error"}. Check Logs for details.`;
      child.uavLabMeta.error = reason;
      child.uavLabMeta.console = { ...(child.uavLabMeta.console ?? {}), available: false, state: "unavailable", reason, error: reason, lineCount: child.uavLabConsole?.lines?.length ?? 0 };
      noteSitlFailure(reason, { pid: child.pid, code: error.code });
    });

    response.json({ pid: child.pid, plan });
  } catch (error) {
    if (activeProcesses.size === 0) {
      await detachGcsBridgeUpstream().catch((cleanupError) => loggerWarn("sitl", "Could not release the GCS relay simulator link after launch failure.", { code: cleanupError?.code }));
      if (telemetryChangedByLaunch) {
        if (beforeTelemetry?.active) {
          await startTelemetryListener({ host: beforeTelemetry.host, port: beforeTelemetry.port })
            .catch((cleanupError) => loggerWarn("sitl", "Could not restore the previous telemetry listener after launch failure.", { code: cleanupError?.code }));
        } else await stopTelemetryListener().catch((cleanupError) => loggerWarn("sitl", "Could not close the telemetry listener after launch failure.", { code: cleanupError?.code }));
      }
    }
    noteSitlFailure(error instanceof Error ? error.message : "SITL launch failed", { code: error?.code || error?.statusCode });
    next(error);
  } finally {
    sitlLaunchPending = false;
  }
});

app.get("/api/sitl/processes", (_request, response) => {
  response.json({
    processes: Array.from(activeProcesses.keys()),
    details: Array.from(activeProcesses.values()).map((child) => ({ ...child.uavLabMeta })),
    lastProcess: lastSitlProcess(),
    lastFailure: lastSitlFailure,
    events: [...sitlLifecycleEvents]
  });
});

// The browser console is deliberately a command channel, rather than a shell.
// It is scoped to a managed SITL child and bounded so a noisy MAVProxy session
// cannot grow server memory without limit.
app.get("/api/sitl/processes/:pid/console", (request, response) => {
  const pid = Number(request.params.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    response.status(400).json({ error: "SITL process id must be a positive integer." });
    return;
  }
  const child = activeProcesses.get(pid);
  const recent = recentSitlProcesses.get(pid);
  if (!child && !recent) {
    response.status(404).json({ error: "Process not found" });
    return;
  }
  const processMeta = child?.uavLabMeta ?? recent;
  const available = Boolean(child && child.exitCode === null && child.signalCode === null && child.uavLabMeta?.console?.available);
  response.json({ pid, available, state: processMeta?.console?.state ?? (available ? "ready" : "stopped"), reason: processMeta?.console?.reason, error: processMeta?.console?.error || processMeta?.error, processStatus: child?.uavLabMeta ?? sitlProcessMeta(recent), lines: child ? sitlConsoleLines(child) : [...(recent?.lines ?? [])] });
});

app.post("/api/sitl/processes/:pid/console", (request, response, next) => {
  try {
    const pid = Number(request.params.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      response.status(400).json({ error: "SITL process id must be a positive integer." });
      return;
    }
    const child = activeProcesses.get(pid);
    if (!child) {
      response.status(404).json({ error: "Process not found" });
      return;
    }
    const { input } = sitlConsoleInputSchema.parse(request.body);
    if (child.uavLabMeta?.console?.state !== "ready" || child.uavLabMeta.status !== "running") {
      response.status(409).json({ error: child.uavLabMeta?.console?.reason || "MAVProxy is not ready for console commands." });
      return;
    }
    response.json({ pid, ...writeSitlConsoleInput(child, input) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/sitl/processes/:pid/console", (request, response) => {
  const pid = Number(request.params.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    response.status(400).json({ error: "SITL process id must be a positive integer." });
    return;
  }
  const child = activeProcesses.get(pid);
  if (!child) {
    response.status(404).json({ error: "Process not found" });
    return;
  }
  child.uavLabConsole ??= { lines: [] };
  child.uavLabConsole.lines = [];
  child.uavLabConsole.partial = {};
  if (child.uavLabMeta?.console) child.uavLabMeta.console.lineCount = 0;
  response.json({ pid, cleared: true });
});

app.delete("/api/sitl/processes/:pid", async (request, response, next) => {
  const pid = Number(request.params.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    response.status(400).json({ error: "SITL process id must be a positive integer." });
    return;
  }
  const child = activeProcesses.get(pid);
  if (!child) {
    response.status(404).json({ error: "Process not found" });
    return;
  }
  if (child.uavLabMeta.status !== "stopping") {
    const runningConsole = child.uavLabMeta.console;
    child.uavLabMeta.status = "stopping";
    child.uavLabMeta.console = { ...runningConsole, available: false, state: "unavailable", reason: "Stopping SITL and MAVProxy." };
    addSitlLifecycleEvent("PROCESS_STOPPING", `SITL process ${pid} stop requested`, { ...child.uavLabMeta });
    try {
      await stopProcessTree(child);
    } catch (error) {
      // The process tree is still alive, so the stop failed and SITL keeps running.
      if (activeProcesses.get(pid) === child) {
        child.uavLabMeta.status = "running";
        const { available, state, reason } = runningConsole ?? {};
        child.uavLabMeta.console = { ...child.uavLabMeta.console, available, state, reason };
      }
      next(error);
      return;
    }
    // The simulator is already stopped; a bridge cleanup failure must not report it as running.
    await detachGcsBridgeUpstream().catch((error) => loggerWarn("sitl", "Could not release the GCS relay simulator link after stopping SITL.", { code: error?.code }));
    loggerInfo("sitl", "SITL process stop requested", { pid });
  }
  response.json({ stopped: pid, status: activeProcesses.has(pid) ? "stopping" : "stopped" });
});

app.get("/api/gazebo/status", async (_request, response, next) => {
  try {
    response.json(await gazeboStatus());
  } catch (error) {
    next(error);
  }
});

app.post("/api/gazebo/compile", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    const result = await compileGazeboPlugins(design);
    const log = result.compiled ? loggerInfo : loggerWarn;
    log("gazebo", result.message, {
      projectDir: result.projectDir,
      buildDir: result.buildDir,
      steps: result.steps.map((step) => ({ command: step.command, exitCode: step.exitCode, durationMs: step.durationMs }))
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, request, response, _next) => {
  if (error instanceof FirmwareError) {
    loggerWarn("firmware", error.message);
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (error?.type === "entity.too.large") {
    const isFirmware = request.path === "/api/firmware";
    loggerWarn("api", "Request exceeded the configured size limit");
    response.status(413).json({ error: isFirmware
      ? `Firmware upload exceeds the ${firmwareUploadLimitBytes} byte limit.`
      : "Request body exceeds the 10 MB limit. Reduce the workspace or request size." });
    return;
  }

  if (error?.type === "entity.parse.failed") {
    response.status(400).json({ error: "Invalid JSON body. Check the file or request syntax and try again." });
    return;
  }

  if (error instanceof z.ZodError) {
    loggerWarn("api", "Validation error", { message: error.errors.map((entry) => entry.message).join("; ") });
    response.status(400).json({ error: error.errors.map((entry) => entry.message).join("; ") });
    return;
  }

  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
    loggerWarn("api", error.message);
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  if (request.path.startsWith("/api/firmware")) {
    loggerError("firmware", error instanceof Error ? error.message : "Unknown firmware storage error");
    response.status(500).json({ error: "Firmware storage failed. Check the server logs and available disk space." });
    return;
  }

  loggerError("api", error instanceof Error ? error.message : "Unknown server error");
  response.status(500).json({ error: "The request failed. Check the server logs for details and try again." });
});

try {
  await prepareLocalFolders(projectRoot);
} catch {
  console.error("The lab could not create its data folders. Check folder permissions and available disk space before restarting.");
  process.exit(1);
}

httpServer = app.listen(port, "127.0.0.1", () => {
  loggerInfo("server", `ArduPilot UAV Lab API listening on http://127.0.0.1:${port}`);
  console.log(`ArduPilot UAV Lab API listening on http://127.0.0.1:${port}`);
  if (launcherPid) {
    console.log(`Launcher watchdog attached to PID ${launcherPid}`);
  }
});
httpServer.on("error", (error) => {
  const message = serverListenError(error, port);
  loggerError("server", message, { code: error.code });
  console.error(message);
  void shutdown("API could not start", 1);
});

if (launcherPid) {
  setInterval(() => {
    if (!launcherIsAlive()) {
      void shutdown("launcher process closed");
    }
  }, 2000).unref();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGHUP", () => {
  void shutdown("SIGHUP");
});
