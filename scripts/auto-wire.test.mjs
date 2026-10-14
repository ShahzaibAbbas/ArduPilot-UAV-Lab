import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";
import { MarkerType } from "@xyflow/react";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const requirePackage = createRequire(import.meta.url);
const loaded = new Map();
function loadTypeScript(relativeFile) {
  const file = path.resolve(sourceRoot, relativeFile);
  if (loaded.has(file)) return loaded.get(file).exports;
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const module = { exports: {} };
  loaded.set(file, module);
  new Function("require", "module", "exports", outputText)((specifier) => {
    if (specifier === "@xyflow/react") return { MarkerType };
    if (specifier.endsWith("/server/batteryModel.js") || specifier === "../../server/batteryModel.js") {
      return requirePackage(path.resolve(sourceRoot, "../server/batteryModel.js"));
    }
    assert.ok(specifier.startsWith("."));
    return loadTypeScript(path.relative(sourceRoot, path.resolve(path.dirname(file), `${specifier}.ts`)));
  }, module, module.exports);
  return module.exports;
}

const { autoWireSuggestions } = loadTypeScript("domain/autoWire.ts");
const { defaultPropertiesForComponent } = loadTypeScript("domain/componentCatalog.ts");
const { defaultSettings } = loadTypeScript("domain/design.ts");
const { validDesignConnections, validateDesign, unconnectedRequiredPorts, componentHasControllerDataPath } = loadTypeScript("domain/validators.ts");
const { createMissionDesign, defaultNewMissionDraft } = loadTypeScript("domain/missionTemplates.ts");
const settings = { ...defaultSettings, frame: "quad-x" };
const node = (type, id = type, properties = {}) => ({ id, type: "componentNode", position: { x: 0, y: 0 },
  data: { componentType: type, label: id, properties: { ...defaultPropertiesForComponent(type), ...properties } } });
const edge = (source, sourceHandle, target, targetHandle) => ({ id: `${source}:${sourceHandle}->${target}:${targetHandle}`, source, sourceHandle, target, targetHandle });
const toEdges = (suggestions) => suggestions.map((entry) => edge(entry.sourceId, entry.sourceHandle, entry.targetId, entry.targetHandle));
const contains = (suggestions, source, sourceHandle, target, targetHandle) => suggestions.some((entry) =>
  entry.sourceId === source && entry.sourceHandle === sourceHandle && entry.targetId === target && entry.targetHandle === targetHandle);
const endpoint = (nodeId, portId) => (entry) => entry.node.id === nodeId && entry.port.id === portId;

test("auto-wire repairs every missing device instance and removes its required-port issues", () => {
  const design = createMissionDesign({ ...defaultNewMissionDraft(), vehicle: "ArduPlane", frame: "fixed-wing-flying-wing" });
  design.nodes.push(node("gps", "gps-2"), node("telemetry-radio", "radio-2"), node("servo", "servo-extra"));
  const before = structuredClone(design);
  const suggestions = autoWireSuggestions(design.nodes, design.edges, design.settings);
  for (const id of ["gps-2", "radio-2", "servo-extra"]) {
    assert.ok(suggestions.some((entry) => entry.targetId === id && entry.targetHandle === "power-in"), `${id} needs its own power suggestion`);
  }
  assert.ok(contains(suggestions, "gps-2", "uart-out", "fc-1", "uart-in"));
  assert.ok(contains(suggestions, "fc-1", "uart-out", "radio-2", "uart-in"));
  assert.ok(contains(suggestions, "fc-1", "pwm-out", "servo-extra", "pwm-in"));
  const repaired = [...design.edges, ...toEdges(suggestions)];
  assert.equal(validDesignConnections(design.nodes, repaired).length, repaired.length);
  const missing = unconnectedRequiredPorts(design.nodes, repaired);
  for (const id of ["gps-2", "radio-2", "servo-extra"]) assert.equal(missing.some(endpoint(id, "power-in")), false);
  const remaining = validateDesign(design.nodes, repaired, design.settings).issues;
  assert.equal(remaining.some((issue) => issue.nodeIds?.includes("servo-extra") && /Servo (power|command|mount) missing/.test(issue.title)), false);
  assert.equal(autoWireSuggestions(design.nodes, repaired, design.settings).length, 0, "Applying suggestions must be idempotent.");
  assert.deepEqual(design, before, "Suggestions must not mutate nodes, existing edges, or settings.");
});

test("valid alternate power and PWM feeds are preserved without competing inputs", () => {
  const nodes = [node("battery"), node("power-module"), node("power-module", "backup"), node("power-distribution-board", "pdb"),
    node("flight-controller", "fc"), node("flight-controller", "fc-alt"), node("gps"), node("esc"), node("servo")];
  const edges = [edge("backup", "power-out", "fc", "power-in"), edge("pdb", "power-out", "esc", "power-in"),
    edge("backup", "power-out", "gps", "power-in"), edge("fc-alt", "pwm-out", "servo", "pwm-in")];
  const suggestions = autoWireSuggestions(nodes, edges, settings);
  for (const existing of edges) assert.equal(suggestions.some((entry) => entry.targetId === existing.target && entry.targetHandle === existing.targetHandle), false);
  const endpoints = toEdges(suggestions).filter((entry) => ["power-in", "pwm-in", "mount-in", "video-in"].includes(entry.targetHandle))
    .map((entry) => `${entry.target}:${entry.targetHandle}`);
  assert.equal(new Set(endpoints).size, endpoints.length);
});

test("invalid occupied input remains visible until removed, then its exact missing port is repaired", () => {
  const nodes = [node("battery"), node("power-module"), node("flight-controller", "fc"), node("gps", "gps-1"), node("gps", "gps-2")];
  const invalid = edge("gps-1", "uart-out", "gps-2", "power-in");
  const blocked = autoWireSuggestions(nodes, [invalid], settings);
  assert.equal(blocked.some((entry) => entry.targetId === "gps-2" && entry.targetHandle === "power-in"), false);
  const stillInvalid = validateDesign(nodes, [invalid, ...toEdges(blocked)], settings);
  assert.ok(stillInvalid.issues.some((issue) => issue.edgeIds?.includes(invalid.id) && issue.title === "Signal mismatch"));
  assert.ok(unconnectedRequiredPorts(nodes, [invalid, ...toEdges(blocked)]).some(endpoint("gps-2", "power-in")));
  const repaired = toEdges(autoWireSuggestions(nodes, [], settings));
  assert.equal(unconnectedRequiredPorts(nodes, repaired).some(endpoint("gps-2", "power-in")), false);
  assert.equal(validateDesign(nodes, repaired, settings).issues.some((issue) => issue.title === "Signal mismatch"), false);
});

test("wrong motor feeds and dangling input wires never trigger automatic replacements", () => {
  const nodes = [node("battery"), node("power-module"), node("flight-controller", "fc"), node("esc"), node("motor"), node("gps")];
  const edges = [edge("battery", "power-out", "motor", "power-in"), edge("missing-node", "power-out", "gps", "power-in")];
  const suggestions = autoWireSuggestions(nodes, edges, settings);
  assert.equal(suggestions.some((entry) => entry.targetId === "motor" && entry.targetHandle === "power-in"), false);
  assert.equal(suggestions.some((entry) => entry.targetId === "gps" && entry.targetHandle === "power-in"), false);
  assert.equal(validDesignConnections(nodes, toEdges(suggestions)).length, suggestions.length);
  assert.ok(validateDesign(nodes, [...edges, ...toEdges(suggestions)], settings).issues.some((issue) => issue.title === "Incompatible propulsion connection"));
});

test("valid sensor paths through a harness are retained and partial paths are completed", () => {
  const nodes = [node("power-module"), node("flight-controller", "fc"), node("wiring-harness", "harness"), node("gps", "gps-1"), node("gps", "gps-2")];
  const partial = [edge("gps-1", "uart-out", "harness", "uart-in")];
  const proposed = autoWireSuggestions(nodes, partial, settings);
  assert.ok(contains(proposed, "harness", "uart-out", "fc", "uart-in"));
  assert.equal(proposed.some((entry) => entry.sourceId === "gps-1" && entry.signal === "uart"), false);
  const completed = [...partial, ...toEdges(proposed)];
  const byId = new Map(nodes.map((entry) => [entry.id, entry]));
  assert.equal(componentHasControllerDataPath(nodes.find((entry) => entry.id === "gps-1"), completed, byId), true);
  assert.equal(componentHasControllerDataPath(nodes.find((entry) => entry.id === "gps-2"), completed, byId), true);
  assert.equal(autoWireSuggestions(nodes, completed, settings).some((entry) => entry.signal === "uart"), false);
});

test("sensor interface selection and existing alternate data connections are respected", () => {
  const nodes = [node("flight-controller", "fc"), node("optical-flow", "flow", { interface: "DroneCAN" }),
    node("airspeed-sensor", "airspeed", { interface: "Analog" }), node("rangefinder", "range")];
  const existing = [edge("range", "i2c-out", "fc", "i2c-in")];
  const suggestions = autoWireSuggestions(nodes, existing, settings);
  assert.ok(contains(suggestions, "flow", "can-out", "fc", "can-in"));
  assert.ok(contains(suggestions, "airspeed", "analog-out", "fc", "analog-in"));
  assert.equal(suggestions.some((entry) => entry.sourceId === "range"), false);
  const corruptBus = edge("flow", "can-out", "fc", "uart-in");
  const blocked = autoWireSuggestions([...nodes, node("gps")], [...existing, corruptBus], settings);
  assert.equal(blocked.some((entry) => entry.targetId === "fc" && entry.targetHandle === "uart-in"), false);
});

test("existing crossed ESC assignments reserve their source and preserve motor pairing", () => {
  const nodes = [node("flight-controller", "fc"), node("frame"), node("esc", "esc-1"), node("esc", "esc-2"), node("motor", "motor-1"), node("motor", "motor-2")];
  const edges = [edge("esc-2", "power-out", "motor-1", "power-in")];
  const suggestions = autoWireSuggestions(nodes, edges, { ...settings, frame: "rover-skid", vehicle: "Rover" });
  assert.ok(contains(suggestions, "esc-1", "power-out", "motor-2", "power-in"));
  assert.equal(suggestions.some((entry) => entry.targetId === "motor-1" && entry.targetHandle === "power-in"), false);
});

test("auto-wire does not invent a regulated rail from raw battery or connect unknown components", () => {
  const nodes = [node("battery"), node("flight-controller", "fc"), node("gps"), node("servo")];
  const suggestions = autoWireSuggestions(nodes, [], settings);
  assert.equal(suggestions.some((entry) => entry.signal === "power"), false);
  const unknown = { id: "unknown", position: { x: 0, y: 0 }, data: { componentType: "unsupported-device", label: "Unknown", properties: {} } };
  assert.doesNotThrow(() => autoWireSuggestions([...nodes, unknown], [edge("unknown", "power-out", "gps", "power-in")], settings));
});

test("an auxiliary regulated distribution board can supply the controller without a power module", () => {
  const nodes = [node("battery"), node("power-distribution-board", "pdb"), node("flight-controller", "fc")];
  const suggestions = autoWireSuggestions(nodes, [], settings);
  assert.ok(contains(suggestions, "pdb", "power-out", "fc", "power-in"));
  const repaired = toEdges(suggestions);
  assert.equal(unconnectedRequiredPorts(nodes, repaired).some(endpoint("fc", "power-in")), false);
  assert.equal(autoWireSuggestions(nodes, repaired, settings).length, 0);
  nodes.find((entry) => entry.id === "pdb").data.properties.auxVoltage = "None";
  assert.equal(autoWireSuggestions(nodes, [], settings).some((entry) => entry.targetId === "fc" && entry.targetHandle === "power-in"), false);
});

test("auto-wire keeps competing supplies and shared ESC outputs visible for manual repair", () => {
  const design = createMissionDesign(defaultNewMissionDraft());
  design.edges.push(edge("battery-1", "power-out", "gps-1", "power-in"));
  design.edges.find((entry) => entry.target === "motor-2" && entry.targetHandle === "power-in").source = "esc-1";
  const suggestions = autoWireSuggestions(design.nodes, design.edges, design.settings);
  assert.equal(suggestions.some((entry) => entry.targetId === "gps-1" && entry.targetHandle === "power-in"), false);
  assert.equal(suggestions.some((entry) => ["motor-1", "motor-2"].includes(entry.targetId) && entry.targetHandle === "power-in"), false);
  const issues = validateDesign(design.nodes, [...design.edges, ...toEdges(suggestions)], design.settings).issues;
  assert.ok(issues.some((issue) => issue.title === "Competing input connections"));
  assert.ok(issues.some((issue) => issue.title === "ESC drives multiple motors"));
});

test("multiple CAN sensors can share a harness bus without conflicting input feeds", () => {
  const nodes = [node("flight-controller", "fc"), node("wiring-harness", "harness"),
    node("optical-flow", "flow-1", { interface: "DroneCAN" }), node("optical-flow", "flow-2", { interface: "DroneCAN" })];
  const edges = [edge("flow-1", "can-out", "harness", "can-in"), edge("flow-2", "can-out", "harness", "can-in"),
    edge("harness", "can-out", "fc", "can-in")];
  assert.equal(validDesignConnections(nodes, edges).length, edges.length);
  assert.equal(autoWireSuggestions(nodes, edges, settings).some((entry) => entry.signal === "can"), false);
  assert.equal(validateDesign(nodes, edges, settings).issues.some((issue) => issue.title === "Competing input connections"), false);
});
