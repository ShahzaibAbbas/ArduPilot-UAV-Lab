import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { runOwnedFile as execFileAsync } from "./processLifecycle.js";
import { getSystemStatus, launcherFor, probeRuntimeDisplay } from "./sitl.js";

const probeMarker = "UAV_LAB_DIAGNOSTICS=";
const pythonProbeScript = [
  "import importlib, json, shutil, sys",
  "modules = {}",
  "for name in ('MAVProxy', 'pymavlink'):",
  "    try:",
  "        importlib.import_module(name)",
  "        modules[name] = True",
  "    except Exception:",
  "        modules[name] = False",
  `print('${probeMarker}' + json.dumps({'python': sys.version.split()[0], 'python3': sys.version_info.major == 3, 'modules': modules, 'mavproxyExecutable': shutil.which('mavproxy.py') is not None}))`
].join("\n");

export function setupRuntimeProbeCommand(runtime) {
  // Use the same interpreter, working directory and login environment as Launch
  // SITL. The probe replaces only the script argument; no simulation is started.
  const launcher = launcherFor({ ...runtime, path: "-B", bashPath: runtime.command });
  return {
    command: launcher.command,
    args: [...launcher.prefixArgs, "-c", pythonProbeScript],
    cwd: launcher.hostCwd
  };
}

async function probeSitlRuntime(runtime, runCommand) {
  if (!runtime.available) return { python: false, mavproxy: false, pymavlink: false, detail: "Locate an ArduPilot runtime before checking its launch dependencies." };
  try {
    const invocation = setupRuntimeProbeCommand(runtime);
    const { stdout } = await runCommand(invocation.command, invocation.args, {
      cwd: invocation.cwd, windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024
    });
    const line = String(stdout).split(/\r?\n/).find((entry) => entry.startsWith(probeMarker));
    const result = JSON.parse(line?.slice(probeMarker.length) ?? "null");
    if (!result || typeof result.python !== "string" || !result.modules) throw new Error("Invalid diagnostic response");
    return {
      python: result.python3 === true,
      version: result.python.slice(0, 40),
      mavproxy: result.modules.MAVProxy === true && result.mavproxyExecutable === true,
      pymavlink: result.modules.pymavlink === true,
      detail: result.modules.MAVProxy !== true ? "MAVProxy could not be imported in the SITL runtime"
        : "MAVProxy launcher is not available on the SITL runtime PATH"
    };
  } catch {
    return { python: false, mavproxy: false, pymavlink: false, detail: "The selected SITL interpreter could not complete its dependency probe. Check the runtime login environment and Python installation." };
  }
}

async function commandVersion(command, args = ["--version"], options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      timeout: options.timeoutMs ?? 8000,
      maxBuffer: 1024 * 1024,
      ...options
    });
    const output = [stdout, stderr].join("\n").replace(/\0/g, "");
    return {
      available: true,
      command,
      version: output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
    };
  } catch (error) {
    return {
      available: false,
      command,
      error: error?.killed
        ? `${command} did not respond within the diagnostic timeout.`
        : `${command} is unavailable or could not run. Check its installation and PATH.`
    };
  }
}

async function pathExists(target) {
  try {
    await access(target, constants.W_OK);
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function prepareLocalFolders(projectRoot) {
  await Promise.all(["data", "data/designs", "data/exports", "data/logs"].map((folder) =>
    mkdir(path.join(projectRoot, folder), { recursive: true })
  ));
}

function fixFor(key, platform) {
  const windows = platform === "win32";
  const fixes = {
    node: windows ? "Install Node.js 18+ with winget install OpenJS.NodeJS.LTS." : "Install Node.js 18+ through apt, NodeSource, Homebrew, or nvm.",
    npm: "Reinstall Node.js or make sure npm is available on PATH.",
    git: windows ? "Install Git for Windows and reopen the launcher." : "Install git with your package manager.",
    python: windows ? "Install Python 3 and enable Add python.exe to PATH." : "Install python3 with your package manager.",
    mavproxy: "Install MAVProxy with pip once Python is available: python -m pip install MAVProxy.",
    simVehicle: "Locate sim_vehicle.py or an ArduPilot checkout. The lab searches Windows paths, Cygwin, and every user WSL distribution automatically.",
    wsl: "Install WSL2 from an elevated PowerShell with wsl --install if you plan to run ArduPilot SITL from Linux on Windows.",
    dataFolders: "Restart the app and check write permissions for the data folder and available disk space."
  };
  return fixes[key];
}

export async function setupDiagnostics(projectRoot, {
  simVehiclePath, platform = process.platform, getStatus = getSystemStatus, versionCommand = commandVersion,
  runCommand = execFileAsync, folderExists = pathExists, displayProbe = probeRuntimeDisplay
} = {}) {
  const [node, npm, git, python, python3, pythonLauncher, mavproxy, wsl, sitl] = await Promise.all([
    Promise.resolve({ available: Number(process.versions.node.split(".")[0]) >= 18, command: "node", version: process.version }),
    versionCommand("npm", ["--version"], platform === "win32" ? { shell: true } : {}),
    versionCommand("git", ["--version"]),
    versionCommand(platform === "win32" ? "python" : "python3", ["--version"]),
    versionCommand("python3", ["--version"]),
    platform === "win32" ? versionCommand("py", ["-3", "--version"]) : Promise.resolve({ available: false }),
    versionCommand("mavproxy.py", ["--version"], platform === "win32" ? { shell: true } : {}),
    platform === "win32" ? versionCommand("wsl", ["--status"]) : Promise.resolve({ available: true, command: "wsl", version: "Not required on this platform" }),
    getStatus(simVehiclePath)
  ]);
  const runtime = sitl.sitl;
  const runtimeLabel = runtime.source === "wsl" ? `WSL ${runtime.distro}` : runtime.source === "cygwin" ? "Cygwin" : "native";
  const dependencies = await probeSitlRuntime(runtime, runCommand);
  const display = await displayProbe(runtime, runCommand);
  const dependencyFix = `Install ArduPilot prerequisites and MAVProxy in the ${runtimeLabel} environment used by Launch SITL, then run diagnostics again.`;
  const folders = {
    data: await folderExists(path.join(projectRoot, "data")),
    exports: await folderExists(path.join(projectRoot, "data", "exports")),
    backups: await folderExists(path.join(projectRoot, "backups"))
  };
  const pythonTool = python.available ? python : python3.available ? python3 : pythonLauncher.available ? pythonLauncher : python;
  const checks = [
    {
      id: "node",
      label: "Node.js",
      ok: node.available,
      detail: node.version ?? node.error,
      fix: node.available ? undefined : fixFor("node", process.platform)
    },
    {
      id: "npm",
      label: "npm",
      ok: npm.available,
      detail: npm.version ?? npm.error,
      fix: npm.available ? undefined : fixFor("npm", process.platform)
    },
    {
      id: "git",
      label: "Git",
      ok: git.available,
      detail: git.version ?? git.error,
      fix: git.available ? undefined : fixFor("git", process.platform)
    },
    {
      id: "hostPython",
      label: "Host Python (optional)",
      required: false,
      ok: pythonTool.available,
      detail: pythonTool.version ?? pythonTool.error,
      fix: pythonTool.available ? undefined : fixFor("python", process.platform)
    },
    {
      id: "hostMavproxy",
      label: "Host MAVProxy (optional)",
      required: false,
      ok: mavproxy.available,
      detail: mavproxy.version ?? mavproxy.error,
      fix: mavproxy.available ? undefined : fixFor("mavproxy", process.platform)
    },
    {
      id: "python", label: `SITL Python · ${runtimeLabel}`, ok: dependencies.python,
      detail: dependencies.python ? `Python ${dependencies.version} in the selected launch environment` : dependencies.detail,
      fix: dependencies.python ? undefined : dependencyFix
    },
    {
      id: "mavproxy", label: `SITL MAVProxy · ${runtimeLabel}`, ok: dependencies.mavproxy,
      detail: dependencies.mavproxy ? "MAVProxy imports successfully and mavproxy.py is on PATH" : dependencies.detail,
      fix: dependencies.mavproxy ? undefined : dependencyFix
    },
    {
      id: "pymavlink", label: `SITL pymavlink · ${runtimeLabel}`, ok: dependencies.pymavlink,
      detail: dependencies.pymavlink ? "pymavlink imports successfully" : "pymavlink could not be imported in the selected launch environment",
      fix: dependencies.pymavlink ? undefined : dependencyFix
    },
    {
      id: "sitlGui", label: `External SITL windows · ${runtimeLabel}`, required: false,
      ok: display.available,
      detail: display.available ? `wxPython GUI connection is available${display.display ? ` (DISPLAY=${display.display})` : ""}` : display.reason,
      fix: display.available ? undefined : runtime.source === "wsl"
        ? `Check WSLg in ${runtime.distro} and wxPython in the SITL interpreter. Remove stale DISPLAY overrides from shell startup files. Run wsl --update from Windows if WSLg needs repair; restart WSL after stopping other WSL work. Headless SITL remains available.`
        : "Install wxPython and check the selected runtime's GUI display. Headless SITL remains available."
    },
    {
      id: "simVehicle",
      label: "sim_vehicle.py",
      ok: sitl.sitl.available,
      detail: sitl.sitl.path ?? sitl.sitl.notes[0],
      fix: sitl.sitl.available ? undefined : fixFor("simVehicle", process.platform)
    },
    {
      id: "wsl",
      label: "WSL2",
      required: runtime.source === "wsl",
      ok: Boolean(wsl.available),
      detail: wsl.version ?? wsl.error,
      fix: wsl.available ? undefined : fixFor("wsl", process.platform)
    },
    {
      id: "dataFolders",
      label: "Local folders",
      ok: folders.data && folders.exports,
      detail: Object.entries(folders)
        .map(([name, exists]) => `${name}: ${exists ? "writable" : name === "backups" ? "not created (optional)" : "missing or not writable"}`)
        .join(", "),
      fix: folders.data && folders.exports ? undefined : fixFor("dataFolders", process.platform)
    }
  ];

  return {
    platform,
    ready: checks.every((check) => check.ok || check.required === false),
    checks
  };
}
