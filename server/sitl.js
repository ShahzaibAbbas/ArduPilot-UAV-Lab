import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { airframeLabel, rotorCountForFrame, simulatorFrameForFrame, usesSimulatorFallback } from "./airframes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const exportsDir = path.join(dataDir, "exports");
const execFileAsync = promisify(execFile);
const runtimeSearchScript = `
for candidate in \
  "$ARDUPILOT_HOME/Tools/autotest/sim_vehicle.py" \
  "$ARDUPILOT_ROOT/Tools/autotest/sim_vehicle.py" \
  "$HOME/ardupilot/Tools/autotest/sim_vehicle.py" \
  "$HOME/ArduPilot/Tools/autotest/sim_vehicle.py" \
  "/opt/ardupilot/Tools/autotest/sim_vehicle.py"
do
  if [ -f "$candidate" ]; then printf '%s\\n' "$candidate"; exit 0; fi
done
candidate=$(command -v sim_vehicle.py 2>/dev/null || true)
if [ -n "$candidate" ]; then printf '%s\\n' "$candidate"; exit 0; fi
find "$HOME" -maxdepth 6 -type f -path '*/Tools/autotest/sim_vehicle.py' -print -quit 2>/dev/null
`;
const runtimeCustomPathScript = `
for candidate in "$1" "$1/sim_vehicle.py" "$1/Tools/autotest/sim_vehicle.py"
do
  if [ -f "$candidate" ]; then printf '%s\\n' "$candidate"; exit 0; fi
done
exit 1
`;

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
  const candidates = path.basename(normalized).toLowerCase() === "sim_vehicle.py"
    ? [normalized]
    : [path.join(normalized, "sim_vehicle.py"), path.join(normalized, "Tools", "autotest", "sim_vehicle.py")];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function runFile(command, args, timeout = 8000) {
  try {
    const { stdout = "", stderr = "" } = await execFileAsync(command, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout,
      maxBuffer: 2 * 1024 * 1024
    });
    return { ok: true, stdout: String(stdout).replace(/\0/g, ""), stderr: String(stderr).replace(/\0/g, "") };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout ?? "").replace(/\0/g, ""),
      stderr: String(error?.stderr ?? error?.message ?? "").replace(/\0/g, "")
    };
  }
}

async function findOnPath(binary) {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = await runFile(locator, [binary], 4000);
  if (!result.ok) {
    return undefined;
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function firstLine(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

export function parseWslDistros(output) {
  return String(output ?? "")
    .replace(/\0/g, "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^docker-desktop(?:-data)?$/i.test(line));
}

export function windowsPathToWslPath(target) {
  const normalized = String(target ?? "").replace(/\\/g, "/");
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return drive ? `/mnt/${drive[1].toLowerCase()}/${drive[2]}` : normalized;
}

function inferRuntimeRoot(simVehiclePath, source = "native") {
  if (!simVehiclePath) return undefined;
  const pathApi = source === "native" ? path : path.posix;
  const autotestDir = pathApi.dirname(simVehiclePath);
  const toolsDir = pathApi.dirname(autotestDir);
  if (pathApi.basename(autotestDir).toLowerCase() === "autotest" && pathApi.basename(toolsDir).toLowerCase() === "tools") {
    return pathApi.dirname(toolsDir);
  }
  return autotestDir;
}

function nativeDetection(simVehiclePath, searched, notes = []) {
  const root = inferRuntimeRoot(simVehiclePath, "native");
  return {
    available: true,
    source: "native",
    path: simVehiclePath,
    root,
    displayPath: simVehiclePath,
    configPath: simVehiclePath,
    notes,
    searched
  };
}

async function wslDistributions() {
  if (process.platform !== "win32") return [];
  const result = await runFile("wsl.exe", ["--list", "--quiet"], 6000);
  return result.ok ? parseWslDistros(result.stdout) : [];
}

async function searchWsl(distros, requested) {
  for (const distro of distros) {
    if (requested?.distro && requested.distro.toLowerCase() !== distro.toLowerCase()) continue;
    const args = requested?.path
      ? ["-d", distro, "--exec", "sh", "-lc", runtimeCustomPathScript, "uav-lab", requested.path]
      : ["-d", distro, "--exec", "sh", "-lc", runtimeSearchScript];
    const result = await runFile("wsl.exe", args, 10000);
    const simPath = firstLine(result.stdout);
    if (result.ok && simPath) {
      return {
        available: true,
        source: "wsl",
        path: simPath,
        root: inferRuntimeRoot(simPath, "wsl"),
        displayPath: `WSL · ${distro} · ${simPath}`,
        configPath: `wsl://${distro}${simPath}`,
        distro,
        notes: [],
        searched: []
      };
    }
  }
  return undefined;
}

function cygwinBashCandidates() {
  if (process.platform !== "win32") return [];
  const roots = [process.env.CYGWIN_HOME, "C:\\cygwin64", "C:\\cygwin", "C:\\tools\\cygwin"].filter(Boolean);
  return [...new Set(roots.map((root) => path.join(root, "bin", "bash.exe")))];
}

async function searchCygwin(requestedPath) {
  for (const bashPath of cygwinBashCandidates()) {
    if (!(await exists(bashPath))) continue;
    const args = requestedPath
      ? ["-lc", runtimeCustomPathScript, "uav-lab", requestedPath]
      : ["-lc", runtimeSearchScript];
    const result = await runFile(bashPath, args, 10000);
    const simPath = firstLine(result.stdout);
    if (result.ok && simPath) {
      return {
        available: true,
        source: "cygwin",
        path: simPath,
        root: inferRuntimeRoot(simPath, "cygwin"),
        displayPath: `Cygwin · ${simPath}`,
        configPath: `cygwin:${simPath}`,
        bashPath,
        notes: [],
        searched: []
      };
    }
  }
  return undefined;
}

function parseCustomRuntimePath(value) {
  const input = String(value ?? "").trim().replace(/^"|"$/g, "");
  const wslUrl = input.match(/^wsl:\/\/([^/]+)(\/.*)$/i);
  if (wslUrl) return { source: "wsl", distro: wslUrl[1], path: wslUrl[2] };
  const wslShort = input.match(/^([^:\\/]{2,}):(\/.*)$/);
  if (wslShort) return { source: "wsl", distro: wslShort[1], path: wslShort[2] };
  const wslUnc = input.match(/^\\\\wsl(?:\.localhost)?\$?\\([^\\]+)\\(.+)$/i);
  if (wslUnc) return { source: "wsl", distro: wslUnc[1], path: `/${wslUnc[2].replace(/\\/g, "/")}` };
  const cygwin = input.match(/^cygwin:(\/.*)$/i);
  if (cygwin) return { source: "cygwin", path: cygwin[1] };
  if (input.startsWith("/")) return { source: "posix", path: input };
  return { source: "native", path: input };
}

async function findSimVehicle(customPath) {
  const notes = [];
  const searched = [];
  let distros;

  if (customPath && String(customPath).trim()) {
    const requested = parseCustomRuntimePath(customPath);
    searched.push("configured location");
    if (requested.source === "native") {
      const custom = await resolveSimVehiclePath(requested.path);
      if (custom) return nativeDetection(custom, searched);
    } else if (requested.source === "cygwin") {
      const custom = await searchCygwin(requested.path);
      if (custom) return { ...custom, searched };
    } else {
      if (requested.source === "posix") {
        const cygwin = await searchCygwin(requested.path);
        if (cygwin) return { ...cygwin, searched };
      }
      distros = await wslDistributions();
      const wsl = await searchWsl(distros, requested.source === "wsl" ? requested : { path: requested.path });
      if (wsl) return { ...wsl, searched };
    }
    notes.push("The configured location was not found; automatic Windows, Cygwin, and WSL discovery continued.");
  }

  searched.push("Windows/native environment and common folders");
  const roots = [
    process.env.ARDUPILOT_HOME,
    process.env.ARDUPILOT_ROOT,
    path.join(os.homedir(), "ardupilot"),
    path.join(os.homedir(), "ArduPilot"),
    path.join(os.homedir(), "Documents", "ardupilot"),
    path.join(os.homedir(), "Desktop", "ardupilot"),
    path.join(os.homedir(), "Downloads", "ardupilot")
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = await resolveSimVehiclePath(root);
    if (candidate) return nativeDetection(candidate, searched, notes);
  }
  const onPath = await findOnPath("sim_vehicle.py");
  if (onPath) return nativeDetection(onPath, searched, notes);

  if (process.platform === "win32") {
    searched.push("Cygwin installations");
    const cygwin = await searchCygwin();
    if (cygwin) return { ...cygwin, notes, searched };

    searched.push("WSL distributions");
    distros ??= await wslDistributions();
    const wsl = await searchWsl(distros);
    if (wsl) return { ...wsl, notes, searched };
  }

  notes.push("Automatic search checked Windows/native paths, Cygwin, and WSL but did not find sim_vehicle.py.");
  notes.push("Locate the file or ArduPilot checkout and paste its path, for example C:\\ardupilot, wsl://Ubuntu/home/user/ardupilot, or cygwin:/home/user/ardupilot.");
  return { available: false, notes, searched };
}

async function runtimePathFor(hostPath, detection) {
  if (detection.source === "wsl" && detection.distro) {
    const result = await runFile("wsl.exe", ["-d", detection.distro, "--exec", "wslpath", "-a", "-u", hostPath], 5000);
    return firstLine(result.stdout) || windowsPathToWslPath(hostPath);
  }
  if (detection.source === "cygwin" && detection.bashPath) {
    const cygpath = path.join(path.dirname(detection.bashPath), "cygpath.exe");
    const result = await runFile(cygpath, ["-a", "-u", hostPath], 5000);
    return firstLine(result.stdout) || hostPath;
  }
  return hostPath;
}

function launcherFor(detection) {
  if (!detection?.available || !detection.path) {
    return { command: "sim_vehicle.py", prefixArgs: [], hostCwd: process.cwd(), displayCwd: process.cwd() };
  }
  if (detection.source === "wsl") {
    return {
      command: "wsl.exe",
      prefixArgs: ["-d", detection.distro, "--cd", detection.root, "--exec", "python3", detection.path],
      hostCwd: process.cwd(),
      displayCwd: detection.root
    };
  }
  if (detection.source === "cygwin") {
    return {
      command: detection.bashPath,
      prefixArgs: ["-lc", 'cd "$1" && shift && exec python3 "$@"', "uav-lab", detection.root, detection.path],
      hostCwd: path.dirname(path.dirname(detection.bashPath)),
      displayCwd: detection.root
    };
  }
  const command = process.platform === "win32" ? "python" : detection.path;
  return {
    command,
    prefixArgs: process.platform === "win32" ? [detection.path] : [],
    hostCwd: detection.root || process.cwd(),
    displayCwd: detection.root || process.cwd()
  };
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

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function integerValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

export function buildSwarmLayout(settings = {}) {
  const count = clamp(integerValue(settings.swarmCount, 1), 1, 32);
  const spacing = clamp(numberValue(settings.swarmSpacingM, 20), 1, 500);
  const layout = ["line", "grid", "circle"].includes(settings.swarmLayout) ? settings.swarmLayout : "line";
  const vehicles = [];

  if (layout === "grid") {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    for (let index = 0; index < count; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      vehicles.push({
        index: index + 1,
        sysid: index + 1,
        x: Math.round((column - (columns - 1) / 2) * spacing * 100) / 100,
        y: Math.round((row - (rows - 1) / 2) * spacing * 100) / 100,
        heading: 0
      });
    }
  } else if (layout === "circle") {
    const radius = Math.max(spacing, (spacing * count) / (2 * Math.PI));
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      vehicles.push({
        index: index + 1,
        sysid: index + 1,
        x: Math.round(Math.cos(angle) * radius * 100) / 100,
        y: Math.round(Math.sin(angle) * radius * 100) / 100,
        heading: Math.round((angle * 180) / Math.PI)
      });
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      vehicles.push({
        index: index + 1,
        sysid: index + 1,
        x: Math.round((index - (count - 1) / 2) * spacing * 100) / 100,
        y: 0,
        heading: 0
      });
    }
  }

  return {
    count,
    layout,
    spacingM: spacing,
    vehicles
  };
}

function failsafeActionValue(action) {
  const normalized = String(action || "").toLowerCase();
  if (normalized === "land") return 1;
  if (normalized === "rtl") return 2;
  if (normalized === "smartrtl") return 3;
  if (normalized === "terminate") return 5;
  return 0;
}

function airspeedTypeValue(sensor) {
  const interfaceName = String(getProperty(sensor, "interface", "I2C MS4525")).toLowerCase();
  if (interfaceName.includes("analog")) return 2;
  if (interfaceName.includes("ms5525")) return 5;
  if (interfaceName.includes("can")) return 8;
  return 1;
}

function opticalFlowTypeValue(sensor) {
  const interfaceName = String(getProperty(sensor, "interface", "I2C")).toLowerCase();
  if (interfaceName.includes("can")) return 8;
  return 1;
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
  const settings = design.settings ?? {};
  const battery = firstNode(design, "battery");
  const esc = firstNode(design, "esc");
  const airspeed = firstNode(design, "airspeed-sensor");
  const opticalFlow = firstNode(design, "optical-flow");
  const parachute = firstNode(design, "parachute");
  const hasGps = nodeCount(design, "gps") > 0;
  const hasCompass = nodeCount(design, "compass") > 0;
  const hasRangefinder = nodeCount(design, "rangefinder") > 0;
  const motorCount = nodeCount(design, "motor");
  const cells = Number(getProperty(battery, "cells", 4));
  const capacity = Number(getProperty(battery, "capacityMah", 5200));
  const lowPercent = clamp(numberValue(settings.batteryLowPercent, 20), 1, 80);
  const criticalPercent = clamp(numberValue(settings.batteryCriticalPercent, 10), 0, Math.max(0, lowPercent - 1));
  const lowMah = Math.round(capacity * (lowPercent / 100));
  const criticalMah = Math.round(capacity * (criticalPercent / 100));
  const lowVoltage = Math.max(3.5 * cells, 0).toFixed(1);
  const criticalVoltage = Math.max(3.3 * cells, 0).toFixed(1);
  const pwmType = pwmTypeFor(getProperty(esc, "protocol", "PWM"));

  const lines = [
    "# Generated by ArduPilot UAV Lab",
    `# Design: ${design.name}`,
    `# Components: ${design.nodes.length}`,
    `# Motors: ${motorCount}`,
    `# Scenario: ${settings.testScenario || "nominal"}`,
    `# Wind/Gust target: ${numberValue(settings.windSpeedMps, 0)} / ${numberValue(settings.windGustMps, 0)} m/s`,
    "",
    "BATT_MONITOR,4",
    `BATT_CAPACITY,${capacity}`,
    `BATT_LOW_VOLT,${lowVoltage}`,
    `BATT_LOW_MAH,${lowMah}`,
    `BATT_FS_LOW_ACT,${failsafeActionValue(settings.batteryFailsafeAction)}`,
    `BATT_CRT_VOLT,${criticalVoltage}`,
    `BATT_CRT_MAH,${criticalMah}`,
    `BATT_FS_CRT_ACT,${failsafeActionValue(settings.batteryCriticalAction)}`,
    `MOT_PWM_TYPE,${pwmType}`,
    `GPS_TYPE,${hasGps ? 1 : 0}`,
    `COMPASS_ENABLE,${hasCompass ? 1 : 0}`,
    `RNGFND1_TYPE,${hasRangefinder ? 25 : 0}`,
    "LOG_DISARMED,1"
  ];

  if (design.settings?.vehicle === "ArduCopter") {
    lines.push("ARMING_CHECK,1");
  }

  if (airspeed) {
    lines.push(
      "",
      "# Airspeed starter settings",
      `ARSPD_TYPE,${airspeedTypeValue(airspeed)}`,
      "ARSPD_USE,1",
      `ARSPD_RATIO,${numberValue(getProperty(airspeed, "ratio", 2), 2)}`
    );
  }

  if (opticalFlow) {
    lines.push("", "# Optical flow starter settings", `FLOW_TYPE,${opticalFlowTypeValue(opticalFlow)}`);
  }

  if (parachute) {
    lines.push(
      "",
      "# Parachute starter settings",
      "CHUTE_ENABLED,1",
      `CHUTE_ALT_MIN,${numberValue(getProperty(parachute, "minAltitudeM", 30), 30)}`,
      `CHUTE_CRT_SINK,${numberValue(getProperty(parachute, "criticalSinkMps", 10), 10)}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function generateParamExplanation(design) {
  const settings = design.settings ?? {};
  const battery = firstNode(design, "battery");
  const esc = firstNode(design, "esc");
  const airspeed = firstNode(design, "airspeed-sensor");
  const opticalFlow = firstNode(design, "optical-flow");
  const parachute = firstNode(design, "parachute");
  const cells = Number(getProperty(battery, "cells", 4));
  const capacity = Number(getProperty(battery, "capacityMah", 5200));
  const lowPercent = clamp(numberValue(settings.batteryLowPercent, 20), 1, 80);
  const criticalPercent = clamp(numberValue(settings.batteryCriticalPercent, 10), 0, Math.max(0, lowPercent - 1));
  const explanations = [
    {
      parameter: "BATT_MONITOR",
      value: "4",
      source: "Power module",
      reason: "Enables analog voltage/current monitoring for the selected power-module style."
    },
    {
      parameter: "BATT_CAPACITY",
      value: String(capacity),
      source: battery?.data?.label ?? "Battery default",
      reason: "Uses the selected battery capacity in mAh for battery remaining and failsafe calculations."
    },
    {
      parameter: "BATT_LOW_VOLT",
      value: Math.max(3.5 * cells, 0).toFixed(1),
      source: `${cells}S battery`,
      reason: "Sets a conservative low-voltage threshold at about 3.5 V per cell."
    },
    {
      parameter: "BATT_LOW_MAH",
      value: String(Math.round(capacity * (lowPercent / 100))),
      source: "Low reserve setting",
      reason: `Converts the configured ${lowPercent}% low reserve into consumed-capacity threshold units.`
    },
    {
      parameter: "BATT_FS_LOW_ACT",
      value: String(failsafeActionValue(settings.batteryFailsafeAction)),
      source: "Low battery action",
      reason: `Maps ${settings.batteryFailsafeAction || "Warn"} to ArduPilot's low battery failsafe action value.`
    },
    {
      parameter: "BATT_CRT_VOLT",
      value: Math.max(3.3 * cells, 0).toFixed(1),
      source: `${cells}S battery`,
      reason: "Sets a critical-voltage threshold at about 3.3 V per cell."
    },
    {
      parameter: "BATT_CRT_MAH",
      value: String(Math.round(capacity * (criticalPercent / 100))),
      source: "Critical reserve setting",
      reason: `Converts the configured ${criticalPercent}% critical reserve into consumed-capacity threshold units.`
    },
    {
      parameter: "BATT_FS_CRT_ACT",
      value: String(failsafeActionValue(settings.batteryCriticalAction)),
      source: "Critical battery action",
      reason: `Maps ${settings.batteryCriticalAction || "Land"} to ArduPilot's critical battery failsafe action value.`
    },
    {
      parameter: "MOT_PWM_TYPE",
      value: String(pwmTypeFor(getProperty(esc, "protocol", "PWM"))),
      source: esc?.data?.label ?? "ESC default",
      reason: "Selects the motor output protocol from the first ESC protocol property."
    },
    {
      parameter: "GPS_TYPE",
      value: nodeCount(design, "gps") > 0 ? "1" : "0",
      source: "GPS component count",
      reason: "Enables the default simulated GPS driver when a GPS component exists."
    },
    {
      parameter: "COMPASS_ENABLE",
      value: nodeCount(design, "compass") > 0 ? "1" : "0",
      source: "Compass component count",
      reason: "Enables compass support when the design includes a compass."
    },
    {
      parameter: "RNGFND1_TYPE",
      value: nodeCount(design, "rangefinder") > 0 ? "25" : "0",
      source: "Rangefinder component count",
      reason: "Adds a starter rangefinder type when a rangefinder is present."
    },
    {
      parameter: "LOG_DISARMED",
      value: "1",
      source: "Lab default",
      reason: "Keeps logs available during bench and pre-arm simulation checks."
    }
  ];

  if (design.settings?.vehicle === "ArduCopter") {
    explanations.push({
      parameter: "ARMING_CHECK",
      value: "1",
      source: "Vehicle type",
      reason: "Keeps standard ArduCopter arming checks enabled for simulator test runs."
    });
  }

  if (airspeed) {
    explanations.push(
      {
        parameter: "ARSPD_TYPE",
        value: String(airspeedTypeValue(airspeed)),
        source: airspeed.data?.label ?? "Airspeed sensor",
        reason: "Maps the selected airspeed sensor interface to an ArduPilot starter type."
      },
      {
        parameter: "ARSPD_USE",
        value: "1",
        source: airspeed.data?.label ?? "Airspeed sensor",
        reason: "Enables airspeed use for fixed-wing and wind-aware test scenarios."
      },
      {
        parameter: "ARSPD_RATIO",
        value: String(numberValue(getProperty(airspeed, "ratio", 2), 2)),
        source: airspeed.data?.label ?? "Airspeed sensor",
        reason: "Uses the component ratio property as the initial airspeed calibration ratio."
      }
    );
  }

  if (opticalFlow) {
    explanations.push({
      parameter: "FLOW_TYPE",
      value: String(opticalFlowTypeValue(opticalFlow)),
      source: opticalFlow.data?.label ?? "Optical flow",
      reason: "Maps the selected optical-flow interface to an ArduPilot starter type."
    });
  }

  if (parachute) {
    explanations.push(
      {
        parameter: "CHUTE_ENABLED",
        value: "1",
        source: parachute.data?.label ?? "Parachute",
        reason: "Enables recovery parachute support when recovery hardware is present."
      },
      {
        parameter: "CHUTE_ALT_MIN",
        value: String(numberValue(getProperty(parachute, "minAltitudeM", 30), 30)),
        source: parachute.data?.label ?? "Parachute",
        reason: "Uses the parachute minimum-altitude property for starter recovery constraints."
      },
      {
        parameter: "CHUTE_CRT_SINK",
        value: String(numberValue(getProperty(parachute, "criticalSinkMps", 10), 10)),
        source: parachute.data?.label ?? "Parachute",
        reason: "Uses the parachute critical-sink property for starter recovery constraints."
      }
    );
  }

  return explanations;
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
  const selectedFrame = settings.frame || "quad-x";
  const frame =
    settings.physicsBackend === "json"
      ? `JSON:${settings.jsonHost || "127.0.0.1"}`
      : simulatorFrameForFrame(selectedFrame);
  const paramFile = await writeParamFile(design);
  const launcher = launcherFor(detection);
  const runtimeParamFile = await runtimePathFor(paramFile.path, detection);
  const outputs = gcsOutputs(settings);
  const swarm = buildSwarmLayout(settings);

  const args = [
    ...launcher.prefixArgs,
    "-v",
    vehicle,
    "-f",
    frame,
    "--console",
    "--map",
    `--add-param-file=${runtimeParamFile}`,
    ...outputs.map((output) => `--out=udp:${output.host}:${output.port}`)
  ];

  if (swarm.count > 1) {
    args.push(`--count=${swarm.count}`, "--auto-sysid");
  }

  if (settings.speedup && Number(settings.speedup) > 1) {
    args.push(`--speedup=${Number(settings.speedup)}`);
  }

  if (settings.locationName) {
    args.push("-L", settings.locationName);
  }

  const commandLine = [launcher.command, ...args].map(shellQuote).join(" ");
  const cwd = launcher.hostCwd;
  const notes = [...detection.notes];

  if (settings.physicsBackend === "json") {
    notes.push("Start your external physics process before launching the JSON backend.");
  } else if (usesSimulatorFallback(selectedFrame)) {
    notes.push(
      `${airframeLabel(selectedFrame)} uses ${rotorCountForFrame(selectedFrame)} rotor slots in the lab. SITL uses ${frame} dynamics as the closest native frame; use the JSON backend for exact custom rotor physics.`
    );
  }

  if (settings.testScenario && settings.testScenario !== "nominal") {
    notes.push(`Scenario selected: ${settings.testScenario}. Confirm matching mission actions in your ground station before flight testing.`);
  }

  if (Number(settings.windSpeedMps) > 0 || Number(settings.windGustMps) > 0) {
    notes.push(
      `Wind target ${numberValue(settings.windSpeedMps, 0)} m/s, gust ${numberValue(settings.windGustMps, 0)} m/s. Mirror these values in Gazebo wind plugin or the JSON physics process.`
    );
  }

  if (settings.testScenario === "low-battery") {
    notes.push(
      `Battery failsafe export uses low ${numberValue(settings.batteryLowPercent, 20)}% -> ${settings.batteryFailsafeAction || "RTL"}, critical ${numberValue(settings.batteryCriticalPercent, 10)}% -> ${settings.batteryCriticalAction || "Land"}.`
    );
  }

  if (settings.testScenario === "gps-denied") {
    notes.push("For GPS-denied testing, disable or degrade GPS in the simulator and verify optical-flow/rangefinder coverage in validation.");
  }

  if (settings.testScenario === "sensor-failure") {
    notes.push("Sensor-failure scenario selected. Use the Gazebo export to script GPS, compass, or rangefinder degradation.");
  }

  if (swarm.count > 1) {
    notes.push(
      `Swarm layout ${swarm.layout} with ${swarm.count} vehicles at ${swarm.spacingM} m spacing. SITL receives --count and --auto-sysid; use the layout table for external physics or Gazebo offsets.`
    );
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
    source: detection.source,
    command: launcher.command,
    args,
    commandLine,
    cwd,
    displayCwd: launcher.displayCwd,
    paramFile: paramFile.path,
    outputs,
    swarm,
    notes
  };
}

export async function getSystemStatus(customPath) {
  const detection = await findSimVehicle(customPath);
  const launcher = launcherFor(detection);
  return {
    sitl: {
      available: detection.available,
      source: detection.source,
      path: detection.path,
      displayPath: detection.displayPath,
      configPath: detection.configPath,
      root: detection.root,
      distro: detection.distro,
      command: detection.available ? launcher.command : undefined,
      searched: detection.searched,
      notes: detection.available
        ? [`Found sim_vehicle.py in ${detection.source === "wsl" ? `WSL ${detection.distro}` : detection.source}.`]
        : detection.notes
    }
  };
}
