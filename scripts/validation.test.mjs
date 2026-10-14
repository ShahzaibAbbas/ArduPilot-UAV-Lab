import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const loaded = new Map();
const requirePackage = createRequire(import.meta.url);
function loadTypeScript(relativeFile) {
  const file = path.resolve(sourceRoot, relativeFile);
  if (loaded.has(file)) return loaded.get(file).exports;
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
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

const { validateDesign, validDesignConnections, unconnectedRequiredPorts } = loadTypeScript("domain/validators.ts");
const { createStarterDesign } = loadTypeScript("domain/starterDesign.ts");
const { createMissionDesign, defaultNewMissionDraft, missionProfiles } = loadTypeScript("domain/missionTemplates.ts");
const { airframeOptions } = loadTypeScript("domain/airframes.ts");
const { defaultPropertiesForComponent } = loadTypeScript("domain/componentCatalog.ts");
const validate = (design) => validateDesign(design.nodes, design.edges, design.settings);

test("starter and every mission/airframe combination have valid connections and connected required ports", () => {
  const designs = [createStarterDesign()];
  for (const airframe of airframeOptions) {
    for (const profile of missionProfiles) {
      designs.push(createMissionDesign({
        ...defaultNewMissionDraft(), vehicle: airframe.vehicle, frame: airframe.value,
        profile: profile.id, systems: [...profile.systems]
      }));
    }
  }
  for (const design of designs) {
    const context = `${design.settings.frame}/${design.settings.missionProfile}`;
    assert.equal(validDesignConnections(design.nodes, design.edges).length, design.edges.length, context);
    assert.deepEqual(unconnectedRequiredPorts(design.nodes, design.edges), [], context);
    assert.deepEqual(validate(design).issues.filter((issue) => issue.severity === "error"), [], context);
  }
});

test("missing input errors locate the exact component and port and disappear after repair", () => {
  const design = createStarterDesign();
  const saved = design.edges.find((edge) => edge.id === "e-pm-gps-power");
  design.edges = design.edges.filter((edge) => edge !== saved);
  const issue = validate(design).issues.find((item) => item.id === "required-gps-1-power-in");
  assert.deepEqual(issue.nodeIds, ["gps-1"]);
  assert.deepEqual(issue.portIds, [{ nodeId: "gps-1", portId: "power-in" }]);
  assert.match(issue.message, /GPS.*PWR.*power-in/);
  design.edges.push(saved);
  assert.equal(validate(design).issues.some((item) => item.id === issue.id), false);
  design.edges = design.edges.filter((edge) => edge !== saved);
  assert.equal(validate(design).issues.some((item) => item.id === issue.id), true);
});

test("invalid edges never satisfy a required connection; correcting the endpoints clears both problems", () => {
  for (const mutation of [
    { sourceHandle: "analog-out" },
    { sourceHandle: "power-in" },
    { source: "deleted-component" },
    { sourceHandle: "missing-port" },
    { source: "esc-1", sourceHandle: "power-out" }
  ]) {
    const design = createStarterDesign();
    const saved = design.edges.find((edge) => edge.id === "e-pm-gps-power");
    design.edges = design.edges.map((edge) => edge === saved ? { ...edge, ...mutation } : edge);
    const issues = validate(design).issues;
    assert.ok(issues.some((issue) => issue.edgeIds?.includes(saved.id)), JSON.stringify(mutation));
    assert.ok(issues.some((issue) => issue.id === "required-gps-1-power-in"), JSON.stringify(mutation));
    design.edges = design.edges.map((edge) => edge.id === saved.id ? saved : edge);
    assert.deepEqual(validate(design).issues.filter((issue) => issue.severity === "error"), []);
  }
});

test("self-connected power inputs remain invalid and all controllers are checked individually", () => {
  const design = createStarterDesign();
  const extraController = {
    ...design.nodes.find((node) => node.id === "fc-1"), id: "fc-2",
    data: { componentType: "flight-controller", label: "Backup controller", properties: defaultPropertiesForComponent("flight-controller") }
  };
  design.nodes.push(extraController);
  assert.ok(validate(design).issues.some((issue) => issue.portIds?.some(({ nodeId, portId }) => nodeId === "fc-2" && portId === "power-in")));
  const self = { id: "self-pm", source: "pm-1", sourceHandle: "power-out", target: "pm-1", targetHandle: "power-in" };
  design.edges = design.edges.filter((edge) => edge.target !== "pm-1");
  design.edges.push(self);
  assert.ok(validate(design).issues.some((issue) => issue.id === "edge-self-pm-self"));
  assert.ok(validate(design).issues.some((issue) => issue.id === "required-pm-1-power-in"));
});

test("competing power supplies cannot satisfy a required input until one feed is removed", () => {
  const design = createStarterDesign();
  const extra = { id: "parallel-gps-power", source: "battery-1", sourceHandle: "power-out", target: "gps-1", targetHandle: "power-in" };
  design.edges.push(extra);
  const issues = validate(design).issues;
  const conflict = issues.find((issue) => issue.title === "Competing input connections");
  assert.ok(conflict);
  assert.ok(conflict.edgeIds.includes(extra.id));
  assert.deepEqual(conflict.portIds, [{ nodeId: "gps-1", portId: "power-in" }]);
  assert.ok(unconnectedRequiredPorts(design.nodes, design.edges).some(({ node, port }) => node.id === "gps-1" && port.id === "power-in"));
  design.edges.pop();
  assert.deepEqual(validate(design).issues.filter((issue) => issue.severity === "error"), []);
});

test("one ESC cannot satisfy the drive connections for several motors", () => {
  const design = createStarterDesign();
  const motor2 = design.edges.find((edge) => edge.target === "motor-2" && edge.targetHandle === "power-in");
  motor2.source = "esc-1";
  const issues = validate(design).issues;
  const conflict = issues.find((issue) => issue.id === "esc-esc-1-multiple-motors");
  assert.ok(conflict);
  assert.deepEqual(new Set(conflict.nodeIds), new Set(["esc-1", "motor-1", "motor-2"]));
  assert.ok(issues.some((issue) => issue.id === "motor-motor-1-esc"));
  assert.ok(issues.some((issue) => issue.id === "motor-motor-2-esc"));
  motor2.source = "esc-2";
  assert.deepEqual(validate(design).issues.filter((issue) => issue.severity === "error"), []);
});

test("a valid controller power feed through a harness clears the direct-feed error", () => {
  const design = createMissionDesign(defaultNewMissionDraft());
  design.edges = design.edges.filter((edge) => edge.id !== "e-pm-fc-power" && edge.id !== "e-pdb-harness");
  design.edges.push(
    { id: "regulated-harness", source: "pm-1", sourceHandle: "power-out", target: "harness-1", targetHandle: "power-in" },
    { id: "harness-fc", source: "harness-1", sourceHandle: "power-out", target: "fc-1", targetHandle: "power-in" }
  );
  assert.equal(validate(design).issues.some((issue) => issue.id === "fc-power-missing"), false);
  assert.deepEqual(unconnectedRequiredPorts(design.nodes, design.edges), []);
});

test("data repairs are evaluated for each sensor instance and accept a matching harness route", () => {
  const design = createMissionDesign(defaultNewMissionDraft());
  design.nodes.push({
    ...design.nodes.find((node) => node.id === "gps-1"), id: "gps-2",
    data: { componentType: "gps", label: "Backup GNSS", properties: defaultPropertiesForComponent("gps") }
  });
  const issueId = "sensor-gps-2-data";
  assert.deepEqual(validate(design).issues.find((issue) => issue.id === issueId).nodeIds, ["gps-2"]);
  design.edges.push({ id: "gps2-power", source: "pm-1", sourceHandle: "power-out", target: "gps-2", targetHandle: "power-in" });
  assert.ok(validate(design).issues.some((issue) => issue.id === issueId), "Power alone is not a data path");
  design.edges.push(
    { id: "gps2-harness", source: "gps-2", sourceHandle: "uart-out", target: "harness-1", targetHandle: "uart-in" },
    { id: "harness-controller-data", source: "harness-1", sourceHandle: "uart-out", target: "fc-1", targetHandle: "uart-in" }
  );
  assert.equal(validate(design).issues.some((issue) => issue.id === issueId), false);
  design.edges = design.edges.filter((edge) => edge.id !== "gps2-harness");
  assert.ok(validate(design).issues.some((issue) => issue.id === issueId), "A different GNSS's data route cannot hide this disconnection");
});

test("unsupported component types and their wires report locations instead of throwing", () => {
  const design = createStarterDesign();
  design.nodes = design.nodes.map((node) => node.id === "gps-1"
    ? { ...node, data: { ...node.data, componentType: "legacy-unknown-gnss" } } : node);
  const issues = validate(design).issues;
  assert.deepEqual(issues.find((issue) => issue.id === "node-gps-1-unknown-component").nodeIds, ["gps-1"]);
  assert.ok(issues.some((issue) => issue.id === "edge-e-gps-fc-missing-port"));
});

test("battery specification errors identify the pack and clear after repair", () => {
  const design = createStarterDesign();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  battery.data.properties.cells = 4.5;
  const issue = validate(design).issues.find((item) => item.id === `battery-${battery.id}-cells`);
  assert.equal(issue.severity, "error");
  assert.deepEqual(issue.nodeIds, [battery.id]);
  assert.ok(issue.message.includes(battery.data.label));
  battery.data.properties.cells = 4;
  assert.equal(validate(design).issues.some((item) => item.id === issue.id), false);

  battery.data.properties.lowCellVoltageV = 3.2;
  battery.data.properties.criticalCellVoltageV = 3.3;
  assert.ok(validate(design).issues.some((item) => item.severity === "error" && item.nodeIds?.includes(battery.id)));
  battery.data.properties.lowCellVoltageV = 3.5;
  assert.deepEqual(validate(design).issues.filter((item) => item.severity === "error" && item.nodeIds?.includes(battery.id)), []);
});

test("a directly rated Li-ion pack does not require a marketing C-rating", () => {
  const design = createStarterDesign();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  Object.assign(battery.data.properties, { chemistry: "Li-ion", cRating: 0, continuousCurrentA: 25 });
  assert.deepEqual(validate(design).issues.filter((item) => item.severity === "error" && item.nodeIds?.includes(battery.id)), []);
});

test("battery voltage and current margins are checked against connected power hardware", () => {
  const design = createStarterDesign();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  const module = design.nodes.find((node) => node.data.componentType === "power-module");
  const esc = design.nodes.find((node) => node.data.componentType === "esc");
  Object.assign(battery.data.properties, { cells: 16, continuousCurrentA: 20 });
  const issues = validate(design).issues;
  assert.ok(issues.some((issue) => issue.id === `battery-${battery.id}-${module.id}-voltage`));
  assert.ok(issues.some((issue) => issue.id === `battery-${battery.id}-${esc.id}-cells`));
  assert.ok(issues.some((issue) => issue.id === `battery-${battery.id}-propulsion-current` && issue.severity === "warning"));
});

test("a replacement battery must respect the fuse full-charge voltage rating", () => {
  const design = createStarterDesign();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  const fuse = design.nodes.find((node) => node.data.componentType === "fuse");
  fuse.data.properties.voltageRating = 20;
  battery.data.properties.cells = 6;
  const issue = validate(design).issues.find((item) => item.id === `battery-${battery.id}-${fuse.id}-voltage`);
  assert.equal(issue.title, "Protection voltage exceeded");
  assert.deepEqual(issue.nodeIds, [battery.id, fuse.id]);
  battery.data.properties.cells = 4;
  assert.equal(validate(design).issues.some((item) => item.id === issue.id), false);
});

test("an isolated spare pack cannot create voltage conflicts on another pack's circuit", () => {
  const design = createStarterDesign();
  const battery = design.nodes.find((node) => node.data.componentType === "battery");
  const spare = structuredClone(battery);
  spare.id = "spare-battery";
  spare.data.properties.cells = 16;
  design.nodes.push(spare);
  assert.equal(validate(design).issues.some((issue) => issue.id.startsWith("battery-spare-battery-")), false);
});

test("invalid reserve percentages are errors rather than silently approved settings", () => {
  const design = createStarterDesign();
  for (const settings of [{ batteryLowPercent: 101 }, { batteryCriticalPercent: 0 }, { batteryCriticalPercent: -1 }, { batteryLowPercent: NaN }]) {
    const modified = { ...design, settings: { ...design.settings, ...settings } };
    assert.ok(validate(modified).issues.some((issue) => issue.id === "battery-failsafe-threshold-order" && issue.severity === "error"));
  }
});
