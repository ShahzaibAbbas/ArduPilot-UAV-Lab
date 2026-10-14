import assert from "node:assert/strict";
import test from "node:test";
import { adviseTelemetryMessage } from "./telemetryAdvisor.js";

test("battery status text produces a bounded land recommendation", () => {
  const advice = adviseTelemetryMessage({ severity: 2, text: "Battery failsafe: critical" });
  assert.equal(advice.category, "battery");
  assert.equal(advice.recommendedAction, "land");
  assert.ok(advice.steps.length >= 3);
});

test("generic warning remains advisory without an automatic command", () => {
  const advice = adviseTelemetryMessage({ severity: 4, text: "EKF variance" });
  assert.equal(advice.category, "general");
  assert.equal(advice.recommendedAction, undefined);
});

test("bad battery and pre-arm faults request diagnosis without a flight command", () => {
  for (const text of ["PreArm: Battery 1 unhealthy", "Bad battery", "PreArm: Battery low voltage failsafe", "Battery below minimum arming capacity"]) {
    const advice = adviseTelemetryMessage({ severity: 2, text, battery: { remainingPercent: 5 } });
    assert.equal(advice.category, "battery", text);
    assert.equal(advice.recommendedAction, undefined, text);
    assert.match(advice.steps.join(" "), /disarmed/);
  }
});

test("unknown remaining capacity cannot upgrade an ordinary warning to critical", () => {
  for (const remainingPercent of [null, undefined, -1]) {
    const advice = adviseTelemetryMessage({ severity: 4, text: "Battery low", battery: { remainingPercent } });
    assert.equal(advice.title, "Battery warning");
    assert.equal(advice.recommendedAction, "rtl");
  }
});
