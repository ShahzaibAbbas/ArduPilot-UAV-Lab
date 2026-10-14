import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import * as backend from "./airframes.js";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const loaded = new Map();
const requirePackage = createRequire(import.meta.url);
function loadTypeScript(relativeFile) {
  const file = path.resolve(sourceRoot, relativeFile);
  if (loaded.has(file)) return loaded.get(file).exports;
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const module = { exports: {} };
  loaded.set(file, module);
  const requireLocal = (specifier) => {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) {
      return requirePackage(path.resolve(path.dirname(file), specifier));
    }
    return specifier.startsWith(".")
      ? loadTypeScript(path.relative(sourceRoot, path.resolve(path.dirname(file), `${specifier}.ts`)))
      : requirePackage(specifier);
  };
  new Function("require", "module", "exports", outputText)(requireLocal, module, module.exports);
  return module.exports;
}

const frontend = loadTypeScript("domain/airframes.ts");
const { createMissionDesign, defaultNewMissionDraft } = loadTypeScript("domain/missionTemplates.ts");
const { expectedMotorCount, validateDesign } = loadTypeScript("domain/validators.ts");
const { getPort } = loadTypeScript("domain/componentCatalog.ts");
const { assessEngineeringDomains, getEngineeringDomainsForComponent } = loadTypeScript("domain/engineeringDomains.ts");
const { buildPowerBudget } = loadTypeScript("domain/management.ts");

test("frontend and backend agree on every airframe key, vehicle, motor count, and simulator", () => {
  assert.equal(new Set(frontend.airframeValues).size, frontend.airframeOptions.length);
  assert.deepEqual(backend.airframeOptions.map(({ value }) => value), frontend.airframeValues);
  for (const option of frontend.airframeOptions) {
    for (const input of [option.value, option.label, `  ${option.value.toUpperCase()}  `]) {
      assert.equal(frontend.normalizeAirframeValue(input), option.value);
      assert.equal(backend.vehicleForAirframe(input), option.vehicle, input);
      assert.equal(frontend.vehicleForAirframe(input), option.vehicle, input);
      assert.equal(backend.rotorCountForFrame(input), option.rotorCount, input);
      assert.equal(frontend.rotorCountForFrame(input), option.rotorCount, input);
      assert.equal(backend.propulsionMotorCountForFrame(input), frontend.propulsionMotorCountForFrame(input), input);
      assert.equal(backend.simulatorFrameForFrame(input), option.simulatorFrame, input);
      assert.equal(frontend.simulatorFrameForFrame(input), option.simulatorFrame, input);
    }
  }
});

test("fixed-wing and Rover variants select supported native SITL model families", () => {
  const expected = {
    "fixed-wing": ["ArduPlane", "plane"],
    "fixed-wing-trainer": ["ArduPlane", "plane"],
    "fixed-wing-flying-wing": ["ArduPlane", "plane-elevon"],
    "fixed-wing-vtail": ["ArduPlane", "plane-vtail"],
    "fixed-wing-glider": ["ArduPlane", "plane-soaring"],
    "fixed-wing-twin-boom": ["ArduPlane", "plane"],
    quadplane: ["ArduPlane", "quadplane"],
    rover: ["Rover", "rover"],
    "rover-buggy": ["Rover", "rover"],
    "rover-skid": ["Rover", "rover-skid"],
    "rover-tracked": ["Rover", "rover-skid"],
    "rover-6x6": ["Rover", "rover-skid"],
    "rover-balancebot": ["Rover", "balancebot"]
  };
  for (const [key, [vehicle, simulator]] of Object.entries(expected)) {
    assert.equal(backend.vehicleForAirframe(key), vehicle);
    assert.equal(backend.simulatorFrameForFrame(key), simulator);
    assert.equal(backend.usesSimulatorFallback(key), false, `${key} must not be flagged as an unsupported custom rotor layout`);
  }
  assert.equal(backend.usesSimulatorFallback("penta-x"), true);
});

test("legacy airframe keys and simulator aliases retain their family", () => {
  for (const [input, expected] of [["fixed-wing", "fixed-wing"], ["rover", "rover"], ["plane", "fixed-wing"], ["plane-vtail", "fixed-wing-vtail"], ["plane-elevon", "fixed-wing-flying-wing"], ["balancebot", "rover-balancebot"], ["hexax", "hexa-x"], [undefined, "quad-x"]]) {
    assert.equal(frontend.normalizeAirframeValue(input), expected);
  }
  assert.equal(frontend.rotorCountForFrame("balancebot"), 0);
  assert.equal(backend.rotorCountForFrame("balancebot"), 0);
});

test("bare simulator model names select that model's native frame, not the first sharing it", () => {
  for (const [input, expected, rotors] of [["quad", "quad-x", 4], ["hexa", "hexa-x", 6], ["octa", "octa-x", 8], ["tri", "tri-y", 3], ["heli", "single-rotor", 1]]) {
    assert.equal(frontend.normalizeAirframeValue(input), expected, input);
    assert.equal(frontend.rotorCountForFrame(input), rotors, input);
    assert.equal(backend.rotorCountForFrame(input), rotors, input);
    assert.equal(backend.propulsionMotorCountForFrame(input), rotors, input);
    assert.equal(backend.usesSimulatorFallback(input), false, input);
  }
});

test("new missions retain each selected variant and connect its required propulsion and controls", () => {
  for (const option of frontend.airframeOptions.filter(({ vehicle }) => vehicle !== "ArduCopter")) {
    const design = createMissionDesign({ ...defaultNewMissionDraft(), vehicle: option.vehicle, frame: option.value });
    assert.equal(design.settings.frame, option.value);
    assert.equal(design.nodes.find(({ data }) => data.componentType === "frame").data.properties.layout, option.value);
    const motors = design.nodes.filter(({ data }) => data.componentType === "motor");
    assert.equal(motors.length, option.propulsionMotorCount, option.value);
    assert.equal(design.nodes.filter(({ data }) => data.componentType === "esc").length, motors.length, option.value);
    assert.equal(expectedMotorCount(design.settings), motors.length, option.value);
    for (const edge of design.edges) {
      const source = design.nodes.find(({ id }) => id === edge.source);
      const target = design.nodes.find(({ id }) => id === edge.target);
      const sourcePort = getPort(source.data.componentType, edge.sourceHandle);
      const targetPort = getPort(target.data.componentType, edge.targetHandle);
      assert.ok(sourcePort && targetPort, `${option.value}: ${edge.id}`);
      assert.equal(sourcePort.kind, targetPort.kind, `${option.value}: ${edge.id}`);
      assert.equal(sourcePort.direction, "output");
      assert.equal(targetPort.direction, "input");
    }
    const issues = validateDesign(design.nodes, design.edges, design.settings).issues;
    assert.deepEqual(issues.filter(({ id }) => id.startsWith("motor-count") || id.startsWith("esc-count") || id.includes("missing-port") || id.includes("missing-node")), [], option.value);
    const servos = design.nodes.filter(({ data }) => data.componentType === "servo");
    if (option.vehicle === "ArduPlane") assert.ok(servos.length >= 2, option.value);
    if (option.vehicle === "Rover") {
      assert.ok(motors.every(({ data }) => data.properties.propulsionRole === "Ground drive"));
      assert.equal(servos.length, option.simulatorFrame === "rover" ? 1 : 0);
    }
    if (option.value === "quadplane") {
      assert.equal(motors.filter(({ data }) => data.properties.propulsionRole === "Lift").length, 4);
      assert.equal(motors.filter(({ data }) => data.properties.propulsionRole === "Cruise").length, 1);
    }
  }
});

test("a frame from another vehicle family falls back without crossing autopilot types", () => {
  for (const [vehicle, frame, expected] of [["ArduPlane", "rover-skid", "fixed-wing"], ["Rover", "quadplane", "rover"], ["ArduCopter", "fixed-wing-trainer", "quad-x"]]) {
    assert.equal(createMissionDesign({ ...defaultNewMissionDraft(), vehicle, frame }).settings.frame, expected);
  }
});

test("control servos contribute power loads and report missing command, supply, and mounting", () => {
  const design = createMissionDesign({ ...defaultNewMissionDraft(), vehicle: "ArduPlane", frame: "fixed-wing-flying-wing" });
  const servo = design.nodes.find(({ data }) => data.componentType === "servo");
  assert.ok(getEngineeringDomainsForComponent("servo").some(({ id }) => id === "propulsion"));
  const row = buildPowerBudget(design.nodes, design.settings).rows.find(({ nodeId }) => nodeId === servo.id);
  assert.ok(row && row.rail === "regulated-5v" && row.peakCurrentA > 0);
  const completeIssues = validateDesign(design.nodes, design.edges, design.settings).issues;
  assert.deepEqual(completeIssues.filter(({ id }) => id.startsWith(`servo-${servo.id}`)), []);
  const disconnected = design.edges.filter(({ target }) => target !== servo.id);
  const issues = validateDesign(design.nodes, disconnected, design.settings).issues;
  assert.equal(issues.filter(({ id }) => id.startsWith(`servo-${servo.id}`)).length, 3);
});

test("Rover propulsion ratings use drive torque instead of aircraft thrust", () => {
  const design = createMissionDesign({ ...defaultNewMissionDraft(), vehicle: "Rover", frame: "rover-skid" });
  const rating = () => assessEngineeringDomains(design.nodes, design.edges, design.settings)
    .find(({ id }) => id === "propulsion").checks.find(({ id }) => id.endsWith("propulsion-ratings"));
  assert.equal(rating().passed, true);
  for (const motor of design.nodes.filter(({ data }) => data.componentType === "motor")) {
    motor.data.properties.driveTorqueNm = 0;
    motor.data.properties.thrustGrams = 950;
  }
  assert.equal(rating().passed, false);
});
