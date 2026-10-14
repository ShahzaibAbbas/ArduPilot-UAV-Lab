import assert from "node:assert/strict";
import test from "node:test";
import { SITL_TELEMETRY_GRACE_MS, sitlTelemetryWarning } from "./sitlHealth.js";

const startedAt = "2026-10-14T12:00:00.000Z";
const after = (ms) => Date.parse(startedAt) + ms;
const listener = { active: true, port: 14552 };
const wsl = { source: "wsl", telemetry: { host: "172.29.144.1", port: 14552 } };

test("no telemetry warning while MAVProxy is starting or once a vehicle heartbeat arrives", () => {
  assert.equal(sitlTelemetryWarning({ listener, plan: wsl, upstreamConnected: false }), undefined, "MAVProxy has not started");
  assert.equal(sitlTelemetryWarning({ mavproxyStartedAt: startedAt, now: after(SITL_TELEMETRY_GRACE_MS - 1), listener, plan: wsl, upstreamConnected: false }), undefined);
  assert.equal(sitlTelemetryWarning({ mavproxyStartedAt: startedAt, now: after(120_000), listener, plan: wsl, upstreamConnected: true }), undefined);
});

test("missing WSL telemetry points at the Windows firewall and the exact listener endpoint", () => {
  const warning = sitlTelemetryWarning({ mavproxyStartedAt: startedAt, now: after(SITL_TELEMETRY_GRACE_MS), listener, plan: wsl, upstreamConnected: false });
  assert.match(warning, /UDP 14552 from 172\.29\.144\.1/);
  assert.match(warning, /Firewall/);
  assert.match(warning, /Reset SITL/);
});

test("local SITL and a stopped reader get their own diagnosis", () => {
  const local = sitlTelemetryWarning({ mavproxyStartedAt: startedAt, now: after(60_000), listener, plan: { source: "native", telemetry: { host: "127.0.0.1", port: 14552 } }, upstreamConnected: false });
  assert.doesNotMatch(local, /Firewall/);
  assert.match(local, /MAVProxy console/);
  const stopped = sitlTelemetryWarning({ mavproxyStartedAt: startedAt, now: after(60_000), listener: { active: false, port: 14552 }, plan: wsl, upstreamConnected: false });
  assert.match(stopped, /telemetry reader is stopped/);
});
