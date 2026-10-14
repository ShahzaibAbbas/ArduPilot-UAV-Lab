import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runOwnedFile as execFileAsync } from "./processLifecycle.js";
import { generateGazeboPluginFiles } from "./artifacts.js";
import { windowsPathToWslPath, wslDistributions } from "./sitl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const gazeboProjectsDir = path.join(dataDir, "gazebo-plugins");
const maxOutput = 1024 * 1024 * 6;
const packageCandidates = [
  { kind: "classic", packageName: "gazebo", label: "Gazebo Classic" },
  { kind: "gz-sim", packageName: "gz-sim9", label: "Gazebo Sim 9" },
  { kind: "gz-sim", packageName: "gz-sim8", label: "Gazebo Sim 8" },
  { kind: "gz-sim", packageName: "gz-sim7", label: "Gazebo Sim 7" },
  { kind: "gz-sim", packageName: "gz-sim6", label: "Gazebo Sim 6" },
  { kind: "gz-sim", packageName: "ignition-gazebo6", label: "Ignition Gazebo 6" }
];

function safeFileName(value, fallback = "uav-design") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

async function run(command, args, options = {}) {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: maxOutput,
      timeout: options.timeoutMs ?? 20000,
      ...options
    });
    return {
      command: [command, ...args].join(" "),
      exitCode: 0,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      command: [command, ...args].join(" "),
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr || error.message || "",
      durationMs: Date.now() - startedAt
    };
  }
}

export function gazeboRuntimeCommand(runtime, command, args) {
  return runtime.source === "wsl"
    ? { command: "wsl.exe", args: ["-d", runtime.distro, "--exec", "bash", "-lc", 'exec "$@"', "uav-lab", command, ...args] }
    : { command, args };
}

function runtimeRunner(runtime, runCommand) {
  return (command, args, options) => {
    const invocation = gazeboRuntimeCommand(runtime, command, args);
    return runCommand(invocation.command, invocation.args, options);
  };
}

async function toolAvailable(execute, command, args = ["--version"]) {
  const result = await execute(command, args, { timeoutMs: 8000 });
  const output = [result.stdout, result.stderr].join("\n");
  return {
    // MSVC prints its version and exits with code 2 when no source file is supplied.
    available: result.exitCode === 0 || (command === "cl" && /Microsoft.*C\/C\+\+.*Compiler/i.test(output)),
    command,
    version: output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
  };
}

async function pkgConfigPackage(execute, candidate) {
  const exists = await execute("pkg-config", ["--exists", candidate.packageName], { timeoutMs: 8000 });
  if (exists.exitCode !== 0) {
    return { ...candidate, available: false };
  }

  const version = await execute("pkg-config", ["--modversion", candidate.packageName], { timeoutMs: 8000 });
  return {
    ...candidate,
    available: true,
    version: version.exitCode === 0 ? version.stdout.trim() : undefined
  };
}

async function probeGazeboRuntime(runtime, platform, runCommand) {
  const execute = runtimeRunner(runtime, runCommand);
  const compilerCommand = runtime.source === "native" && platform === "win32" ? "cl" : "c++";
  const [cmake, pkgConfig, compiler, gz, gazebo] = await Promise.all([
    toolAvailable(execute, "cmake"),
    toolAvailable(execute, "pkg-config"),
    toolAvailable(execute, compilerCommand, compilerCommand === "cl" ? [] : ["--version"]),
    toolAvailable(execute, "gz", ["sim", "--versions"]),
    toolAvailable(execute, "gazebo", ["--version"])
  ]);
  const packages = pkgConfig.available ? await Promise.all(packageCandidates.map((candidate) => pkgConfigPackage(execute, candidate))) : packageCandidates.map((candidate) => ({ ...candidate, available: false }));
  const selected = packages.find((entry) => entry.available);
  const notes = [];

  if (!cmake.available) {
    notes.push("CMake was not found on PATH.");
  }
  if (!pkgConfig.available) {
    notes.push("pkg-config was not found on PATH.");
  }
  if (!compiler.available) {
    notes.push(compilerCommand === "cl" ? "MSVC cl was not found on PATH. Start the app from a Developer Command Prompt or install the toolchain in WSL." : "A C++ compiler was not found on PATH.");
  }
  if (!selected) {
    notes.push("No supported Gazebo pkg-config package was found: gazebo, gz-sim9, gz-sim8, gz-sim7, gz-sim6, or ignition-gazebo6.");
  }

  return {
    ...runtime,
    supported: Boolean(cmake.available && pkgConfig.available && compiler.available && selected),
    selected,
    tools: { cmake, pkgConfig, compiler, gz, gazebo },
    packages,
    notes
  };
}

export async function gazeboStatus({ platform = process.platform, runCommand = run, listDistributions = wslDistributions } = {}) {
  const native = await probeGazeboRuntime({ source: "native" }, platform, runCommand);
  const searched = ["Native PATH and pkg-config packages"];
  if (native.supported || platform !== "win32") return { ...native, searched };

  // Probe a bounded number concurrently so a broken distro does not block all discovery.
  const distros = [...new Set(await listDistributions())].slice(0, 8);
  const results = await Promise.all(distros.map((distro) => probeGazeboRuntime({ source: "wsl", distro }, platform, runCommand)));
  searched.push(...distros.map((distro) => `WSL ${distro}`));
  const selected = results.find((result) => result.supported) ?? results.find((result) => result.selected) ?? native;
  return {
    ...selected,
    searched,
    notes: selected.source === "wsl"
      ? [`Gazebo toolchain detected in WSL ${selected.distro}. Builds run in that distribution.`, ...selected.notes]
      : [...selected.notes, ...(distros.length ? ["The checked WSL distributions also lack a complete Gazebo build toolchain."] : [])]
  };
}

export async function prepareGazeboPluginProject(design) {
  const projectName = safeFileName(design.name);
  const projectDir = path.join(gazeboProjectsDir, projectName);
  const files = generateGazeboPluginFiles(design);

  await mkdir(projectDir, { recursive: true });
  for (const file of files) {
    const target = path.join(projectDir, ...file.name.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }

  return {
    projectDir,
    files: files.map((file) => file.name)
  };
}

export async function compileGazeboPlugins(design, { getStatus = gazeboStatus, prepareProject = prepareGazeboPluginProject, runCommand = run } = {}) {
  const status = await getStatus();
  const project = await prepareProject(design);
  // CMake caches contain runtime-specific paths; never reuse a native cache in WSL.
  const buildSuffix = status.source === "wsl" ? `build-wsl-${safeFileName(status.distro, "default")}` : "build";
  const buildDir = path.join(project.projectDir, buildSuffix);
  const steps = [];

  if (!status.supported || !status.selected) {
    return {
      compiled: false,
      status,
      projectDir: project.projectDir,
      buildDir,
      files: project.files,
      steps,
      message: status.notes[0] ?? "Gazebo plugin project generated, but this install is not supported for direct compilation."
    };
  }

  await mkdir(buildDir, { recursive: true });
  const execute = runtimeRunner(status, runCommand);
  const runtimePath = async (target) => {
    if (status.source !== "wsl") return target;
    const converted = await execute("wslpath", ["-a", "-u", target], { timeoutMs: 5000 });
    const resolved = converted.exitCode === 0 ? String(converted.stdout).trim() : "";
    return resolved.startsWith("/") && !resolved.includes("\n") ? resolved : windowsPathToWslPath(target);
  };
  const runtimeProjectDir = await runtimePath(project.projectDir);
  const runtimeBuildDir = await runtimePath(buildDir);
  steps.push(
    await execute(
      "cmake",
      [
        "-S",
        runtimeProjectDir,
        "-B",
        runtimeBuildDir,
        `-DUAV_LAB_GAZEBO_PACKAGE=${status.selected.packageName}`,
        `-DUAV_LAB_GAZEBO_TARGET=${status.selected.kind}`
      ],
      { timeoutMs: 120000 }
    )
  );

  if (steps.at(-1).exitCode === 0) {
    steps.push(await execute("cmake", ["--build", runtimeBuildDir, "--config", "Release"], { timeoutMs: 180000 }));
  }

  const compiled = steps.length > 0 && steps.every((step) => step.exitCode === 0);
  return {
    compiled,
    status,
    projectDir: project.projectDir,
    buildDir,
    files: project.files,
    steps,
    message: compiled
      ? `Gazebo plugins compiled for ${status.selected.label}.`
      : "Gazebo plugin project generated, but compilation failed. Check the build output and installed Gazebo dev packages."
  };
}
