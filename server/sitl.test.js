import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSitlPlan, coalesceRuntimeDiscovery, gcsOutputs, generateParamContent, generateParamExplanation, generateSitlParamContent, getSystemStatus, launcherFor, parseCustomRuntimePath, parseWslDistros, resolveSimVehiclePath, searchNativeCheckouts, windowsPathToWslPath } from "./sitl.js";

test("parses WSL distro output and ignores Docker's internal distro", () => {
  const output = "\uFEFFU\0b\0u\0n\0t\0u\0\r\n\0d\0o\0c\0k\0e\0r\0-\0d\0e\0s\0k\0t\0o\0p\0\r\n\0";
  assert.deepEqual(parseWslDistros(output), ["Ubuntu"]);
});

test("converts Windows files to the default WSL mount path without shell interpolation", () => {
  assert.equal(windowsPathToWslPath("C:\\Users\\Pilot Name\\mission.param"), "/mnt/c/Users/Pilot Name/mission.param");
});

test("distinguishes Cygwin, WSL, POSIX and native paths without confusing runtime prefixes", () => {
  assert.deepEqual(parseCustomRuntimePath("cygwin:/home/pilot/ardupilot"), { source: "cygwin", path: "/home/pilot/ardupilot" });
  assert.deepEqual(parseCustomRuntimePath("wsl://Ubuntu/home/pilot/ardupilot"), { source: "wsl", distro: "Ubuntu", path: "/home/pilot/ardupilot" });
  assert.deepEqual(parseCustomRuntimePath("Ubuntu:/home/pilot/ardupilot"), { source: "wsl", distro: "Ubuntu", path: "/home/pilot/ardupilot" });
  assert.deepEqual(parseCustomRuntimePath('"\\\\wsl.localhost\\Ubuntu\\home\\pilot\\ardupilot"'), { source: "wsl", distro: "Ubuntu", path: "/home/pilot/ardupilot" });
  assert.deepEqual(parseCustomRuntimePath("C:/source/ardupilot"), { source: "native", path: "C:/source/ardupilot" });
  assert.deepEqual(parseCustomRuntimePath("'/home/pilot/ArduPilot Source'"), { source: "posix", path: "/home/pilot/ArduPilot Source" });
});

test("rejects a directory named sim_vehicle.py and malformed paths", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "uav-lab-sitl-file-"));
  try {
    const directory = path.join(temporaryRoot, "sim_vehicle.py");
    await mkdir(directory);
    assert.equal(await resolveSimVehiclePath(directory), undefined);
    assert.equal(await resolveSimVehiclePath(temporaryRoot), undefined);
    assert.equal(await resolveSimVehiclePath("invalid\0path"), undefined);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("discovers nested checkouts while excluding generated and dependency directories", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "uav-lab-sitl-search-"));
  try {
    for (const directory of ["node_modules", ".git", "dist", "data", "backups"]) {
      const hiddenScript = path.join(temporaryRoot, directory, "Tools", "autotest", "sim_vehicle.py");
      await mkdir(path.dirname(hiddenScript), { recursive: true });
      await writeFile(hiddenScript, "# excluded\n");
    }
    assert.equal(await searchNativeCheckouts([temporaryRoot]), undefined);
    const expected = path.join(temporaryRoot, "source", "repos", "custom-checkout", "Tools", "autotest", "sim_vehicle.py");
    await mkdir(path.dirname(expected), { recursive: true });
    await writeFile(expected, "# available\n");
    assert.equal(await searchNativeCheckouts([temporaryRoot]), expected);
    assert.equal(await searchNativeCheckouts([temporaryRoot], { maxDepth: 2 }), undefined);
    assert.equal(await searchNativeCheckouts([temporaryRoot], { maxEntries: 0 }), undefined);
    assert.equal(await searchNativeCheckouts([temporaryRoot], { timeoutMs: 0 }), undefined);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("accepts an exact native sim_vehicle.py path or ArduPilot checkout", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "uav-lab-sitl-"));
  const autotest = path.join(temporaryRoot, "Tools", "autotest");
  const simVehicle = path.join(autotest, "sim_vehicle.py");
  await mkdir(autotest, { recursive: true });
  await writeFile(simVehicle, "#!/usr/bin/env python3\n", "utf8");

  try {
    const byFile = await getSystemStatus(simVehicle);
    const byCheckout = await getSystemStatus(temporaryRoot);
    assert.equal(byFile.sitl.available, true);
    assert.equal(byFile.sitl.source, "native");
    assert.equal(byFile.sitl.path, simVehicle);
    assert.equal(byCheckout.sitl.path, simVehicle);
    assert.equal(byCheckout.sitl.root, temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("validates UDP targets and deduplicates enabled host/port pairs", () => {
  const target = { enabled: true, host: "localhost", port: 14550 };
  assert.equal(gcsOutputs({ gcsTargets: [target, { ...target, host: "LOCALHOST" }, { ...target, enabled: false, port: 0 }] }).length, 1);
  assert.deepEqual(gcsOutputs({ gcsTargets: [] }), []);
  for (const port of [0, -1, 65536, 14550.5, NaN, Infinity, ""]) {
    assert.throws(() => gcsOutputs({ gcsTargets: [{ ...target, port }] }), { statusCode: 400 });
  }
  for (const host of ["", "https://localhost", "127.0.0.1:14550", "999.0.0.1", "host\n--option", "bad name", "::1"]) {
    assert.throws(() => gcsOutputs({ gcsTargets: [{ ...target, host }] }), { statusCode: 400 });
  }
  assert.equal(gcsOutputs({ gcsPort: 65535 })[0].port, 65535);
  assert.throws(() => gcsOutputs({ gcsPort: 0 }), { statusCode: 400 });
});

test("rejects invalid plan settings before searching runtimes or writing files", async () => {
  await assert.rejects(buildSitlPlan({ settings: { physicsBackend: "json", jsonHost: "127.0.0.1:9002" } }), { statusCode: 400 });
  await assert.rejects(buildSitlPlan({ settings: { speedup: Infinity } }), { statusCode: 400 });
  await assert.rejects(buildSitlPlan({ settings: { speedup: -1 } }), { statusCode: 400 });
});

test("WSL launch inherits Bash login setup and preserves paths as positional arguments", () => {
  const root = "/home/pilot/ArduPilot $(literal)";
  const script = `${root}/Tools/autotest/sim_vehicle.py`;
  const launcher = launcherFor({ available: true, source: "wsl", distro: "Ubuntu", root, path: script });
  assert.equal(launcher.command, "wsl.exe");
  assert.deepEqual(launcher.prefixArgs.slice(0, 5), ["-d", "Ubuntu", "--exec", "bash", "-lc"]);
  assert.equal(launcher.prefixArgs[5], 'cd "$1" && shift && exec python3 "$@"');
  assert.deepEqual(launcher.prefixArgs.slice(-2), [root, script]);
  assert.equal(launcher.displayCwd, root);
});

test("coalesces concurrent runtime probes but refreshes after completion and failure", async () => {
  let calls = 0;
  let resolveProbe;
  const discover = coalesceRuntimeDiscovery(async () => {
    calls += 1;
    return new Promise((resolve) => { resolveProbe = resolve; });
  });
  const first = discover();
  const second = discover("");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(first, second);
  resolveProbe({ available: true });
  assert.deepEqual(await first, { available: true });
  const refreshed = discover();
  await Promise.resolve();
  assert.equal(calls, 2);
  resolveProbe({ available: false });
  assert.deepEqual(await refreshed, { available: false });

  let failures = 0;
  const rejected = coalesceRuntimeDiscovery(async () => { failures += 1; throw new Error("probe failed"); });
  await assert.rejects(rejected("custom"), /probe failed/);
  await assert.rejects(rejected("custom"), /probe failed/);
  assert.equal(failures, 2);
});

function batteryDesign(properties = {}, settings = {}) {
  return {
    name: "Synthetic battery export",
    nodes: [{ id: "battery", data: { componentType: "battery", label: "Bench battery", properties } }],
    edges: [],
    settings: { vehicle: "ArduCopter", batteryLowPercent: 20, batteryCriticalPercent: 10, batteryFailsafeAction: "RTL", batteryCriticalAction: "Land", ...settings }
  };
}

function parameterMap(design) {
  return new Map(generateParamContent(design).trim().split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => { const [key, value] = line.split(","); return [key, Number(value)]; }));
}

test("battery parameter exports preserve legacy LiPo values and describe remaining capacity correctly", () => {
  const design = batteryDesign({ cells: 4, capacityMah: 5200, cRating: 35 });
  const parameters = parameterMap(design);
  assert.equal(parameters.get("BATT_CAPACITY"), 5200);
  assert.equal(parameters.get("BATT_LOW_VOLT"), 14);
  assert.equal(parameters.get("BATT_CRT_VOLT"), 13.2);
  assert.equal(parameters.get("BATT_LOW_MAH"), 1040);
  assert.equal(parameters.get("BATT_CRT_MAH"), 520);
  assert.equal(parameters.get("BATT_FS_LOW_ACT"), 2);
  assert.equal(parameters.get("BATT_FS_CRT_ACT"), 1);
  const explanation = generateParamExplanation(design);
  for (const item of explanation.filter((entry) => entry.parameter.startsWith("BATT_"))) {
    assert.equal(Number(item.value), parameters.get(item.parameter));
  }
  for (const parameter of ["BATT_LOW_MAH", "BATT_CRT_MAH"]) {
    assert.match(explanation.find((item) => item.parameter === parameter).reason, /remaining mAh/);
  }
});

test("battery exports use chemistry and pack ratings without multiplying published capacity by parallel count", () => {
  const design = batteryDesign({ chemistry: "LiHV", cells: 6, parallelCells: 2, capacityMah: 10000,
    cRating: 10, continuousCurrentA: 80, connectorCurrentA: 60, lowCellVoltageV: 3.55, criticalCellVoltageV: 3.35 });
  const parameters = parameterMap(design);
  assert.equal(parameters.get("BATT_CAPACITY"), 10000);
  assert.equal(parameters.get("BATT_LOW_MAH"), 2000);
  assert.equal(parameters.get("BATT_CRT_MAH"), 1000);
  assert.equal(parameters.get("BATT_LOW_VOLT"), 21.3);
  assert.equal(parameters.get("BATT_CRT_VOLT"), 20.1);
  const content = generateParamContent(design);
  assert.match(content, /LiHV 6S2P; total pack capacity 10000 mAh/);
  assert.match(content, /22\.80 \/ 26\.10 V; energy 228\.00 Wh/);
  assert.match(content, /continuous current planning limit: 60\.00 A/);
  assert.match(content, /separate from charger settings and manufacturer discharge cutoffs/);
  const explanation = generateParamExplanation(design);
  for (const parameter of ["BATT_LOW_VOLT", "BATT_CRT_VOLT"]) {
    assert.equal(Number(explanation.find((item) => item.parameter === parameter).value), parameters.get(parameter));
  }
});

test("small-pack voltage exports preserve distinct editable thresholds", () => {
  const parameters = parameterMap(batteryDesign({ cells: 1, lowCellVoltageV: 3.55, criticalCellVoltageV: 3.51 }));
  assert.equal(parameters.get("BATT_LOW_VOLT"), 3.55);
  assert.equal(parameters.get("BATT_CRT_VOLT"), 3.51);
});

test("Li-ion exports accept explicit pack current and reject invalid battery specifications", () => {
  const design = batteryDesign({ chemistry: "Li-ion", cells: 6, parallelCells: 2, capacityMah: 8400,
    cRating: 0, continuousCurrentA: 45, lowCellVoltageV: 3.2, criticalCellVoltageV: 3 });
  assert.equal(parameterMap(design).get("BATT_LOW_VOLT"), 19.2);
  assert.equal(parameterMap(design).get("BATT_CRT_VOLT"), 18);
  assert.match(generateParamContent(design), /21\.60 \/ 25\.20 V; energy 181\.44 Wh/);
  for (const properties of [{ cells: 4.5 }, { capacityMah: -1 }, { cRating: 0 }, { chemistry: "LiPo", maxCellVoltageV: 4.35 },
    { lowCellVoltageV: 3.2, criticalCellVoltageV: 3.3 }, { specMassG: -1 }]) {
    assert.throws(() => generateParamContent(batteryDesign(properties)), (error) => error.statusCode === 400 && /Battery/.test(error.message));
    assert.throws(() => generateParamExplanation(batteryDesign(properties)), (error) => error.statusCode === 400);
  }
  assert.doesNotThrow(() => generateParamContent(batteryDesign({ packLengthMm: 100 })));
});

test("battery failsafe actions use the selected firmware's numeric enum", () => {
  for (const [vehicle, low, critical, expectedLow, expectedCritical] of [
    ["ArduCopter", "RTL", "Land", 2, 1],
    ["ArduPlane", "RTL", "Land", 1, 2],
    ["ArduPlane", "Land", "Terminate", 2, 3],
    ["Rover", "RTL", "Hold", 1, 2],
    ["Rover", "SmartRTL", "Terminate", 3, 5]
  ]) {
    const design = batteryDesign({}, { vehicle, batteryFailsafeAction: low, batteryCriticalAction: critical });
    const parameters = parameterMap(design);
    assert.equal(parameters.get("BATT_FS_LOW_ACT"), expectedLow);
    assert.equal(parameters.get("BATT_FS_CRT_ACT"), expectedCritical);
    const explanation = generateParamExplanation(design);
    assert.equal(Number(explanation.find((item) => item.parameter === "BATT_FS_LOW_ACT").value), expectedLow);
    assert.equal(Number(explanation.find((item) => item.parameter === "BATT_FS_CRT_ACT").value), expectedCritical);
  }
  const unsupported = batteryDesign({}, { vehicle: "ArduPlane", batteryFailsafeAction: "SmartRTL" });
  assert.throws(() => generateParamContent(unsupported), /ArduPlane does not support the SmartRTL battery failsafe action/);
});

test("legacy Rover Land selections export as an explicitly explained Hold action", () => {
  const design = batteryDesign({}, { vehicle: "Rover", batteryCriticalAction: "Land" });
  assert.equal(parameterMap(design).get("BATT_FS_CRT_ACT"), 2);
  assert.match(generateParamContent(design), /legacy Rover Land selection maps to Hold/);
  assert.match(generateParamExplanation(design).find((item) => item.parameter === "BATT_FS_CRT_ACT").reason, /legacy Rover Land selection maps to Hold/);
});

test("simulator battery initialization follows replacement voltage and total pack capacity", () => {
  for (const [properties, voltage, capacity] of [
    [{ cells: 4, capacityMah: 5200 }, 16.8, 5.2],
    [{ chemistry: "LiHV", cells: 6, capacityMah: 17000 }, 26.1, 17],
    [{ chemistry: "Li-ion", cells: 6, parallelCells: 2, capacityMah: 9000 }, 25.2, 9]
  ]) {
    const design = batteryDesign(properties, { frame: "quad-x" });
    const hardware = generateParamContent(design);
    const simulation = generateSitlParamContent(design);
    assert.ok(!hardware.includes("SIM_"), "Hardware export must not contain simulator parameters");
    const values = new Map(simulation.split("\n").filter((line) => line && !line.startsWith("#")).map((line) => { const [key, value] = line.split(","); return [key, Number(value)]; }));
    assert.equal(values.get("SIM_BATT_VOLTAGE"), voltage);
    assert.equal(values.get("SIM_BATT_CAP_AH"), capacity);
    assert.equal(values.get("SIM_FRM_BAT_VOLT"), voltage, "Copter frame voltage must not clip the pack back to 12.6 V");
    assert.equal(values.get("SIM_FRM_BAT_CAP"), capacity);
  }
});

test("heli, plane, rover and external physics do not receive native multicopter frame parameters", () => {
  for (const settings of [{ frame: "single-rotor" }, { vehicle: "ArduPlane", frame: "quadplane" }, { vehicle: "Rover", frame: "rover", batteryCriticalAction: "Hold" }, { physicsBackend: "json", frame: "quad-x" }]) {
    const content = generateSitlParamContent(batteryDesign({ cells: 6 }, settings));
    assert.match(content, /SIM_BATT_VOLTAGE,25\.2/);
    assert.ok(!content.includes("SIM_FRM_"));
  }
});

test("invalid reserve thresholds fail exports instead of silently clamping the failsafe", () => {
  for (const settings of [{ batteryLowPercent: 20, batteryCriticalPercent: 30 }, { batteryLowPercent: 101 }, { batteryCriticalPercent: 0 }, { batteryCriticalPercent: -1 }, { batteryLowPercent: "invalid" }]) {
    const design = batteryDesign({}, settings);
    assert.throws(() => generateParamContent(design), (error) => error.statusCode === 400);
    assert.throws(() => generateParamExplanation(design), (error) => error.statusCode === 400);
  }
  const design = batteryDesign({}, { batteryLowPercent: 90, batteryCriticalPercent: 15 });
  assert.equal(parameterMap(design).get("BATT_LOW_MAH"), 4680);
  assert.equal(parameterMap(design).get("BATT_CRT_MAH"), 780);
});
