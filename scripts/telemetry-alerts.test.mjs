import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("../src/lib/telemetryAlerts.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const module = { exports: {} };
new Function("module", "exports", outputText)(module, module.exports);
const { collectTelemetryAlerts } = module.exports;
const now = Date.parse("2026-10-14T01:00:00Z");
const at = (offset = 0) => new Date(now + offset).toISOString();
const settings = { lowPercent: 30, criticalPercent: 18, lowVoltageV: 14, criticalVoltageV: 13.2, lowAction: "RTL", criticalAction: "Land", vehicle: "ArduCopter" };
const vehicle = (overrides = {}) => ({ id: "1:1", sysid: 1, compid: 1, lastSeenAt: at(), heartbeat: { armed: true, type: 2, autopilot: 3 },
  battery: { voltageV: 16.8, remainingPercent: 100, receivedAt: at() }, ...overrides });
const alerts = (sample, config = settings, active = true) => collectTelemetryAlerts({ listener: { active }, vehicles: [sample] }, config, now);

test("uses configured critical percentage rather than half the low threshold", () => {
  const result = alerts(vehicle({ battery: { voltageV: 16, remainingPercent: 17, receivedAt: at() } }));
  assert.equal(result[0].title, "Battery critically low");
  assert.deepEqual(result[0].command, { action: "land" });
  assert.match(result[0].detail, /critical reserve 18%/);
});
test("voltage triggers even when remaining capacity is unknown or healthy", () => {
  for (const remainingPercent of [-1, 90, undefined]) {
    const result = alerts(vehicle({ battery: { voltageV: 13.8, remainingPercent, receivedAt: at() } }));
    assert.equal(result[0].title, "Battery reserve low");
    assert.deepEqual(result[0].command, { action: "rtl" });
    assert.match(result[0].detail, /low voltage 14.0 V/);
  }
  assert.equal(alerts(vehicle({ battery: { voltageV: 13.1, remainingPercent: 90, receivedAt: at() } }))[0].severity, 2);
});
test("pack replacement thresholds are recalculated and healthy values clear the alert", () => {
  const sample = vehicle({ battery: { voltageV: 20, remainingPercent: 80, receivedAt: at() } });
  assert.equal(alerts(sample).length, 0);
  assert.equal(alerts(sample, { ...settings, lowVoltageV: 21, criticalVoltageV: 19.8 })[0].title, "Battery reserve low");
  assert.equal(alerts(vehicle({ battery: { voltageV: 25.2, remainingPercent: 100, receivedAt: at() } }), { ...settings, lowVoltageV: 21, criticalVoltageV: 19.8 }).length, 0);
});
test("unknown readings, disabled capacity thresholds, stale samples and stopped listeners do not trigger", () => {
  assert.equal(alerts(vehicle({ battery: { voltageV: undefined, remainingPercent: -1, receivedAt: at() } })).length, 0);
  assert.equal(alerts(vehicle({ battery: { voltageV: 16, remainingPercent: 0, receivedAt: at() } }), { ...settings, lowPercent: 0, criticalPercent: 0 }).length, 0);
  assert.equal(alerts(vehicle({ lastSeenAt: at(-16000) })).length, 0);
  assert.equal(alerts(vehicle({ battery: { voltageV: 0, receivedAt: at(-16000) } })).length, 0);
  assert.equal(alerts(vehicle({ battery: { voltageV: 0, receivedAt: at() } }), settings, false).length, 0);
});
test("deduplicates one low incident across percentage updates while critical escalation has a new key", () => {
  const sample = (remainingPercent) => vehicle({ battery: { voltageV: 16, remainingPercent, receivedAt: at() } });
  assert.equal(alerts(sample(29))[0].key, alerts(sample(28))[0].key);
  assert.notEqual(alerts(sample(28))[0].key, alerts(sample(17))[0].key);
});
test("disarmed and prearm battery faults recommend inspection without flight commands", () => {
  const sample = vehicle({ heartbeat: { armed: false, type: 2 }, battery: { voltageV: 0, chargeState: 5, receivedAt: at() } });
  const result = alerts(sample)[0];
  assert.equal(result.title, "Battery fault reported");
  assert.equal(result.command, undefined);
  assert.match(result.recommendation, /disarmed/);
  assert.equal(alerts(vehicle({ statusText: { text: "PreArm: Battery 1 unhealthy", severity: 4, receivedAt: at() } }))[0].command, undefined);
});
test("Rover uses Hold and Warn has no command; SmartRTL follows configured action", () => {
  const sample = vehicle({ heartbeat: { armed: true, type: 10, autopilot: 3 }, battery: { remainingPercent: 10, voltageV: 16, receivedAt: at() } });
  assert.deepEqual(alerts(sample, { ...settings, vehicle: "Rover", criticalAction: "Hold" })[0].command, { action: "mode", mode: "hold" });
  assert.equal(alerts(vehicle({ battery: { remainingPercent: 25, voltageV: 16, receivedAt: at() } }), { ...settings, lowAction: "Warn" })[0].command, undefined);
  assert.deepEqual(alerts(sample, { ...settings, criticalAction: "SmartRTL" })[0].command, { action: "mode", mode: "smart_rtl" });
});
test("new status and bounded age supersede historical warnings", () => {
  const warning = { text: "Battery low", severity: 4, receivedAt: at(-1000) };
  assert.equal(alerts(vehicle({ statusHistory: [warning], statusText: { text: "Ready", severity: 6, receivedAt: at() } })).length, 0);
  assert.equal(alerts(vehicle({ statusText: { ...warning, receivedAt: at(-31000) } })).length, 0);
});
test("unhealthy packs alarm but charging packs do not; unknown autopilots have no recovery command", () => {
  assert.equal(alerts(vehicle({ battery: { voltageV: 16, remainingPercent: 90, chargeState: 6, receivedAt: at() } }))[0].title, "Battery fault reported");
  assert.equal(alerts(vehicle({ battery: { voltageV: 16, remainingPercent: 90, chargeState: 7, receivedAt: at() } })).length, 0);
  for (const heartbeat of [{ armed: true, type: 0, autopilot: 3 }, { armed: true, type: 2, autopilot: 12 }]) {
    assert.equal(alerts(vehicle({ heartbeat, battery: { voltageV: 0, receivedAt: at() } }))[0].command, undefined);
  }
});
