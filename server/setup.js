import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getSystemStatus } from "./sitl.js";

const execFileAsync = promisify(execFile);

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
      error: error?.message ?? `${command} was not found`
    };
  }
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function fixFor(key, platform) {
  const windows = platform === "win32";
  const fixes = {
    node: windows ? "Install Node.js 18+ with winget install OpenJS.NodeJS.LTS." : "Install Node.js 18+ through apt, NodeSource, Homebrew, or nvm.",
    npm: "Reinstall Node.js or make sure npm is available on PATH.",
    git: windows ? "Install Git for Windows and reopen the launcher." : "Install git with your package manager.",
    python: windows ? "Install Python 3 and enable Add python.exe to PATH." : "Install python3 with your package manager.",
    mavproxy: "Install MAVProxy with pip once Python is available: python -m pip install MAVProxy.",
    simVehicle: "Set ARDUPILOT_HOME or ARDUPILOT_ROOT to an ArduPilot checkout, or put Tools/autotest on PATH.",
    wsl: "Install WSL2 from an elevated PowerShell with wsl --install if you plan to run ArduPilot SITL from Linux on Windows.",
    dataFolders: "Run the app launcher once; it creates data, exports, logs, and backup folders."
  };
  return fixes[key];
}

export async function setupDiagnostics(projectRoot) {
  const [node, npm, git, python, python3, mavproxy, wsl, sitl] = await Promise.all([
    commandVersion("node", ["--version"]),
    commandVersion("npm", ["--version"], process.platform === "win32" ? { shell: true } : {}),
    commandVersion("git", ["--version"]),
    commandVersion(process.platform === "win32" ? "python" : "python3", ["--version"]),
    commandVersion("python3", ["--version"]),
    commandVersion("mavproxy.py", ["--version"], process.platform === "win32" ? { shell: true } : {}),
    process.platform === "win32" ? commandVersion("wsl", ["--status"]) : Promise.resolve({ available: true, command: "wsl", version: "Not required on this platform" }),
    getSystemStatus()
  ]);
  const folders = {
    data: await pathExists(path.join(projectRoot, "data")),
    exports: await pathExists(path.join(projectRoot, "data", "exports")),
    backups: await pathExists(path.join(projectRoot, "backups"))
  };
  const pythonTool = python.available ? python : python3;
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
      id: "python",
      label: "Python",
      ok: pythonTool.available,
      detail: pythonTool.version ?? pythonTool.error,
      fix: pythonTool.available ? undefined : fixFor("python", process.platform)
    },
    {
      id: "mavproxy",
      label: "MAVProxy",
      ok: mavproxy.available,
      detail: mavproxy.version ?? mavproxy.error,
      fix: mavproxy.available ? undefined : fixFor("mavproxy", process.platform)
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
      ok: Boolean(wsl.available),
      detail: wsl.version ?? wsl.error,
      fix: wsl.available ? undefined : fixFor("wsl", process.platform)
    },
    {
      id: "dataFolders",
      label: "Local folders",
      ok: folders.data && folders.exports,
      detail: Object.entries(folders)
        .map(([name, exists]) => `${name}: ${exists ? "ok" : "missing"}`)
        .join(", "),
      fix: folders.data && folders.exports ? undefined : fixFor("dataFolders", process.platform)
    }
  ];

  return {
    platform: process.platform,
    ready: checks.every((check) => check.ok || check.id === "mavproxy" || check.id === "wsl"),
    checks
  };
}
