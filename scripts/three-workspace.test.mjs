import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

// Exercise the real pure TypeScript modules with the existing compiler. This
// keeps the Node test suite usable without introducing a browser test runner.
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const loaded = new Map();
function loadTypeScript(relativeFile) {
  const file = path.resolve(sourceRoot, relativeFile);
  if (loaded.has(file)) return loaded.get(file).exports;
  const source = readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  const module = { exports: {} };
  loaded.set(file, module);
  const requireLocal = (specifier) => {
    assert.ok(specifier.startsWith("."), "Pure workspace modules must not depend on runtime packages");
    return loadTypeScript(path.relative(sourceRoot, path.resolve(path.dirname(file), specifier + ".ts")));
  };
  new Function("require", "module", "exports", outputText)(requireLocal, module, module.exports);
  return module.exports;
}

const { normalizeThreeTransform, cloneThreeTransform } = loadTypeScript("domain/threePresentation.ts");
const { labSettingsWithDefaults } = loadTypeScript("domain/workspaceMigration.ts");
const { defaultLabSettings } = loadTypeScript("domain/design.ts");
const { automaticTransform, resolveSceneNodes } = loadTypeScript("components/three/sceneLayout.ts");
const { geometryForComponent } = loadTypeScript("lib/three/geometryFactory.ts");
const { airframeModelScale } = loadTypeScript("lib/three/airframeGeometry.ts");
const { aerodynamicFlowLength, attitudeRotation, normalizeFlightDynamics } = loadTypeScript("lib/three/flightDynamics.ts");
const { airframeOptions } = loadTypeScript("domain/airframes.ts");

test("airframe dimension edits preserve defaults and scale the corresponding 3D axis", () => {
  for (const model of airframeOptions) {
    assert.deepEqual(airframeModelScale(model.value, {}), [1, 1, 1]);
    if (!model.dimensions) continue;
    assert.deepEqual(airframeModelScale(model.value, { spanMm: model.dimensions.spanM * 2000 }), [2, 1, 1]);
    assert.deepEqual(airframeModelScale(model.value, { lengthMm: model.dimensions.lengthM * 2000 }), [1, 1, 2]);
    assert.deepEqual(airframeModelScale(model.value, { heightMm: NaN, spanMm: -1, lengthMm: true }), [1, 1, 1]);
  }
});

const node = (id, x, y, presentation3d) => ({
  id, position: { x, y }, presentation3d,
  data: { componentType: "flight-controller", label: id, properties: {} }
});

test("legacy workspaces receive independent defaults without mutating shared settings", () => {
  for (const value of [undefined, null, [], "invalid", {}, { three: null, trace: [] }]) {
    assert.deepEqual(labSettingsWithDefaults(value), defaultLabSettings);
  }
  const migrated = labSettingsWithDefaults();
  migrated.three.showLabels = false;
  migrated.trace.text = "changed";
  assert.equal(defaultLabSettings.three.showLabels, true);
  assert.equal(defaultLabSettings.trace.text, "");
});

test("workspace options reject wrong types and bound restored packet filters", () => {
  const migrated = labSettingsWithDefaults({
    viewMode: "3d",
    three: { showLabels: "false", showWires: false, isolateSelection: 1, reducedMotion: true, unknown: true },
    trace: { direction: "tx", protocol: "MAVLink2", systemId: "0255", componentId: "256", messageId: "16777215", text: "x".repeat(600) }
  });
  assert.deepEqual(migrated.three, { showLabels: true, showWires: false, isolateSelection: false, reducedMotion: true });
  assert.equal(migrated.viewMode, "3d");
  assert.deepEqual(migrated.trace, {
    direction: "tx", protocol: "MAVLink2", systemId: "255", componentId: "", messageId: "16777215", text: "x".repeat(512)
  });
  assert.deepEqual(labSettingsWithDefaults({ trace: { direction: [], protocol: 1, systemId: true, componentId: "-1", messageId: "16777216", text: {} } }).trace, defaultLabSettings.trace);
});

test("invalid transforms remain optional and partial transforms get safe numeric defaults", () => {
  for (const value of [null, undefined, [], true, "invalid"]) assert.equal(normalizeThreeTransform(value), undefined);
  assert.deepEqual(normalizeThreeTransform({ position: { x: 2, y: "3", z: null }, scale: { x: false, y: NaN, z: Infinity } }), {
    position: { x: 2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }
  });
});

test("extreme transforms are bounded and rotations preserve their orientation", () => {
  const normalized = normalizeThreeTransform({
    position: { x: Number.MAX_VALUE, y: -1e20, z: 9 },
    rotation: { x: 5 * Math.PI, y: -5 * Math.PI, z: Number.MAX_VALUE },
    scale: { x: 0, y: -2, z: 1e20 }
  });
  assert.deepEqual(normalized.position, { x: 10000, y: -10000, z: 9 });
  assert.deepEqual(normalized.scale, { x: 0.1, y: 0.1, z: 100 });
  assert.equal(normalized.rotation.x, Math.PI);
  assert.equal(normalized.rotation.y, -Math.PI);
  assert.ok(Number.isFinite(normalized.rotation.z));
  assert.ok(Math.abs(normalized.rotation.z) <= Math.PI * 2);
});

test("automatic layout is deterministic, centered, and invariant to a 2D translation", () => {
  const nodes = [node("a", 0, 145), node("b", 290, 435)];
  const original = resolveSceneNodes(nodes);
  const shifted = resolveSceneNodes(nodes.map((entry) => ({ ...entry, position: { x: entry.position.x + 580, y: entry.position.y - 290 } })));
  assert.deepEqual(original.map((entry) => entry.transform), shifted.map((entry) => entry.transform));
  assert.equal(original[0].transform.position.x, -1);
  assert.equal(original[1].transform.position.z, 1);
  assert.ok(original.every((entry) => entry.automatic));
  assert.deepEqual(automaticTransform(nodes[0], nodes), original[0].transform);
  assert.deepEqual(resolveSceneNodes([]), []);
});

test("saved transforms survive layout changes and resolved values do not alias the workspace", () => {
  const saved = normalizeThreeTransform({ position: { x: 4, y: 5, z: 6 } });
  const nodes = [node("saved", 10, 20, saved), node("automatic", 80, 90)];
  const resolved = resolveSceneNodes(nodes);
  assert.equal(resolved[0].automatic, false);
  assert.deepEqual(resolved[0].transform, saved);
  const moved = resolveSceneNodes([nodes[0], node("automatic", 1000, 9000)]);
  assert.deepEqual(moved[0].transform, saved);
  resolved[0].transform.position.x = -999;
  const clone = cloneThreeTransform(saved);
  clone.scale.x = 20;
  assert.equal(saved.position.x, 4);
  assert.equal(saved.scale.x, 1);
});

test("malformed imported coordinates cannot introduce non-finite render transforms", () => {
  const resolved = resolveSceneNodes([node("bad", Infinity, NaN, []), node("huge", Number.MAX_VALUE, -Number.MAX_VALUE)]);
  assert.ok(resolved[0].automatic);
  for (const entry of resolved) {
    assert.ok(Object.values(entry.transform).flatMap(Object.values).every(Number.isFinite));
    assert.ok(Math.abs(entry.transform.position.x) <= 10000);
    assert.ok(Math.abs(entry.transform.position.z) <= 10000);
  }
});

test("every component has procedural geometry even when no specialized model exists", () => {
  for (const component of ["flight-controller", "motor", "frame", "battery", "payload-camera", "custom-future-component"]) {
    const geometry = geometryForComponent(component);
    assert.ok(["box", "cylinder", "sphere", "frame"].includes(geometry.kind));
    assert.ok(geometry.size.every((dimension) => Number.isFinite(dimension) && dimension > 0));
  }
  assert.equal(geometryForComponent("custom-future-component").kind, "box");
});

test("flight dynamics are mapped to the 3D pose and bounded aero flow", () => {
  const live = normalizeFlightDynamics({
    source: "telemetry",
    connected: true,
    rollDeg: 18,
    pitchDeg: -6,
    yawDeg: 42,
    airspeedMps: 24,
    windSpeedMps: 8,
    windGustMps: 14
  });
  assert.deepEqual(attitudeRotation(live).map((value) => Number(value.toFixed(6))), [Number((-6 * Math.PI / 180).toFixed(6)), Number((42 * Math.PI / 180).toFixed(6)), Number((18 * Math.PI / 180).toFixed(6))]);
  assert.ok(aerodynamicFlowLength(live) > 0.65);
  assert.ok(aerodynamicFlowLength({ ...live, airspeedMps: 10_000, windGustMps: 10_000 }) <= 3.4);
  const corrupt = normalizeFlightDynamics({ source: "telemetry", rollDeg: Infinity, pitchDeg: -Infinity, airspeedMps: "bad" });
  assert.deepEqual([corrupt.rollDeg, corrupt.pitchDeg, corrupt.airspeedMps], [0, 0, 0]);
});
