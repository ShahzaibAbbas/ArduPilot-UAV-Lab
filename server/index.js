import cors from "cors";
import express from "express";
import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import {
  generateGazeboWorldArtifact,
  generateJsonBridgeArtifact,
  generateMissionArtifact,
  generatePrearmArtifact,
  generateSimulatorBundleArtifact
} from "./artifacts.js";
import { deleteCustomComponent, listCustomComponents, saveCustomComponent } from "./customComponents.js";
import { listDesigns, saveDesign } from "./designStore.js";
import { compileGazeboPlugins, gazeboStatus } from "./gazebo.js";
import { clearLogs, listLogs, loggerError, loggerInfo, loggerWarn, readLogFileTail } from "./logger.js";
import { buildSitlPlan, generateParamContent, getSystemStatus } from "./sitl.js";
import { runTerminalCommand } from "./terminal.js";
import { sendMavlinkCommand, shutdownTelemetry, startTelemetryListener, stopTelemetryListener, telemetryStatus } from "./telemetry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);
const app = express();
const port = Number(process.env.PORT || 4310);
const activeProcesses = new Map();
const launcherPid = Number(process.env.ARDUPILOT_LAUNCHER_PID || 0);
let softwareUpdateRunning = false;
let shuttingDown = false;
let httpServer;
const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);

const designSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  settings: z.record(z.unknown())
});

const locateSchema = z.object({
  simVehiclePath: z.string().optional()
});

const telemetryListenerSchema = z.object({
  port: z.number().int().min(1024).max(65535).optional()
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
    windowsHide: true
  });

  const result = {
    command: [command, ...args].join(" "),
    output: [stdout, stderr].filter(Boolean).join("\n").trim()
  };
  loggerInfo("maintenance", `Finished ${result.command}`, { outputLength: result.output.length });
  return result;
}

function isAllowedLocalOrigin(origin) {
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && localHostnames.has(parsed.hostname);
  } catch {
    return false;
  }
}

function requireLocalOrigin(request, response, next) {
  if (!isAllowedLocalOrigin(request.get("origin"))) {
    response.status(403).json({ error: "Only local browser origins are allowed." });
    return;
  }

  next();
}

function stopActiveProcesses() {
  for (const [pid, child] of activeProcesses) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process may have already exited.
    }
    activeProcesses.delete(pid);
  }
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
  stopActiveProcesses();
  await shutdownTelemetry().catch(() => undefined);

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
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on("finish", () => {
    if (
      request.path === "/api/health" ||
      request.path.startsWith("/api/logs") ||
      (request.method === "GET" && request.path === "/api/telemetry")
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

  try {
    if (!(await exists(path.join(projectRoot, ".git")))) {
      response.status(409).json({
        error: "This folder is not a Git checkout. Clone the project from Git first, then use Update Software."
      });
      return;
    }

    softwareUpdateRunning = true;
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

app.get("/api/telemetry", (_request, response) => {
  response.json(telemetryStatus());
});

app.post("/api/telemetry/listener", async (request, response, next) => {
  try {
    const options = telemetryListenerSchema.parse(request.body ?? {});
    response.json(await startTelemetryListener(options));
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

app.get("/api/designs", async (_request, response, next) => {
  try {
    response.json({ designs: await listDesigns() });
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

app.post("/api/sitl/plan", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    response.json({ plan: await buildSitlPlan(design) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sitl/launch", async (request, response, next) => {
  try {
    const design = designSchema.parse(request.body);
    const plan = await buildSitlPlan(design);

    if (!plan.available) {
      response.status(409).json({ error: "sim_vehicle.py was not found. Generate the plan and run it manually after installing ArduPilot SITL." });
      return;
    }

    const child = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: process.env,
      windowsHide: true
    });

    activeProcesses.set(child.pid, child);
    loggerInfo("sitl", `SITL launched as PID ${child.pid}`, { command: plan.commandLine, cwd: plan.cwd });
    child.stdout?.on("data", (chunk) => {
      loggerInfo("sitl", chunk.toString("utf8").trim(), { pid: child.pid, stream: "stdout" });
    });
    child.stderr?.on("data", (chunk) => {
      loggerWarn("sitl", chunk.toString("utf8").trim(), { pid: child.pid, stream: "stderr" });
    });
    child.once("exit", () => {
      activeProcesses.delete(child.pid);
      loggerInfo("sitl", `SITL process exited`, { pid: child.pid });
    });

    response.json({ pid: child.pid, plan });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sitl/processes", (_request, response) => {
  response.json({ processes: Array.from(activeProcesses.keys()) });
});

app.delete("/api/sitl/processes/:pid", (request, response) => {
  const pid = Number(request.params.pid);
  const child = activeProcesses.get(pid);
  if (!child) {
    response.status(404).json({ error: "Process not found" });
    return;
  }
  child.kill("SIGTERM");
  activeProcesses.delete(pid);
  loggerInfo("sitl", `SITL process stopped`, { pid });
  response.json({ stopped: pid });
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

app.use((error, _request, response, _next) => {
  if (error instanceof z.ZodError) {
    loggerWarn("api", "Validation error", { message: error.errors.map((entry) => entry.message).join("; ") });
    response.status(400).json({ error: error.errors.map((entry) => entry.message).join("; ") });
    return;
  }

  loggerError("api", error instanceof Error ? error.message : "Unknown server error");
  response.status(500).json({ error: error instanceof Error ? error.message : "Unknown server error" });
});

httpServer = app.listen(port, "127.0.0.1", () => {
  loggerInfo("server", `ArduPilot UAV Lab API listening on http://127.0.0.1:${port}`);
  console.log(`ArduPilot UAV Lab API listening on http://127.0.0.1:${port}`);
  if (launcherPid) {
    console.log(`Launcher watchdog attached to PID ${launcherPid}`);
  }
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
