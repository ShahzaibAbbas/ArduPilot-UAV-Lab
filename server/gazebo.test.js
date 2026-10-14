import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileGazeboPlugins, gazeboRuntimeCommand, gazeboStatus } from "./gazebo.js";

const result = (exitCode = 0, stdout = "", stderr = "") => ({ exitCode, stdout, stderr, durationMs: 0 });

function probeRunner(availableIn = "native", { compilerMissing = false } = {}) {
  return async (command, args) => {
    const runtime = command === "wsl.exe" ? args[1] : "native";
    if (command === "wsl.exe") {
      command = args[7];
      args = args.slice(8);
    }
    if (runtime !== availableIn) return result(1);
    if (command === "cl") return compilerMissing ? result(1, "", "not found") : result(2, "", "Microsoft (R) C/C++ Optimizing Compiler Version 19.44 for x64");
    if (command === "c++") return result(compilerMissing ? 1 : 0, "c++ 13.2");
    if (command === "pkg-config" && args[0] === "--exists") return result(args[1] === "gz-sim8" ? 0 : 1);
    if (command === "pkg-config" && args[0] === "--modversion") return result(0, "8.9.0\n");
    return result(0, `${command} version\n`);
  };
}

test("recognizes MSVC's version banner despite its no-input exit code", async () => {
  const status = await gazeboStatus({
    platform: "win32", runCommand: probeRunner(),
    listDistributions: async () => { throw new Error("Working native runtime must not launch WSL discovery"); }
  });
  assert.equal(status.supported, true);
  assert.equal(status.source, "native");
  assert.equal(status.tools.compiler.available, true);
  assert.equal(status.selected.packageName, "gz-sim8");
});

test("detects a complete WSL Gazebo toolchain when native tooling is unavailable", async () => {
  const status = await gazeboStatus({ platform: "win32", runCommand: probeRunner("Ubuntu"), listDistributions: async () => ["Debian", "Ubuntu"] });
  assert.equal(status.supported, true);
  assert.equal(status.source, "wsl");
  assert.equal(status.distro, "Ubuntu");
  assert.equal(status.tools.compiler.command, "c++");
  assert.equal(status.selected.version, "8.9.0");
  assert.ok(status.searched.includes("WSL Debian"));
  assert.ok(status.notes.some((note) => note.includes("Builds run in that distribution")));
});

test("keeps missing compiler actionable and does not call the runtime build-ready", async () => {
  const status = await gazeboStatus({ platform: "linux", runCommand: probeRunner("native", { compilerMissing: true }) });
  assert.equal(status.supported, false);
  assert.equal(status.tools.compiler.available, false);
  assert.ok(status.notes.some((note) => note.includes("C++ compiler")));
});

test("keeps WSL paths and shell metacharacters as positional command arguments", () => {
  const runtime = { source: "wsl", distro: "Ubuntu" };
  const source = "/mnt/c/Projects/UAV Lab $(literal)/source";
  const invocation = gazeboRuntimeCommand(runtime, "cmake", ["-S", source]);
  assert.equal(invocation.command, "wsl.exe");
  assert.deepEqual(invocation.args.slice(-3), ["cmake", "-S", source]);
  assert.equal(invocation.args[5], 'exec "$@"');
  assert.ok(!invocation.args[5].includes(source));
});

test("configures and builds inside the detected WSL distro with translated paths", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "uav-gazebo-build-"));
  const calls = [];
  try {
    const compiled = await compileGazeboPlugins({}, {
      getStatus: async () => ({ source: "wsl", distro: "Ubuntu", supported: true, selected: { kind: "gz-sim", packageName: "gz-sim8", label: "Gazebo Sim 8" } }),
      prepareProject: async () => ({ projectDir, files: ["CMakeLists.txt"] }),
      runCommand: async (command, args) => {
        assert.equal(command, "wsl.exe");
        assert.equal(args[1], "Ubuntu");
        const tool = args[7];
        const toolArgs = args.slice(8);
        if (tool === "wslpath") return result(0, toolArgs.at(-1) === projectDir ? "/mnt/c/UAV Project\n" : "/mnt/c/UAV Project/build-wsl-ubuntu\n");
        calls.push({ tool, args: toolArgs });
        return result();
      }
    });
    assert.equal(compiled.compiled, true);
    assert.equal(compiled.steps.length, 2);
    assert.equal(calls[0].args[1], "/mnt/c/UAV Project");
    assert.equal(calls[0].args[3], "/mnt/c/UAV Project/build-wsl-ubuntu");
    assert.deepEqual(calls[1].args, ["--build", "/mnt/c/UAV Project/build-wsl-ubuntu", "--config", "Release"]);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("does not attempt a build after CMake configuration fails", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "uav-gazebo-failure-"));
  const calls = [];
  try {
    const compiled = await compileGazeboPlugins({}, {
      getStatus: async () => ({ source: "native", supported: true, selected: { kind: "classic", packageName: "gazebo", label: "Gazebo Classic" } }),
      prepareProject: async () => ({ projectDir, files: [] }),
      runCommand: async (command, args) => { calls.push({ command, args }); return result(1, "", "Configuration failed"); }
    });
    assert.equal(compiled.compiled, false);
    assert.equal(calls.length, 1);
    assert.equal(compiled.steps[0].stderr, "Configuration failed");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
