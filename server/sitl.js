import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const exportsDir = path.join(dataDir, "exports");

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveSimVehiclePath(inputPath) {
  if (!inputPath || !String(inputPath).trim()) {
    return undefined;
  }

  const normalized = path.resolve(String(inputPath).trim().replace(/^"|"$/g, ""));
  const candidates = [
    normalized,
    path.join(normalized, "sim_vehicle.py"),
    path.join(normalized, "Tools", "autotest", "sim_vehicle.py")
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function findOnPath(binary) {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, [binary], { encoding: "utf8" });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function findSimVehicle(customPath) {
  const notes = [];

  if (customPath && String(customPath).trim()) {
    const custom = await resolveSimVehiclePath(customPath);
    if (custom) {
      return { available: true, path: custom, notes };
    }
    notes.push("The configured sim_vehicle.py path was not found. Use the exact file path or an ArduPilot checkout directory.");
  }

  const roots = [process.env.ARDUPILOT_HOME, process.env.ARDUPILOT_ROOT].filter(Boolean);

  for (const root of roots) {
    const candidate = path.join(root, "Tools", "autotest", "sim_vehicle.py");
    if (await exists(candidate)) {
      return { available: true, path: candidate, notes };
    }
  }

  const onPath = findOnPath("sim_vehicle.py");
  if (onPath) {
    return { available: true, path: onPath, notes };
  }

  notes.push("Set ARDUPILOT_HOME to an ArduPilot checkout or add Tools/autotest to PATH.");
  notes.push("On Windows, ArduPilot SITL is normally run from Linux or WSL2.");
  return { available: false, notes };
}

function inferArdupilotRoot(simVehiclePath) {
  if (!simVehiclePath) {
    return undefined;
  }

  const autotestDir = path.dirname(simVehiclePath);
  const toolsDir = path.dirname(autotestDir);
  if (path.basename(autotestDir).toLowerCase() === "autotest" && path.basename(toolsDir).toLowerCase() === "tools") {
    return path.dirname(toolsDir);
  }

  return autotestDir;
}

function launcherFor(simVehiclePath) {
  if (!simVehiclePath) {
    return { command: "sim_vehicle.py", prefixArgs: [] };
  }
  if (process.platform === "win32") {
    return { command: "python", prefixArgs: [simVehiclePath] };
  }
  return { command: simVehiclePath, prefixArgs: [] };
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=\\-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '\\"')}"`;
}

function nodeCount(design, type) {
  return design.nodes.filter((node) => node.data?.componentType === type).length;
}

function firstNode(design, type) {
  return design.nodes.find((node) => node.data?.componentType === type);
}

function getProperty(node, key, fallback) {
  const value = node?.data?.properties?.[key];
  return value ?? fallback;
}

function gcsOutputs(settings) {
  const targets = Array.isArray(settings.gcsTargets)
    ? settings.gcsTargets
    : [{ id: "legacy", name: "Ground station", enabled: true, host: settings.gcsHost || "127.0.0.1", port: settings.gcsPort || 14550 }];
  const seen = new Set();
  const outputs = [];

  for (const target of targets) {
    if (!target?.enabled) {
      continue;
    }

    const host = String(target.host || "127.0.0.1").trim() || "127.0.0.1";
    const port = Number(target.port || 14550);
    const key = `${host}:${port}`;
    if (!Number.isFinite(port) || port <= 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    outputs.push({
      id: target.id,
      name: target.name || target.id || "Ground station",
      host,
      port
    });
  }

  return outputs;
}

function pwmTypeFor(protocol) {
  const normalized = String(protocol).toLowerCase();
  if (normalized.includes("dshot600")) return 6;
  if (normalized.includes("dshot300")) return 5;
  if (normalized.includes("dshot150")) return 4;
  if (normalized.includes("oneshot")) return 2;
  return 0;
}

export function generateParamContent(design) {
  const battery = firstNode(design, "battery");
  const esc = firstNode(design, "esc");
  const hasGps = nodeCount(design, "gps") > 0;
  const hasCompass = nodeCount(design, "compass") > 0;
  const hasRangefinder = nodeCount(design, "rangefinder") > 0;
  const motorCount = nodeCount(design, "motor");
  const cells = Number(getProperty(battery, "cells", 4));
  const capacity = Number(getProperty(battery, "capacityMah", 5200));
  const lowVoltage = Math.max(3.5 * cells, 0).toFixed(1);
  const criticalVoltage = Math.max(3.3 * cells, 0).toFixed(1);
  const pwmType = pwmTypeFor(getProperty(esc, "protocol", "PWM"));

  const lines = [
    "# Generated by ArduPilot UAV Lab",
    `# Design: ${design.name}`,
    `# Components: ${design.nodes.length}`,
    `# Motors: ${motorCount}`,
    "",
    "BATT_MONITOR,4",
    `BATT_CAPACITY,${capacity}`,
    `BATT_LOW_VOLT,${lowVoltage}`,
    `BATT_CRT_VOLT,${criticalVoltage}`,
    `MOT_PWM_TYPE,${pwmType}`,
    `GPS_TYPE,${hasGps ? 1 : 0}`,
    `COMPASS_ENABLE,${hasCompass ? 1 : 0}`,
    `RNGFND1_TYPE,${hasRangefinder ? 25 : 0}`,
    "LOG_DISARMED,1"
  ];

  if (design.settings?.vehicle === "ArduCopter") {
    lines.push("ARMING_CHECK,1");
  }

  return `${lines.join("\n")}\n`;
}

export async function writeParamFile(design) {
  await mkdir(exportsDir, { recursive: true });
  const safeName = String(design.name || "uav-design")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const fileName = `${safeName || "uav-design"}.param`;
  const target = path.join(exportsDir, fileName);
  const content = generateParamContent(design);
  await writeFile(target, content, "utf8");
  return { fileName, path: target, content };
}

export async function buildSitlPlan(design) {
  const settings = design.settings ?? {};
  const detection = await findSimVehicle(settings.simVehiclePath);
  const vehicle = settings.vehicle || "ArduCopter";
  const frame =
    settings.physicsBackend === "json"
      ? `JSON:${settings.jsonHost || "127.0.0.1"}`
      : settings.frame || "quad";
  const paramFile = await writeParamFile(design);
  const launcher = launcherFor(detection.path);
  const outputs = gcsOutputs(settings);

  const args = [
    ...launcher.prefixArgs,
    "-v",
    vehicle,
    "-f",
    frame,
    "--console",
    "--map",
    `--add-param-file=${paramFile.path}`,
    ...outputs.map((output) => `--out=udp:${output.host}:${output.port}`)
  ];

  if (settings.speedup && Number(settings.speedup) > 1) {
    args.push(`--speedup=${Number(settings.speedup)}`);
  }

  if (settings.locationName) {
    args.push("-L", settings.locationName);
  }

  const commandLine = [launcher.command, ...args].map(shellQuote).join(" ");
  const cwd = process.env.ARDUPILOT_HOME || process.env.ARDUPILOT_ROOT || inferArdupilotRoot(detection.path) || process.cwd();
  const notes = [...detection.notes];

  if (settings.physicsBackend === "json") {
    notes.push("Start your external physics process before launching the JSON backend.");
  }

  if (!detection.available) {
    notes.push("The command is generated, but the app cannot launch it until sim_vehicle.py is available.");
  }

  if (outputs.length === 0) {
    notes.push("No ground-station UDP outputs are enabled.");
  } else {
    notes.push(...outputs.map((output) => `${output.name} UDP output: ${output.host}:${output.port}`));
  }

  return {
    available: detection.available,
    command: launcher.command,
    args,
    commandLine,
    cwd,
    paramFile: paramFile.path,
    outputs,
    notes
  };
}

export async function getSystemStatus(customPath) {
  const detection = await findSimVehicle(customPath);
  const launcher = launcherFor(detection.path);
  return {
    sitl: {
      available: detection.available,
      path: detection.path,
      command: detection.available ? launcher.command : undefined,
      notes: detection.available ? [`Found sim_vehicle.py at ${detection.path}`] : detection.notes
    }
  };
}
