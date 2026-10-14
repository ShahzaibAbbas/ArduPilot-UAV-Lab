import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const requirePackage = createRequire(import.meta.url);
const loaded = new Map();
function loadTypeScript(relativeFile) {
  const file = path.resolve(sourceRoot, relativeFile);
  if (loaded.has(file)) return loaded.get(file).exports;
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const module = { exports: {} };
  loaded.set(file, module);
  const requireLocal = (specifier) => specifier.startsWith(".")
    ? specifier.endsWith(".js") ? requirePackage(path.resolve(path.dirname(file), specifier))
      : loadTypeScript(path.relative(sourceRoot, path.resolve(path.dirname(file), `${specifier}.ts`)))
    : requirePackage(specifier);
  new Function("require", "module", "exports", outputText)(requireLocal, module, module.exports);
  return module.exports;
}

const { assessEngineeringDomains, summarizeEngineeringAssessments } = loadTypeScript("domain/engineeringDomains.ts");
const { createMissionDesign, defaultNewMissionDraft, missionProfiles } = loadTypeScript("domain/missionTemplates.ts");
const { airframeOptions } = loadTypeScript("domain/airframes.ts");
const { buildPowerBudget } = loadTypeScript("domain/management.ts");

const mission = (overrides = {}) => createMissionDesign({ ...defaultNewMissionDraft(), ...overrides });
const checks = (design) => assessEngineeringDomains(design.nodes, design.edges, design.settings);
const check = (design, domain, id) => checks(design).find((item) => item.id === domain).checks.find((item) => item.id === id);
const wire = (id, source, sourceHandle, target, targetHandle) => ({ id, source, sourceHandle, target, targetHandle });
function assertRepaired(result) {
  assert.equal(result.passed, true, result.detail);
  assert.deepEqual(result.nodeIds, [], "Repaired check must not retain old affected components");
  assert.deepEqual(result.edgeIds, [], "Repaired check must not retain old affected connections");
}

test("all mission profiles and airframes begin with complete acceptance checks", () => {
  for (const airframe of airframeOptions) {
    for (const profile of missionProfiles) {
      const design = mission({ vehicle: airframe.vehicle, frame: airframe.value, profile: profile.id, systems: profile.systems });
      const failed = checks(design).flatMap((domain) => domain.checks.filter((item) => !item.passed).map((item) => `${domain.id}/${item.id}: ${item.detail}`));
      assert.deepEqual(failed, [], `${airframe.value} / ${profile.id}`);
    }
  }
});

test("required wiring identifies only broken ports and clears after the wire is repaired", () => {
  const design = mission();
  const power = design.edges.find((edge) => edge.target === "gps-1" && edge.targetHandle === "power-in");
  assert.ok(power);
  design.edges = design.edges.filter((edge) => edge !== power);
  const failed = check(design, "wiring-buses", "required-ports");
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.nodeIds, ["gps-1"]);
  assert.match(failed.detail, /Primary GNSS.*power-in/);
  design.edges.push(power);
  assertRepaired(check(design, "wiring-buses", "required-ports"));
  assert.equal(summarizeEngineeringAssessments(checks(design)).status, "complete");
});

test("invalid wires cannot satisfy power paths or required ports and point to their exact edge", () => {
  const design = mission();
  const power = design.edges.find((edge) => edge.id === "e-pm-fc-power");
  power.sourceHandle = "analog-out";
  const failed = check(design, "wiring-buses", "compatible-edges");
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.edgeIds, [power.id]);
  assert.deepEqual(failed.nodeIds, ["pm-1", "fc-1"]);
  assert.match(failed.detail, /analog.*power.*do not match/);
  assert.equal(check(design, "electrical-power", "controller-power").passed, false);
  assert.ok(check(design, "wiring-buses", "required-ports").nodeIds.includes("fc-1"));
  power.sourceHandle = "power-out";
  assertRepaired(check(design, "wiring-buses", "compatible-edges"));
  assertRepaired(check(design, "electrical-power", "controller-power"));
  assertRepaired(check(design, "wiring-buses", "required-ports"));
});

test("every installed sensor needs its own data path and valid harness repairs are accepted", () => {
  const design = mission();
  design.nodes.push({ ...structuredClone(design.nodes.find(({ id }) => id === "gps-1")), id: "gps-backup", data: { ...structuredClone(design.nodes.find(({ id }) => id === "gps-1").data), label: "Backup GPS" } });
  design.edges.push(wire("backup-power", "harness-1", "power-out", "gps-backup", "power-in"));
  const failed = check(design, "avionics-sensors", "sensor-links");
  assert.equal(failed.passed, false);
  assert.deepEqual(failed.nodeIds, ["gps-backup"]);
  assert.match(failed.detail, /Backup GPS/);
  assert.deepEqual(check(design, "wiring-buses", "essential-buses").nodeIds, ["gps-backup"]);
  design.edges.push(
    wire("backup-loom", "gps-backup", "uart-out", "harness-1", "uart-in"),
    wire("loom-fc", "harness-1", "uart-out", "fc-1", "uart-in")
  );
  assertRepaired(check(design, "avionics-sensors", "sensor-links"));
  assertRepaired(check(design, "wiring-buses", "essential-buses"));
  design.edges.find(({ id }) => id === "loom-fc").sourceHandle = "i2c-out";
  assert.deepEqual(check(design, "avionics-sensors", "sensor-links").nodeIds, ["gps-backup"]);
});

test("an operator link is not satisfied by another radio of the same type", () => {
  const design = mission();
  const radio = structuredClone(design.nodes.find(({ id }) => id === "radio-1"));
  radio.id = "radio-backup";
  radio.data.label = "Backup Telemetry";
  design.nodes.push(radio);
  design.edges.push(wire("backup-radio-power", "harness-1", "power-out", radio.id, "power-in"));
  assert.deepEqual(check(design, "communications", "control-link-wired").nodeIds, [radio.id]);
  design.edges.push(wire("backup-radio-data", "fc-1", "uart-out", radio.id, "uart-in"));
  assertRepaired(check(design, "communications", "control-link-wired"));
});

test("payload mounting must reach the airframe and highlights only components without that path", () => {
  const design = mission({ systems: ["camera"] });
  const attachment = design.edges.find(({ id }) => id === "e-frame-payload");
  design.edges = design.edges.filter((edge) => edge !== attachment);
  const failed = check(design, "mechanical-mounting", "payload-mounts");
  assert.equal(failed.passed, false);
  assert.deepEqual(new Set(failed.nodeIds), new Set(["camera-mission", "gimbal-mission", "payload-mount-mission"]));
  design.edges.push(attachment);
  assertRepaired(check(design, "mechanical-mounting", "payload-mounts"));
});

test("failed ratings describe the actual component instead of a success message", () => {
  const design = mission();
  const frame = design.nodes.find(({ id }) => id === "frame-1");
  frame.data.properties.massKg = 0;
  const frameCheck = check(design, "mechanical-mounting", "airframe");
  assert.equal(frameCheck.passed, false);
  assert.deepEqual(frameCheck.nodeIds, [frame.id]);
  assert.match(frameCheck.detail, /positive wheelbase and dry mass/);
  frame.data.properties.massKg = 1.35;
  assertRepaired(check(design, "mechanical-mounting", "airframe"));
  const esc = design.nodes.find(({ id }) => id === "esc-2");
  esc.data.properties.maxAmps = 0;
  assert.deepEqual(check(design, "propulsion", "propulsion-ratings").nodeIds, [esc.id]);
  esc.data.properties.maxAmps = 35;
  assertRepaired(check(design, "propulsion", "propulsion-ratings"));
});

test("missing motors report the expected count and resolve after restoring the components", () => {
  const design = mission();
  const removed = design.nodes.filter(({ id }) => id === "motor-4" || id === "esc-4");
  design.nodes = design.nodes.filter((node) => !removed.includes(node));
  for (const id of ["propulsor-count", "motor-drive", "esc-command", "propulsion-ratings"]) {
    const result = check(design, "propulsion", id);
    assert.equal(result.passed, false);
    assert.match(result.detail, /expects 4; design has 3/);
  }
  design.nodes.push(...removed);
  for (const id of ["propulsor-count", "motor-drive", "esc-command", "propulsion-ratings"]) assertRepaired(check(design, "propulsion", id));
});

test("removed nodes and unknown ports remain visible until their broken edge is fixed or removed", () => {
  const design = mission();
  const bad = wire("broken-wire", "deleted", "power-out", "fc-1", "power-in");
  design.edges.push(bad);
  assert.deepEqual(check(design, "wiring-buses", "compatible-edges").edgeIds, [bad.id]);
  assert.match(check(design, "wiring-buses", "compatible-edges").detail, /deleted.*no longer exists/);
  bad.source = "pm-1";
  bad.sourceHandle = "wrong-port";
  assert.match(check(design, "wiring-buses", "compatible-edges").detail, /wrong-port.*not defined/);
  design.edges.pop();
  assertRepaired(check(design, "wiring-buses", "compatible-edges"));
});

test("rechecking settings recalculates progress without mutating or retaining prior failed results", () => {
  const design = mission();
  design.settings.batteryCriticalPercent = 30;
  const before = JSON.stringify(design);
  const failed = check(design, "safety", "battery-failsafe");
  assert.equal(failed.passed, false);
  assert.equal(JSON.stringify(design), before);
  assert.notEqual(summarizeEngineeringAssessments(checks(design)).status, "complete");
  design.settings.batteryCriticalPercent = 10;
  assertRepaired(check(design, "safety", "battery-failsafe"));
  assert.equal(summarizeEngineeringAssessments(checks(design)).status, "complete");
  assert.equal(failed.passed, false, "Earlier snapshots remain independent of the current assessment");
});

test("shared ESC outputs fail propulsion acceptance and locate every conflicting wire", () => {
  const design = mission();
  const motor1 = design.edges.find((edge) => edge.target === "motor-1" && edge.targetHandle === "power-in");
  const motor2 = design.edges.find((edge) => edge.target === "motor-2" && edge.targetHandle === "power-in");
  motor2.source = motor1.source;
  const wiring = check(design, "wiring-buses", "compatible-edges");
  assert.equal(wiring.passed, false);
  assert.deepEqual(new Set(wiring.edgeIds), new Set([motor1.id, motor2.id]));
  assert.match(wiring.detail, /exactly one motor/);
  assert.deepEqual(new Set(check(design, "propulsion", "motor-drive").nodeIds), new Set(["motor-1", "motor-2"]));
  motor2.source = "esc-2";
  assertRepaired(check(design, "wiring-buses", "compatible-edges"));
  assertRepaired(check(design, "propulsion", "motor-drive"));
});

test("an installed fuse cannot pass protection acceptance while disconnected from the battery", () => {
  const design = mission();
  const feed = design.edges.find((edge) => edge.target === "fuse-1" && edge.targetHandle === "power-in");
  assert.ok(feed);
  design.edges = design.edges.filter((edge) => edge !== feed);
  for (const domain of ["electrical-power", "safety"]) {
    const result = check(design, domain, "overcurrent-protection");
    assert.equal(result.passed, false, result.detail);
    assert.ok(result.nodeIds.includes("fuse-1"));
  }
  design.edges.push(feed);
  for (const domain of ["electrical-power", "safety"]) assertRepaired(check(design, domain, "overcurrent-protection"));
});

test("battery acceptance uses chemistry and valid pack ratings instead of requiring a C-rating", () => {
  const design = mission();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  battery.data.properties.cells = 4.5;
  const invalid = check(design, "electrical-power", "ratings");
  assert.equal(invalid.passed, false);
  assert.deepEqual(invalid.nodeIds, [battery.id]);
  assert.ok(invalid.detail.includes(battery.data.label));
  Object.assign(battery.data.properties, { cells: 4, chemistry: "Li-ion", cRating: 0, continuousCurrentA: 25 });
  assertRepaired(check(design, "electrical-power", "ratings"));
});

test("power budgets use chemistry voltage and distinct pack continuous and burst limits", () => {
  const design = mission();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  Object.assign(battery.data.properties, {
    chemistry: "LiHV", cells: 4, parallelCells: 3, capacityMah: 5200,
    cRating: 0, continuousCurrentA: 25, burstCRating: 10
  });
  const nodes = design.nodes.filter((node) => ["battery", "esc"].includes(node.data.componentType));
  const rail = buildPowerBudget(nodes, design.settings).rails.find((item) => item.id === "battery-bus");
  assert.ok(Math.abs(rail.voltageV - 15.2) < 1e-10);
  assert.equal(rail.continuousLimitA, 25);
  assert.equal(rail.peakLimitA, 52, "Pack capacity already includes parallel cells");
  battery.data.properties.connectorCurrentA = 12;
  const connectorLimited = buildPowerBudget(nodes, design.settings).rails.find((item) => item.id === "battery-bus");
  assert.equal(connectorLimited.continuousLimitA, 12);
  assert.equal(connectorLimited.peakLimitA, 12);
});

test("battery replacement recalculates connected hardware acceptance and pack failsafe voltages", () => {
  const design = mission();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  const original = check(design, "safety", "battery-failsafe");
  assert.match(original.detail, /low 14 V \/ critical 13\.2 V/);
  battery.data.properties.cells = 16;
  const invalid = check(design, "electrical-power", "ratings");
  assert.equal(invalid.passed, false);
  assert.ok(invalid.nodeIds.includes(battery.id));
  assert.ok(invalid.nodeIds.includes("esc-1"));
  assert.match(invalid.detail, /16S/);
  battery.data.properties.cells = 6;
  assertRepaired(check(design, "electrical-power", "ratings"));
  assert.match(check(design, "safety", "battery-failsafe").detail, /low 21 V \/ critical 19\.8 V/);
  battery.data.properties.criticalCellVoltageV = 3.6;
  const badThreshold = check(design, "safety", "battery-failsafe");
  assert.equal(badThreshold.passed, false);
  assert.deepEqual(badThreshold.nodeIds, [battery.id]);
});

test("invalid and unrated packs cannot invent available current or pass the power budget", () => {
  const design = mission();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  for (const properties of [{ cRating: 0, continuousCurrentA: 0 }, { cells: 4.5 }, { capacityMah: -1 }]) {
    const nodes = [structuredClone(battery), ...design.nodes.filter((node) => node.data.componentType === "esc")];
    Object.assign(nodes[0].data.properties, properties);
    const budget = buildPowerBudget(nodes, design.settings, { railLimits: { "battery-bus": { continuousCurrentA: 500, peakCurrentA: 800 } } });
    const rail = budget.rails.find((item) => item.id === "battery-bus");
    assert.equal(rail.continuousLimitA, 0);
    assert.equal(rail.peakLimitA, 0);
    assert.equal(rail.withinReserve, false);
    assert.equal(rail.peakWithinLimit, false);
    assert.equal(budget.withinReserve, false);
  }
});

test("saved rail limits cannot bypass a replacement pack's current rating", () => {
  const design = mission();
  const nodes = design.nodes.filter((node) => ["battery", "esc"].includes(node.data.componentType));
  const battery = nodes.find((node) => node.data.componentType === "battery");
  Object.assign(battery.data.properties, { cRating: 0, continuousCurrentA: 25, burstCRating: 10 });
  const limits = { railLimits: { "battery-bus": { continuousCurrentA: 500, peakCurrentA: 800 } } };
  const rail = buildPowerBudget(nodes, design.settings, limits).rails.find((item) => item.id === "battery-bus");
  assert.equal(rail.continuousLimitA, 25);
  assert.equal(rail.peakLimitA, 52);
  battery.data.properties.connectorCurrentA = 12;
  const replaced = buildPowerBudget(nodes, design.settings, limits).rails.find((item) => item.id === "battery-bus");
  assert.equal(replaced.continuousLimitA, 12);
  assert.equal(replaced.peakLimitA, 12);
});

test("avionics loads contribute to battery draw even without propulsion", () => {
  const design = mission();
  const nodes = design.nodes.filter((node) => ["battery", "flight-controller"].includes(node.data.componentType));
  const budget = buildPowerBudget(nodes, design.settings);
  const bus = budget.rails.find((item) => item.id === "battery-bus");
  assert.equal(bus.loadCount, 1);
  assert.ok(Math.abs(bus.continuousCurrentA - 2.25 / 14.8) < 1e-10);
  assert.ok(Math.abs(bus.peakCurrentA - 4 / 14.8) < 1e-10);
  const noBattery = buildPowerBudget(nodes.filter((node) => node.data.componentType !== "battery"), design.settings);
  assert.equal(noBattery.withinReserve, false);
});
