import test from "node:test";
import assert from "node:assert/strict";
import { setupDiagnostics, setupRuntimeProbeCommand } from "./setup.js";

const runtime = {
  available: true, source: "wsl", distro: "Ubuntu", root: "/home/user/ardupilot",
  path: "/home/user/ardupilot/Tools/autotest/sim_vehicle.py", command: "wsl.exe", notes: []
};

function probeOutput(overrides = {}) {
  return { stdout: `Login banner\nUAV_LAB_DIAGNOSTICS=${JSON.stringify({
    python: "3.12.3", python3: true, modules: { MAVProxy: true, pymavlink: true }, mavproxyExecutable: true, ...overrides
  })}\n`, stderr: "" };
}

function options(overrides = {}) {
  return {
    platform: "win32",
    getStatus: async () => ({ sitl: runtime }),
    folderExists: async () => true,
    versionCommand: async (command) => ({ available: true, version: `${command} available` }),
    runCommand: async () => probeOutput(),
    displayProbe: async () => ({ available: true, wx: true, display: ":0" }),
    ...overrides
  };
}

test("setup checks the selected WSL login environment even when host Python and MAVProxy are absent", async () => {
  let invocation;
  const result = await setupDiagnostics("unused", options({
    versionCommand: async (command) => ({ available: !["python", "python3", "py", "mavproxy.py"].includes(command) }),
    runCommand: async (command, args, config) => { invocation = { command, args, config }; return probeOutput(); }
  }));
  assert.equal(result.ready, true);
  assert.equal(result.checks.find((check) => check.id === "hostPython").ok, false);
  assert.equal(result.checks.find((check) => check.id === "hostMavproxy").required, false);
  assert.match(result.checks.find((check) => check.id === "python").label, /SITL Python.*WSL Ubuntu/);
  assert.equal(invocation.command, "wsl.exe");
  assert.deepEqual(invocation.args.slice(0, 5), ["-d", "Ubuntu", "--exec", "bash", "-lc"]);
  assert.deepEqual(invocation.args.slice(7, 10), [runtime.root, "-B", "-c"]);
  assert.equal(invocation.config.timeout, 10000);
  assert.equal(invocation.args.includes(runtime.path), false);
});

test("external window diagnostics report WSL GUI failure without blocking headless readiness", async () => {
  const result = await setupDiagnostics("unused", options({
    displayProbe: async (selected) => {
      assert.equal(selected, runtime);
      return { available: false, wx: true, reason: "wxPython cannot connect to the configured GUI display." };
    }
  }));
  const check = result.checks.find((entry) => entry.id === "sitlGui");
  assert.equal(result.ready, true);
  assert.equal(check.required, false);
  assert.equal(check.ok, false);
  assert.match(check.detail, /cannot connect/);
  assert.match(check.fix, /WSLg.*Ubuntu/);
});

test("missing MAVProxy import or launcher blocks readiness even with a healthy host installation", async () => {
  for (const missing of [
    { modules: { MAVProxy: false, pymavlink: true } },
    { mavproxyExecutable: false }
  ]) {
    const result = await setupDiagnostics("unused", options({ runCommand: async () => probeOutput(missing) }));
    assert.equal(result.ready, false);
    assert.equal(result.checks.find((check) => check.id === "hostMavproxy").ok, true);
    const check = result.checks.find((entry) => entry.id === "mavproxy");
    assert.equal(check.ok, false);
    assert.match(check.fix, /WSL Ubuntu/);
    assert.doesNotMatch(check.detail, /import and launcher available/);
  }
});

test("missing pymavlink and failed runtime probes cannot be hidden by host checks", async () => {
  const missing = await setupDiagnostics("unused", options({ runCommand: async () => probeOutput({ modules: { MAVProxy: true, pymavlink: false } }) }));
  assert.equal(missing.ready, false);
  assert.equal(missing.checks.find((entry) => entry.id === "pymavlink").ok, false);
  const failed = await setupDiagnostics("unused", options({ runCommand: async () => { throw new Error("C:\\private\\interpreter failed"); } }));
  assert.equal(failed.ready, false);
  assert.equal(failed.checks.find((entry) => entry.id === "python").ok, false);
  assert.equal(JSON.stringify(failed).includes("private"), false);
});

test("probe arguments use the launch interpreter without executing sim_vehicle.py or interpolating paths", () => {
  const unusualRoot = "/home/user/a path;$(touch unexpected)";
  const wsl = setupRuntimeProbeCommand({ ...runtime, root: unusualRoot });
  assert.equal(wsl.args[7], unusualRoot);
  assert.equal(wsl.args[5].includes(unusualRoot), false);
  const native = setupRuntimeProbeCommand({ ...runtime, source: "native" });
  assert.equal(native.command, process.platform === "win32" ? "python" : "python3");
  assert.deepEqual(native.args.slice(0, 2), ["-B", "-c"]);
  assert.equal(native.args.includes(runtime.path), false);
});

test("no discovered SITL runtime leaves launch dependencies unchecked and readiness false", async () => {
  let probes = 0;
  const result = await setupDiagnostics("unused", options({
    getStatus: async () => ({ sitl: { available: false, notes: ["Locate ArduPilot"] } }),
    runCommand: async () => { probes += 1; return probeOutput(); }
  }));
  assert.equal(probes, 0);
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((entry) => entry.id === "simVehicle").ok, false);
});

test("setup diagnoses the manually selected runtime instead of replacing it with auto-detection", async () => {
  const selected = "wsl://Ubuntu/home/user/custom checkout";
  let requested;
  const result = await setupDiagnostics("unused", options({
    simVehiclePath: selected,
    getStatus: async (value) => { requested = value; return { sitl: runtime }; }
  }));
  assert.equal(requested, selected);
  assert.equal(result.ready, true);
});
