import { mkdir, opendir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import { airframeLabel, rotorCountForFrame, simulatorFrameForFrame, usesSimulatorFallback } from "./airframes.js";
import { gcsBridgeOptions } from "./gcsBridge.js";
import { runOwnedFile as execFileAsync } from "./processLifecycle.js";
import { batteryMetrics } from "./batteryModel.js";
import { requireRuntimeDisplay, runtimeDisplayStatus } from "./runtimeDisplay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const exportsDir = path.join(dataDir, "exports");
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
find "$HOME" -maxdepth 6 \\( -name node_modules -o -name .git -o -name dist -o -name data -o -name backups -o -name .cache -o -name .local \\) -prune -o -type f -path '*/Tools/autotest/sim_vehicle.py' -print -quit 2>/dev/null || true
`;
const runtimeCustomPathScript = `
for candidate in "$1" "$1/sim_vehicle.py" "$1/Tools/autotest/sim_vehicle.py"
do
  case "$candidate" in
    */sim_vehicle.py|sim_vehicle.py)
      if [ -f "$candidate" ]; then printf '%s\\n' "$candidate"; exit 0; fi
      ;;
  esac
done
exit 1
`;

async function exists(target) {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

export async function resolveSimVehiclePath(inputPath) {
  if (!inputPath || !String(inputPath).trim()) {
    return undefined;
  }

  const cleaned = String(inputPath).trim().replace(/^(["'])(.*)\1$/, "$2");
  if (cleaned.includes("\0")) return undefined;
  const normalized = path.resolve(cleaned === "~" ? os.homedir() : cleaned.replace(/^~[/\\]/, `${os.homedir()}${path.sep}`));
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

const excludedSearchDirectories = new Set([
  "node_modules", ".git", "dist", "data", "backups", "build", "appdata", ".cache", ".local", ".codex", ".agents",
  "simulator-bundles", "gazebo-plugins"
]);

/** Search checkouts without traversing dependency trees, symlinks, or the whole disk. */
export async function searchNativeCheckouts(roots, { maxDepth = 4, maxEntries = 3000, timeoutMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const queue = [...new Set(roots.filter(Boolean).map((root) => path.resolve(root)))].map((root) => ({ root, depth: 0 }));
  const visited = new Set();
  let inspected = 0;
  for (let index = 0; index < queue.length && inspected < maxEntries && Date.now() < deadline; index += 1) {
    const { root, depth } = queue[index];
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (visited.has(key)) continue;
    visited.add(key);
    const candidate = await resolveSimVehiclePath(root);
    if (candidate) return candidate;
    if (depth >= maxDepth) continue;
    try {
      const directory = await opendir(root);
      for await (const entry of directory) {
        inspected += 1;
        if (inspected > maxEntries || Date.now() >= deadline) break;
        if (!entry.isDirectory() || entry.isSymbolicLink() || excludedSearchDirectories.has(entry.name.toLowerCase())) continue;
        queue.push({ root: path.join(root, entry.name), depth: depth + 1 });
      }
    } catch {
      // Missing and inaccessible folders are expected during discovery.
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

function firstRuntimeScriptPath(value) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim())
    .find((line) => line.startsWith("/") && line.endsWith("/sim_vehicle.py"));
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

export async function wslDistributions() {
  if (process.platform !== "win32") return [];
  const result = await runFile("wsl.exe", ["--list", "--quiet"], 10000);
  return result.ok ? parseWslDistros(result.stdout) : [];
}

async function searchWsl(distros, requested) {
  for (const distro of distros) {
    if (requested?.distro && requested.distro.toLowerCase() !== distro.toLowerCase()) continue;
    const args = requested?.path
      ? ["-d", distro, "--exec", "bash", "-lc", runtimeCustomPathScript, "uav-lab", requested.path]
      : ["-d", distro, "--exec", "bash", "-lc", runtimeSearchScript];
    const result = await runFile("wsl.exe", args, 15000);
    const simPath = firstRuntimeScriptPath(result.stdout);
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
    const simPath = firstRuntimeScriptPath(result.stdout);
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

export function parseCustomRuntimePath(value) {
  const input = String(value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  const cygwin = input.match(/^cygwin:(\/.*)$/i);
  if (cygwin) return { source: "cygwin", path: cygwin[1] };
  const wslUrl = input.match(/^wsl:\/\/([^/]+)(\/.*)$/i);
  if (wslUrl) return { source: "wsl", distro: wslUrl[1], path: wslUrl[2] };
  const wslShort = input.match(/^([^:\\/]{2,}):(\/.*)$/);
  if (wslShort) return { source: "wsl", distro: wslShort[1], path: wslShort[2] };
  const wslUnc = input.match(/^\\\\wsl(?:\.localhost)?\$?\\([^\\]+)\\(.+)$/i);
  if (wslUnc) return { source: "wsl", distro: wslUnc[1], path: `/${wslUnc[2].replace(/\\/g, "/")}` };
  if (input.startsWith("/")) return { source: "posix", path: input };
  return { source: "native", path: input };
}

async function discoverSimVehicle(customPath) {
  const notes = [];
  const searched = [];
  let distros;

  if (customPath && String(customPath).trim()) {
    const requested = parseCustomRuntimePath(customPath);
    searched.push("configured location");
    if (requested.source === "native" || (requested.source === "posix" && process.platform !== "win32")) {
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
    notes.push("The configured location was not found; automatic discovery continued.");
  }

  searched.push("Native environment, PATH, and common checkout folders");
  const roots = [
    process.env.ARDUPILOT_HOME,
    process.env.ARDUPILOT_ROOT,
    path.join(os.homedir(), "ardupilot"),
    path.join(os.homedir(), "ArduPilot"),
    path.join(os.homedir(), "Documents", "ardupilot"),
    path.join(os.homedir(), "Desktop", "ardupilot"),
    path.join(os.homedir(), "Downloads", "ardupilot"),
    ...(process.platform === "win32" ? ["C:\\ardupilot", "C:\\ArduPilot"] : ["/opt/ardupilot"])
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = await resolveSimVehiclePath(root);
    if (candidate) return nativeDetection(candidate, searched, notes);
  }
  const onPath = await findOnPath("sim_vehicle.py");
  if (onPath && await exists(onPath)) return nativeDetection(onPath, searched, notes);

  searched.push("Bounded search of source, repos, projects, development, and home folders");
  const home = os.homedir();
  const nested = await searchNativeCheckouts([
    path.join(home, "source"), path.join(home, "repos"), path.join(home, "projects"),
    path.join(home, "development"), path.join(home, "Documents"), home
  ]);
  if (nested) return nativeDetection(nested, searched, notes);

  if (process.platform === "win32") {
    searched.push("Cygwin installations");
    const cygwin = await searchCygwin();
    if (cygwin) return { ...cygwin, notes, searched };

    searched.push("WSL distributions");
    distros ??= await wslDistributions();
    const wsl = await searchWsl(distros);
    if (wsl) return { ...wsl, notes, searched };
  }

  notes.push("Automatic search did not find sim_vehicle.py in the checked runtime locations.");
  notes.push("Locate the file or ArduPilot checkout and paste its path, for example C:\\ardupilot, wsl://Ubuntu/home/user/ardupilot, or cygwin:/home/user/ardupilot.");
  return { available: false, notes, searched };
}

/** Share concurrent UI/setup requests without caching results after discovery finishes. */
export function coalesceRuntimeDiscovery(discover) {
  const pending = new Map();
  return (customPath) => {
    const key = String(customPath ?? "").trim();
    if (!pending.has(key)) {
      const operation = Promise.resolve().then(() => discover(customPath)).finally(() => pending.delete(key));
      pending.set(key, operation);
    }
    return pending.get(key);
  };
}

const findSimVehicle = coalesceRuntimeDiscovery(discoverSimVehicle);

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

export function launcherFor(detection) {
  if (!detection?.available || !detection.path) {
    return { command: "sim_vehicle.py", prefixArgs: [], hostCwd: process.cwd(), displayCwd: process.cwd() };
  }
  if (detection.source === "wsl") {
    return {
      command: "wsl.exe",
      prefixArgs: ["-d", detection.distro, "--exec", "bash", "-lc", 'cd "$1" && shift && exec python3 "$@"', "uav-lab", detection.root, detection.path],
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
  const command = process.platform === "win32" ? "python" : "python3";
  return {
    command,
    prefixArgs: [detection.path],
    hostCwd: detection.root || process.cwd(),
    displayCwd: detection.root || process.cwd()
  };
}

export async function probeRuntimeDisplay(detection, run) {
  return runtimeDisplayStatus(detection, launcherFor({ ...detection, path: "-B", bashPath: detection.bashPath || detection.command }), run);
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

function batteryFailsafeAction(action, vehicle = "ArduCopter", critical = false) {
  // ArduPilot uses different numeric action enums for each vehicle firmware.
  const actions = {
    ArduCopter: { warn: ["Warn", 0], land: ["Land", 1], rtl: ["RTL", 2], smartrtl: ["SmartRTL", 3], terminate: ["Terminate", 5] },
    ArduPlane: { warn: ["Warn", 0], rtl: ["RTL", 1], land: ["Land", 2], terminate: ["Terminate", 3] },
    Rover: { warn: ["Warn", 0], rtl: ["RTL", 1], hold: ["Hold", 2], smartrtl: ["SmartRTL", 3], terminate: ["Terminate", 5] }
  };
  const requested = String(action ?? (critical ? vehicle === "Rover" ? "Hold" : "Land" : "Warn"));
  const normalized = requested.toLowerCase();
  const legacyAlias = vehicle === "Rover" && normalized === "land";
  const selected = actions[vehicle]?.[legacyAlias ? "hold" : normalized];
  if (!selected) throw invalidSetting(`${vehicle} does not support the ${requested} battery failsafe action. Choose an action supported by that vehicle.`);
  return { action: selected[0], value: selected[1], legacyAlias };
}

function batteryForExport(battery) {
  const metrics = batteryMetrics(battery?.data?.properties ?? {});
  const errors = metrics.issues.filter((issue) => issue.severity === "error");
  if (errors.length) throw invalidSetting(`Battery ${battery?.data?.label || "configuration"}: ${errors.map((issue) => issue.message).join(" ")}`);
  if (Math.fround(Number(batteryVoltageParameter(metrics.criticalVoltageV))) >= Math.fround(Number(batteryVoltageParameter(metrics.lowVoltageV)))) {
    throw invalidSetting("Battery low and critical voltage thresholds must remain distinct at ArduPilot parameter precision.");
  }
  return metrics;
}

function batteryVoltageParameter(value) {
  // Preserve editable per-cell thresholds; rounding to 0.1 V can collapse a
  // valid low/critical pair on a small pack into the same failsafe threshold.
  return String(Number(value.toFixed(6)));
}

function batteryReserveParameters(settings, capacity) {
  const lowPercent = Number(settings.batteryLowPercent ?? 20);
  const criticalPercent = Number(settings.batteryCriticalPercent ?? 10);
  if (!Number.isFinite(lowPercent) || !Number.isFinite(criticalPercent) || criticalPercent <= 0 || lowPercent > 100 || lowPercent <= criticalPercent) {
    throw invalidSetting("Battery reserve thresholds must satisfy 0 < critical < low ≤ 100%.");
  }
  const lowMah = Number((capacity * lowPercent / 100).toFixed(6));
  const criticalMah = Number((capacity * criticalPercent / 100).toFixed(6));
  if (criticalMah <= 0 || Math.fround(criticalMah) >= Math.fround(lowMah)) {
    throw invalidSetting("Battery low and critical capacity thresholds must remain positive and distinct at ArduPilot parameter precision.");
  }
  return { lowPercent, criticalPercent, lowMah, criticalMah };
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

function invalidSetting(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function runtimeHost(value, label) {
  const host = String(value ?? "127.0.0.1").trim();
  const validHostname = host.length <= 253 && host.split(".").every((part) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(part));
  if (!host || (isIP(host) !== 4 && (!validHostname || /^\d+\.\d+\.\d+\.\d+$/.test(host)))) {
    throw invalidSetting(`${label} must be an IPv4 address or hostname without a protocol, path, or port.`);
  }
  return host;
}

export function gcsOutputs(settings) {
  const targets = Array.isArray(settings.gcsTargets)
    ? settings.gcsTargets
    : [{ id: "legacy", name: "Ground station", enabled: true, host: settings.gcsHost ?? "127.0.0.1", port: settings.gcsPort ?? 14550 }];
  const seen = new Set();
  const outputs = [];

  for (const target of targets) {
    if (!target?.enabled) {
      continue;
    }

    const host = runtimeHost(target.host, "Ground-station host");
    const port = Number(target.port ?? 14550);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw invalidSetting("Ground-station UDP ports must be whole numbers between 1 and 65535.");
    }
    const key = `${host.toLowerCase()}:${port}`;
    if (seen.has(key)) {
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
  const batterySpec = batteryForExport(battery);
  const capacity = batterySpec.capacityMah;
  const lowAction = batteryFailsafeAction(settings.batteryFailsafeAction, settings.vehicle);
  const criticalAction = batteryFailsafeAction(settings.batteryCriticalAction, settings.vehicle, true);
  const { lowMah, criticalMah } = batteryReserveParameters(settings, capacity);
  const lowVoltage = batteryVoltageParameter(batterySpec.lowVoltageV);
  const criticalVoltage = batteryVoltageParameter(batterySpec.criticalVoltageV);
  const pwmType = pwmTypeFor(getProperty(esc, "protocol", "PWM"));

  const lines = [
    "# Generated by ArduPilot UAV Lab",
    `# Design: ${design.name}`,
    `# Components: ${design.nodes.length}`,
    `# Motors: ${motorCount}`,
    `# Scenario: ${settings.testScenario || "nominal"}`,
    `# Wind/Gust target: ${numberValue(settings.windSpeedMps, 0)} / ${numberValue(settings.windGustMps, 0)} m/s`,
    `# Battery: ${batterySpec.chemistry} ${batterySpec.seriesCells}S${batterySpec.parallelCells}P; total pack capacity ${capacity} mAh`,
    `# Battery nominal/full voltage: ${batterySpec.nominalVoltageV.toFixed(2)} / ${batterySpec.fullVoltageV.toFixed(2)} V; energy ${batterySpec.energyWh.toFixed(2)} Wh`,
    "# Low/critical voltage thresholds are editable lab starters, separate from charger settings and manufacturer discharge cutoffs.",
    `# Battery continuous current planning limit: ${batterySpec.continuousCurrentA.toFixed(2)} A`,
    `# Battery failsafe actions for ${settings.vehicle || "ArduCopter"}: low ${lowAction.action}; critical ${criticalAction.action}${lowAction.legacyAlias || criticalAction.legacyAlias ? " (legacy Rover Land selection maps to Hold)" : ""}`,
    "",
    "BATT_MONITOR,4",
    `BATT_CAPACITY,${capacity}`,
    `BATT_LOW_VOLT,${lowVoltage}`,
    `BATT_LOW_MAH,${lowMah}`,
    `BATT_FS_LOW_ACT,${lowAction.value}`,
    `BATT_CRT_VOLT,${criticalVoltage}`,
    `BATT_CRT_MAH,${criticalMah}`,
    `BATT_FS_CRT_ACT,${criticalAction.value}`,
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

/** Launch-only parameters; hardware exports must never inherit simulator state. */
export function generateSitlParamContent(design) {
  const hardware = generateParamContent(design);
  const settings = design.settings ?? {};
  const battery = batteryForExport(firstNode(design, "battery"));
  const lines = [
    "", "# Simulation-only battery initialization from the installed pack",
    `SIM_BATT_VOLTAGE,${batteryVoltageParameter(battery.fullVoltageV)}`,
    `SIM_BATT_CAP_AH,${battery.capacityAh}`
  ];
  // Native multicopter physics clips SIM_BATT_VOLTAGE to this frame maximum.
  // Heli, Plane and Rover initialize their battery directly from SIM_BATT_*.
  if ((settings.vehicle ?? "ArduCopter") === "ArduCopter" && settings.physicsBackend !== "json" && simulatorFrameForFrame(settings.frame || "quad-x") !== "heli") {
    lines.push(`SIM_FRM_BAT_VOLT,${batteryVoltageParameter(battery.fullVoltageV)}`, `SIM_FRM_BAT_CAP,${battery.capacityAh}`);
  }
  return `${hardware}${lines.join("\n")}\n`;
}

export function generateParamExplanation(design) {
  const settings = design.settings ?? {};
  const battery = firstNode(design, "battery");
  const esc = firstNode(design, "esc");
  const airspeed = firstNode(design, "airspeed-sensor");
  const opticalFlow = firstNode(design, "optical-flow");
  const parachute = firstNode(design, "parachute");
  const batterySpec = batteryForExport(battery);
  const capacity = batterySpec.capacityMah;
  const lowAction = batteryFailsafeAction(settings.batteryFailsafeAction, settings.vehicle);
  const criticalAction = batteryFailsafeAction(settings.batteryCriticalAction, settings.vehicle, true);
  const { lowPercent, criticalPercent, lowMah, criticalMah } = batteryReserveParameters(settings, capacity);
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
      reason: "Uses total pack capacity in mAh for remaining-capacity calculations. The parallel-cell count does not multiply this pack capacity again."
    },
    {
      parameter: "BATT_LOW_VOLT",
      value: batteryVoltageParameter(batterySpec.lowVoltageV),
      source: `${batterySpec.chemistry} ${batterySpec.seriesCells}S battery`,
      reason: `Uses the configured ${batterySpec.lowCellVoltageV} V per cell low threshold across ${batterySpec.seriesCells} series cells. Lab defaults are starter thresholds, not manufacturer discharge limits.`
    },
    {
      parameter: "BATT_LOW_MAH",
      value: String(lowMah),
      source: "Low reserve setting",
      reason: `Sets the low failsafe threshold to ${lowPercent}% of total pack capacity in remaining mAh. The failsafe triggers when remaining capacity falls below this value.`
    },
    {
      parameter: "BATT_FS_LOW_ACT",
      value: String(lowAction.value),
      source: "Low battery action",
      reason: lowAction.legacyAlias ? "The legacy Rover Land selection maps to Hold (2); Rover has no Land battery failsafe action." : `Maps ${lowAction.action} to the ${settings.vehicle || "ArduCopter"} low battery failsafe action value.`
    },
    {
      parameter: "BATT_CRT_VOLT",
      value: batteryVoltageParameter(batterySpec.criticalVoltageV),
      source: `${batterySpec.chemistry} ${batterySpec.seriesCells}S battery`,
      reason: `Uses the configured ${batterySpec.criticalCellVoltageV} V per cell critical threshold across ${batterySpec.seriesCells} series cells. Lab defaults are starter thresholds, not manufacturer discharge limits.`
    },
    {
      parameter: "BATT_CRT_MAH",
      value: String(criticalMah),
      source: "Critical reserve setting",
      reason: `Sets the critical failsafe threshold to ${criticalPercent}% of total pack capacity in remaining mAh. The failsafe triggers when remaining capacity falls below this value.`
    },
    {
      parameter: "BATT_FS_CRT_ACT",
      value: String(criticalAction.value),
      source: "Critical battery action",
      reason: criticalAction.legacyAlias ? "The legacy Rover Land selection maps to Hold (2); Rover has no Land battery failsafe action." : `Maps ${criticalAction.action} to the ${settings.vehicle || "ArduCopter"} critical battery failsafe action value.`
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

export async function writeParamFile(design, { simulator = false } = {}) {
  await mkdir(exportsDir, { recursive: true });
  const safeName = String(design.name || "uav-design")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const fileName = `${safeName || "uav-design"}${simulator ? ".sitl" : ""}.param`;
  const target = path.join(exportsDir, fileName);
  const content = simulator ? generateSitlParamContent(design) : generateParamContent(design);
  await writeFile(target, content, "utf8");
  return { fileName, path: target, content };
}

export function labTelemetryPort(settings, listener) {
  const port = Number(listener?.active ? listener.port : settings.labTelemetryPort ?? 14552);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw invalidSetting("Lab telemetry UDP port must be a whole number between 1024 and 65535.");
  }
  return port;
}

export async function telemetryHostFor(detection, run = runFile) {
  if (detection.source !== "wsl") return "127.0.0.1";
  const mode = await run("wsl.exe", ["-d", detection.distro, "--exec", "wslinfo", "--networking-mode"], 10000);
  if (mode.ok && mode.stdout.trim() === "mirrored") return "127.0.0.1";
  const routes = await run("wsl.exe", ["-d", detection.distro, "--exec", "ip", "-j", "route", "show", "default"], 10000);
  try {
    const gateway = JSON.parse(routes.stdout).find((route) => isIP(route.gateway) === 4)?.gateway;
    if (routes.ok && gateway) return gateway;
  } catch { /* Report a connection-specific error instead of assuming loopback works across NAT. */ }
  throw Object.assign(new Error("Could not find the Windows telemetry address from WSL. Check WSL networking and run Auto-detect again."), { statusCode: 409 });
}

export function sitlWindowArgs(settings) {
  if (settings.sitlHeadless !== undefined && typeof settings.sitlHeadless !== "boolean") {
    throw invalidSetting("Headless SITL must be enabled or disabled.");
  }
  if (settings.sitlRebuild !== undefined && typeof settings.sitlRebuild !== "boolean") {
    throw invalidSetting("SITL rebuild must be enabled or disabled.");
  }
  if (settings.sitlWipeOnLaunch !== undefined && typeof settings.sitlWipeOnLaunch !== "boolean") {
    throw invalidSetting("SITL EEPROM wipe must be enabled or disabled.");
  }
  return [
    ...(settings.sitlHeadless === false ? ["--console", "--map"] : []),
    ...(settings.sitlRebuild === false ? ["--no-rebuild"] : []),
    ...(settings.sitlWipeOnLaunch === true ? ["--wipe-eeprom"] : []),
    "--no-extra-ports", "--no-wsl2-network"
  ];
}

export async function buildSitlPlan(design, { telemetryListener } = {}) {
  const settings = design.settings ?? {};
  const groundStations = gcsOutputs(settings);
  const gcsBridge = { tcp: gcsBridgeOptions(settings), outputs: groundStations };
  const port = labTelemetryPort(settings, telemetryListener);
  if (groundStations.some((output) => output.port === port && ["127.0.0.1", "localhost", "0.0.0.0"].includes(output.host.toLowerCase()))) {
    throw invalidSetting("The lab telemetry reader and a GCS cannot use the same local UDP port. Keep the lab on 14552 and use 14550 or 14551 for ground stations.");
  }
  const windowArgs = sitlWindowArgs(settings);
  const jsonHost = settings.physicsBackend === "json" ? runtimeHost(settings.jsonHost, "JSON physics host") : undefined;
  const speedup = Number(settings.speedup ?? 1);
  if (!Number.isFinite(speedup) || speedup <= 0) {
    throw invalidSetting("Simulation speed must be a finite number greater than zero.");
  }
  const detection = await findSimVehicle(settings.simVehiclePath);
  let display;
  if (detection.available && settings.sitlHeadless === false) {
    display = await probeRuntimeDisplay(detection);
    requireRuntimeDisplay(detection, display);
  }
  const telemetry = { host: await telemetryHostFor(detection), port };
  telemetry.bindHost = telemetry.host === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
  // MAVProxy sends to the lab's one UDP listener. The Windows server relays to
  // local GCS ports, so WSL NAT and MAVProxy's ownership of TCP 5760 cannot steal
  // Mission Planner's UDP or TCP connection.
  const outputs = [...groundStations, { id: "uav-lab", name: "UAV Lab telemetry", host: telemetry.host, port }];
  const vehicle = settings.vehicle || "ArduCopter";
  const selectedFrame = settings.frame || "quad-x";
  const frame =
    settings.physicsBackend === "json"
      ? `JSON:${jsonHost}`
      : simulatorFrameForFrame(selectedFrame);
  const paramFile = await writeParamFile(design, { simulator: true });
  const launcher = launcherFor(detection);
  const runtimeParamFile = await runtimePathFor(paramFile.path, detection);
  const swarm = buildSwarmLayout(settings);

  const args = [
    ...launcher.prefixArgs,
    "-v",
    vehicle,
    "-f",
    frame,
    ...windowArgs,
    `--add-param-file=${runtimeParamFile}`,
    `--out=udp:${telemetry.host}:${telemetry.port}`
  ];

  if (swarm.count > 1) {
    args.push(`--count=${swarm.count}`, "--auto-sysid");
  }

  if (speedup !== 1) {
    args.push(`--speedup=${speedup}`);
  }

  if (settings.locationName) {
    args.push("-L", settings.locationName);
  }

  const commandLine = [launcher.command, ...args].map(shellQuote).join(" ");
  const cwd = launcher.hostCwd;
  const notes = [...detection.notes];
  const batterySpec = batteryForExport(firstNode(design, "battery"));
  notes.push(`SITL battery starts at ${Number(batterySpec.fullVoltageV.toFixed(3))} V with ${batterySpec.capacityAh} Ah, matching the installed pack. Stop and relaunch SITL after changing the battery; a triggered ArduPilot battery failsafe remains latched until reboot.`);
  notes.push(settings.sitlHeadless === false
    ? "External map and console windows are requested. The ArduPilot terminal opens visibly instead of starting minimized."
    : "External windows are disabled. View MAVProxy output in the lab's embedded console, or uncheck Run without external windows before launching.");

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
    // Report the actions the parameter file actually contains, including defaults and legacy aliases.
    const lowAction = batteryFailsafeAction(settings.batteryFailsafeAction, vehicle);
    const criticalAction = batteryFailsafeAction(settings.batteryCriticalAction, vehicle, true);
    notes.push(
      `Battery failsafe export uses low ${numberValue(settings.batteryLowPercent, 20)}% -> ${lowAction.action}, critical ${numberValue(settings.batteryCriticalPercent, 10)}% -> ${criticalAction.action}.`
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

  if (groundStations.length === 0) {
    notes.push("No ground-station UDP outputs are enabled.");
  } else {
    notes.push(...groundStations.map((output) => `${output.name} UDP output from the lab: ${output.host}:${output.port}`));
  }
  notes.push(`Mission Planner TCP: ${gcsBridge.tcp.host}:${gcsBridge.tcp.port}; the relay stays connected when SITL is reset. UDP: listen on an enabled GCS output port, or use UDPCl to 127.0.0.1:${port}. Mission Planner AutoConnect listens on UDP 14550 and 14551 together, so keep only one of those enabled for it; each port can belong to only one ground station.`);
  notes.push("Do not connect Mission Planner to TCP 5760: MAVProxy owns that simulator port, so Mission Planner connects but never receives a heartbeat.");

  return {
    available: detection.available,
    source: detection.source,
    distro: detection.distro,
    telemetry,
    gcsBridge,
    headless: settings.sitlHeadless !== false,
    display,
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
        ? [...detection.notes, `Found sim_vehicle.py in ${detection.source === "wsl" ? `WSL ${detection.distro}` : detection.source}.`]
        : detection.notes
    }
  };
}
