import test from "node:test";
import assert from "node:assert/strict";
import { buildSitlPlan, labTelemetryPort, sitlWindowArgs, telemetryHostFor } from "./sitl.js";

test("lab telemetry defaults, configured ports and active reader precedence", () => {
  assert.equal(labTelemetryPort({}), 14552);
  assert.equal(labTelemetryPort({ labTelemetryPort: 15552 }), 15552);
  assert.equal(labTelemetryPort({ labTelemetryPort: 15552 }, { active: true, port: 16552 }), 16552);
  for (const port of [0, 1023, 65536, 14552.5, NaN, ""]) {
    assert.throws(() => labTelemetryPort({ labTelemetryPort: port }), { statusCode: 400 });
  }
});

test("headless plans omit GUI windows and unconfigured implicit UDP outputs", () => {
  assert.deepEqual(sitlWindowArgs({}), ["--no-extra-ports", "--no-wsl2-network"]);
  assert.deepEqual(sitlWindowArgs({ sitlHeadless: false, sitlRebuild: false }), ["--console", "--map", "--no-rebuild", "--no-extra-ports", "--no-wsl2-network"]);
  assert.deepEqual(sitlWindowArgs({ sitlWipeOnLaunch: true }), ["--wipe-eeprom", "--no-extra-ports", "--no-wsl2-network"]);
  assert.throws(() => sitlWindowArgs({ sitlHeadless: "false" }), { statusCode: 400 });
  assert.throws(() => sitlWindowArgs({ sitlRebuild: "false" }), { statusCode: 400 });
  assert.throws(() => sitlWindowArgs({ sitlWipeOnLaunch: "true" }), { statusCode: 400 });
});

test("telemetry uses loopback for native and mirrored WSL, Windows gateway for NAT", async () => {
  assert.equal(await telemetryHostFor({ source: "native" }, () => assert.fail("native should not probe WSL")), "127.0.0.1");
  const detection = { source: "wsl", distro: "Test distro" };
  assert.equal(await telemetryHostFor(detection, async (_command, args) => {
    assert.deepEqual(args, ["-d", "Test distro", "--exec", "wslinfo", "--networking-mode"]);
    return { ok: true, stdout: "mirrored\n" };
  }), "127.0.0.1");
  for (const mode of [{ ok: true, stdout: "nat\n" }, { ok: false, stdout: "" }]) {
    assert.equal(await telemetryHostFor(detection, async (_command, args) => args.includes("wslinfo") ? mode : {
      ok: true, stdout: '[{"dst":"default","gateway":"172.20.0.1"}]'
    }), "172.20.0.1");
  }
  for (const stdout of ["bad JSON", "[]", '[{"gateway":"999.0.0.1"}]']) {
    await assert.rejects(telemetryHostFor(detection, async () => ({ ok: true, stdout })), { statusCode: 409 });
  }
});

test("invalid connection options reject before searching runtimes or writing exports", async () => {
  await assert.rejects(buildSitlPlan({ settings: { labTelemetryPort: 0 } }), { statusCode: 400 });
  await assert.rejects(buildSitlPlan({ settings: { sitlHeadless: "no" } }), { statusCode: 400 });
});
