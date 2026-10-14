import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { batteryMetrics } from "./batteryModel.js";

const templateFile = new URL("../src/domain/productTemplates.ts", import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(templateFile, "utf8"), {
  fileName: templateFile.pathname,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const templateModule = { exports: {} };
new Function("require", "module", "exports", outputText)((specifier) => {
  assert.fail(`Product templates unexpectedly require a runtime dependency: ${specifier}`);
}, templateModule, templateModule.exports);
const presets = templateModule.exports.productTemplates.filter((template) => template.baseType === "battery");
const preset = (id) => {
  const result = presets.find((template) => template.id === id);
  assert.ok(result, `Missing battery preset ${id}`);
  return result.properties;
};
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${expected}, received ${actual}`);
const assertFiniteMetrics = (metrics) => {
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number") assert.ok(Number.isFinite(value), `${key} must be finite, received ${value}`);
  }
  assert.ok(metrics.massG > 0, "A mass estimate must remain positive");
};
const hasIssue = (metrics, key, severity = "error") => metrics.issues.some((issue) => issue.key === key && issue.severity === severity);

test("four battery presets retain manufacturer attribution and published pack configurations", () => {
  assert.equal(presets.length, 4);
  for (const template of presets) {
    const properties = template.properties;
    assert.match(properties.specManufacturer, /Tattu|MaxAmps/);
    assert.ok(properties.specModel);
    assert.ok(properties.specPartNumber);
    const source = new URL(properties.specDatasheetUrl);
    assert.equal(source.protocol, "https:");
    assert.ok(["www.genstattu.com", "genstattu.com", "maxamps.com"].includes(source.hostname));
    assert.deepEqual(batteryMetrics(properties).issues, [], template.name);
    assertFiniteMetrics(batteryMetrics(properties));
  }
});

test("Tattu 4S 5200 LiPo uses published voltage, 76.96 Wh, 182 A and 436.5 g", () => {
  const properties = preset("preset-4s-5200-lipo");
  const metrics = batteryMetrics(properties);
  assert.equal(metrics.chemistry, "LiPo");
  assert.equal(metrics.seriesCells, 4);
  assert.equal(metrics.parallelCells, 1);
  assert.equal(metrics.capacityAh, 5.2);
  closeTo(metrics.nominalVoltageV, 14.8);
  closeTo(metrics.fullVoltageV, 16.8);
  closeTo(metrics.energyWh, 76.96);
  assert.equal(metrics.continuousCurrentA, 182);
  assert.equal(metrics.burstCurrentA, 364);
  assert.equal(metrics.massG, 436.5);
  assert.equal(metrics.massSource, "spec");
  assert.equal(properties.dischargeConnector, "XT60");
  assert.equal(properties.balanceConnector, "JST-XHR");
  assert.deepEqual([properties.packLengthMm, properties.packWidthMm, properties.packHeightMm], [133, 45, 33.5]);
});

test("Tattu 6S 22000 LiPo uses pack capacity and leaves unverified burst capability unspecified", () => {
  const properties = preset("preset-tattu-6s-22000-lipo");
  const metrics = batteryMetrics(properties);
  assert.equal(metrics.capacityAh, 22);
  closeTo(metrics.nominalVoltageV, 22.2);
  closeTo(metrics.fullVoltageV, 25.2);
  closeTo(metrics.energyWh, 488.4);
  assert.equal(metrics.continuousCurrentA, 660);
  assert.equal(metrics.burstCRating, 0);
  assert.equal(metrics.massG, 2460);
  assert.deepEqual([properties.packLengthMm, properties.packWidthMm, properties.packHeightMm], [206, 91, 61]);
});

test("Tattu LiHV uses 22.8 V nominal, 26.1 V full and 387.6 Wh", () => {
  const properties = preset("preset-tattu-6s-17000-lihv");
  const metrics = batteryMetrics(properties);
  assert.equal(metrics.chemistry, "LiHV");
  assert.equal(metrics.nominalCellVoltageV, 3.8);
  assert.equal(metrics.maxCellVoltageV, 4.35);
  closeTo(metrics.nominalVoltageV, 22.8);
  closeTo(metrics.fullVoltageV, 26.1);
  closeTo(metrics.energyWh, 387.6);
  assert.equal(metrics.continuousCurrentA, 255);
  assert.equal(metrics.burstCurrentA, 510);
  assert.equal(metrics.massG, 1874);
  assert.deepEqual([properties.packLengthMm, properties.packWidthMm, properties.packHeightMm], [192, 76, 62]);
});

test("MaxAmps 6S2P retains 9 Ah total capacity, 194.4 Wh, 90 A and current 874 g specification", () => {
  const properties = preset("preset-maxamps-6s2p-9000-li-ion");
  const metrics = batteryMetrics(properties);
  assert.equal(metrics.chemistry, "Li-ion");
  assert.equal(metrics.seriesCells, 6);
  assert.equal(metrics.parallelCells, 2);
  assert.equal(metrics.capacityMah, 9000);
  assert.equal(metrics.capacityAh, 9);
  closeTo(metrics.nominalVoltageV, 21.6);
  closeTo(metrics.fullVoltageV, 25.2);
  closeTo(metrics.energyWh, 194.4);
  assert.equal(metrics.packContinuousCurrentA, 90);
  assert.equal(metrics.continuousCurrentA, 90);
  assert.equal(metrics.massG, 874);
  assert.equal(metrics.massSource, "spec");
  assert.deepEqual([properties.packLengthMm, properties.packWidthMm, properties.packHeightMm], [129, 44, 78]);
  assert.equal(properties.dischargeConnector, "");
  assert.equal(properties.balanceConnector, "");
  assert.match(properties.specNotes, /10C is calculated/);
});

test("parallel configuration never multiplies published capacity, energy, current or mass", () => {
  const properties = preset("preset-maxamps-6s2p-9000-li-ion");
  const baseline = batteryMetrics(properties);
  for (const parallelCells of [1, 2, 4, 20]) {
    const metrics = batteryMetrics({ ...properties, parallelCells });
    assert.equal(metrics.parallelCells, parallelCells);
    for (const key of ["capacityMah", "capacityAh", "energyWh", "continuousCurrentA", "massG"]) {
      assert.equal(metrics[key], baseline[key], key);
    }
  }
});

test("unknown optional limits remain zero and do not invent connector or charge ratings", () => {
  for (const template of presets) {
    const properties = template.properties;
    const metrics = batteryMetrics(properties);
    assert.equal(properties.connectorCurrentA, 0);
    assert.equal(metrics.connectorCurrentA, 0);
    assert.equal(metrics.chargeRateC, 0);
    assert.equal(metrics.chargeCurrentA, 0);
    assert.equal(properties.nominalCellVoltageV, 0);
    assert.equal(properties.maxCellVoltageV, 0);
  }
  const metrics = batteryMetrics({ burstCRating: 0, chargeRateC: 0, connectorCurrentA: 0,
    packLengthMm: 0, packWidthMm: 0, packHeightMm: 0 });
  assert.deepEqual(metrics.issues, []);
  assert.equal(metrics.burstCRating, 0);
  assert.equal(metrics.chargeCurrentA, 0);
});

test("legacy batteries use LiPo defaults and zero voltage overrides use chemistry defaults", () => {
  const legacy = batteryMetrics({ cells: 4, capacityMah: 5200, cRating: 35 });
  assert.equal(legacy.chemistry, "LiPo");
  assert.equal(legacy.parallelCells, 1);
  assert.equal(legacy.massSource, "estimated");
  closeTo(legacy.energyWh, 76.96);
  assert.deepEqual(legacy.issues, []);
  for (const [chemistry, nominal, full] of [["LiPo", 3.7, 4.2], ["LiHV", 3.8, 4.35], ["Li-ion", 3.6, 4.2]]) {
    const metrics = batteryMetrics({ chemistry, nominalCellVoltageV: 0, maxCellVoltageV: 0,
      lowCellVoltageV: 0, criticalCellVoltageV: 0 });
    assert.equal(metrics.nominalCellVoltageV, nominal);
    assert.equal(metrics.maxCellVoltageV, full);
    assert.equal(metrics.lowCellVoltageV, 3.5);
    assert.equal(metrics.criticalCellVoltageV, 3.3);
  }
});

test("a direct amp rating can define continuous capability without a C-rating", () => {
  const metrics = batteryMetrics({ capacityMah: 9000, cRating: 0, continuousCurrentA: 90 });
  assert.equal(metrics.packContinuousCurrentA, 90);
  assert.equal(metrics.continuousCurrentA, 90);
  assert.deepEqual(metrics.issues, []);
  const unknown = batteryMetrics({ cRating: 0, continuousCurrentA: 0, burstCRating: 200, connectorCurrentA: 60 });
  assert.equal(unknown.packContinuousCurrentA, 0);
  assert.equal(unknown.continuousCurrentA, 0);
  assert.ok(hasIssue(unknown, "cRating"), "A burst or connector rating cannot establish continuous pack capability");
});

test("the lowest documented pack or connector limit caps continuous and burst output", () => {
  const base = { capacityMah: 9000, cRating: 10, burstCRating: 20 };
  assert.equal(batteryMetrics({ ...base, continuousCurrentA: 70 }).packContinuousCurrentA, 70);
  assert.equal(batteryMetrics({ ...base, continuousCurrentA: 120 }).packContinuousCurrentA, 90);
  const limited = batteryMetrics({ ...base, continuousCurrentA: 70, connectorCurrentA: 50 });
  assert.equal(limited.packContinuousCurrentA, 70);
  assert.equal(limited.continuousCurrentA, 50);
  assert.equal(limited.burstCurrentA, 50);
  const direct = batteryMetrics({ cRating: 0, continuousCurrentA: 90, connectorCurrentA: 30 });
  assert.equal(direct.continuousCurrentA, 30);
  assert.equal(direct.burstCurrentA, 30);
});

test("valid source-specific voltage, threshold and charge overrides drive pack calculations", () => {
  const properties = Object.freeze({ chemistry: "Li-ion", cells: 6, capacityMah: 10000, cRating: 10,
    nominalCellVoltageV: 3.7, maxCellVoltageV: 4.1, lowCellVoltageV: 3.4, criticalCellVoltageV: 3.1, chargeRateC: 0.5 });
  const metrics = batteryMetrics(properties);
  closeTo(metrics.nominalVoltageV, 22.2);
  closeTo(metrics.fullVoltageV, 24.6);
  closeTo(metrics.lowVoltageV, 20.4);
  closeTo(metrics.criticalVoltageV, 18.6);
  closeTo(metrics.energyWh, 222);
  assert.equal(metrics.chargeCurrentA, 5);
  assert.deepEqual(metrics.issues, []);
});

test("unsafe voltage ordering and chemistry charge limits produce located errors", () => {
  for (const [properties, key] of [
    [{ nominalCellVoltageV: 1.9 }, "nominalCellVoltageV"],
    [{ nominalCellVoltageV: 4.2 }, "nominalCellVoltageV"],
    [{ chemistry: "LiPo", maxCellVoltageV: 4.35 }, "maxCellVoltageV"],
    [{ chemistry: "Li-ion", maxCellVoltageV: 4.25 }, "maxCellVoltageV"],
    [{ criticalCellVoltageV: 3.6, lowCellVoltageV: 3.5 }, "criticalCellVoltageV"],
    [{ criticalCellVoltageV: 1.9 }, "criticalCellVoltageV"],
    [{ lowCellVoltageV: 4.2 }, "criticalCellVoltageV"]
  ]) {
    const metrics = batteryMetrics(properties);
    assert.ok(hasIssue(metrics, key), JSON.stringify(properties));
    assertFiniteMetrics(metrics);
  }
  assert.deepEqual(batteryMetrics({ chemistry: "LiHV", maxCellVoltageV: 4.4 }).issues, []);
});

test("burst capability cannot be below a documented continuous rating", () => {
  assert.ok(hasIssue(batteryMetrics({ cRating: 35, burstCRating: 20 }), "burstCRating"));
  assert.ok(hasIssue(batteryMetrics({ capacityMah: 1000, cRating: 0, continuousCurrentA: 30, burstCRating: 10 }), "burstCRating"));
});

test("partial physical dimensions report a warning and a complete envelope clears it", () => {
  const partial = batteryMetrics({ packLengthMm: 133 });
  assert.ok(hasIssue(partial, "packLengthMm", "warning"));
  assert.equal(partial.issues.some((issue) => issue.severity === "error"), false);
  assert.deepEqual(batteryMetrics({ packLengthMm: 133, packWidthMm: 45, packHeightMm: 33.5 }).issues, []);
});

test("malformed numeric fields yield located errors and finite fallback calculations", () => {
  const fields = ["cells", "parallelCells", "capacityMah", "cRating", "burstCRating", "continuousCurrentA", "connectorCurrentA",
    "nominalCellVoltageV", "maxCellVoltageV", "lowCellVoltageV", "criticalCellVoltageV", "specMassG",
    "packLengthMm", "packWidthMm", "packHeightMm", "chargeRateC"];
  for (const key of fields) {
    for (const value of [null, "", " ", true, false, {}, [], NaN, Infinity, -Infinity, -1]) {
      const metrics = batteryMetrics({ [key]: value });
      assert.ok(hasIssue(metrics, key), `${key} should reject ${String(value)}`);
      assertFiniteMetrics(metrics);
    }
  }
  for (const key of ["cells", "parallelCells"]) assert.ok(hasIssue(batteryMetrics({ [key]: 1.5 }), key));
  for (const chemistry of ["unknown", "lipo", 10, {}, []]) {
    const metrics = batteryMetrics({ chemistry });
    assert.ok(hasIssue(metrics, "chemistry"));
    assert.equal(metrics.chemistry, "LiPo");
  }
});

test("numeric strings are accepted without mutating saved battery properties", () => {
  const properties = Object.freeze({ cells: "6", parallelCells: "2", capacityMah: "9000", cRating: "10", specMassG: "874" });
  const metrics = batteryMetrics(properties);
  assert.equal(metrics.seriesCells, 6);
  assert.equal(metrics.parallelCells, 2);
  assert.equal(metrics.capacityAh, 9);
  assert.equal(metrics.continuousCurrentA, 90);
  assert.equal(metrics.massG, 874);
  assert.equal(properties.cells, "6");
  assert.deepEqual(metrics.issues, []);
});

test("missing manufacturer mass uses a finite positive estimate for every supported chemistry", () => {
  for (const chemistry of ["LiPo", "LiHV", "Li-ion"]) {
    for (const properties of [
      {}, { cells: 1, capacityMah: 50 }, { cells: 24, parallelCells: 20, capacityMah: 100000 },
      { cells: NaN, capacityMah: Infinity, specMassG: -1 }
    ]) {
      const metrics = batteryMetrics({ ...properties, chemistry });
      assert.equal(metrics.massSource, "estimated");
      assertFiniteMetrics(metrics);
    }
    const measured = batteryMetrics({ chemistry, specMassG: 1 });
    assert.equal(measured.massSource, "spec");
    assert.equal(measured.massG, 1);
  }
});

test("malformed top-level battery properties fail safely without throwing", () => {
  for (const value of [null, [], "battery", 12, true]) {
    const metrics = batteryMetrics(value);
    assert.ok(hasIssue(metrics, "properties"));
    assertFiniteMetrics(metrics);
  }
});
