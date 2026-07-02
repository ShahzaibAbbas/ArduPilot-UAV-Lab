import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { generateGazeboPluginFiles } from "./artifacts.js";

const execFileAsync = promisify(execFile);
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

async function toolAvailable(command, args = ["--version"]) {
  const result = await run(command, args, { timeoutMs: 8000 });
  return {
    available: result.exitCode === 0,
    command,
    version: [result.stdout, result.stderr]
      .join("\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
  };
}

async function pkgConfigPackage(candidate) {
  const exists = await run("pkg-config", ["--exists", candidate.packageName], { timeoutMs: 8000 });
  if (exists.exitCode !== 0) {
    return { ...candidate, available: false };
  }

  const version = await run("pkg-config", ["--modversion", candidate.packageName], { timeoutMs: 8000 });
  return {
    ...candidate,
    available: true,
    version: version.exitCode === 0 ? version.stdout.trim() : undefined
  };
}

export async function gazeboStatus() {
  const [cmake, pkgConfig, compiler, gz, gazebo] = await Promise.all([
    toolAvailable("cmake"),
    toolAvailable("pkg-config"),
    toolAvailable(process.platform === "win32" ? "cl" : "c++"),
    toolAvailable("gz", ["--version"]),
    toolAvailable("gazebo", ["--version"])
  ]);
  const packages = pkgConfig.available ? await Promise.all(packageCandidates.map(pkgConfigPackage)) : packageCandidates.map((candidate) => ({ ...candidate, available: false }));
  const selected = packages.find((entry) => entry.available);
  const notes = [];

  if (!cmake.available) {
    notes.push("CMake was not found on PATH.");
  }
  if (!pkgConfig.available) {
    notes.push("pkg-config was not found on PATH.");
  }
  if (!compiler.available) {
    notes.push(process.platform === "win32" ? "MSVC cl was not found on PATH." : "A C++ compiler was not found on PATH.");
  }
  if (!selected) {
    notes.push("No supported Gazebo pkg-config package was found: gazebo, gz-sim9, gz-sim8, gz-sim7, gz-sim6, or ignition-gazebo6.");
  }

  return {
    supported: Boolean(cmake.available && pkgConfig.available && compiler.available && selected),
    selected,
    tools: { cmake, pkgConfig, compiler, gz, gazebo },
    packages,
    notes
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

export async function compileGazeboPlugins(design) {
  const status = await gazeboStatus();
  const project = await prepareGazeboPluginProject(design);
  const buildDir = path.join(project.projectDir, "build");
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
  steps.push(
    await run(
      "cmake",
      [
        "-S",
        project.projectDir,
        "-B",
        buildDir,
        `-DUAV_LAB_GAZEBO_PACKAGE=${status.selected.packageName}`,
        `-DUAV_LAB_GAZEBO_TARGET=${status.selected.kind}`
      ],
      { timeoutMs: 120000 }
    )
  );

  if (steps.at(-1).exitCode === 0) {
    steps.push(await run("cmake", ["--build", buildDir, "--config", "Release"], { timeoutMs: 180000 }));
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
