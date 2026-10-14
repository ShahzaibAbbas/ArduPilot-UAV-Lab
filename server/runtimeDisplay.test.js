import test from "node:test";
import assert from "node:assert/strict";
import { requireRuntimeDisplay, runtimeDisplayProbeScript, runtimeDisplayStatus } from "./runtimeDisplay.js";

const runtime = { available: true, source: "wsl", distro: "Ubuntu" };
const launcher = { command: "wsl.exe", prefixArgs: ["-d", "Ubuntu", "--exec", "python3", "-B"], hostCwd: "workspace" };
const output = (result) => ({ stdout: `Login banner\nUAV_LAB_DISPLAY=${JSON.stringify(result)}\n` });

test("GUI diagnosis checks the selected launch interpreter and connection without opening a window", async () => {
  let invocation;
  const result = await runtimeDisplayStatus(runtime, launcher, async (...args) => {
    invocation = args;
    return output({ available: true, wx: true, display: ":0", waylandDisplay: "wayland-0" });
  });
  assert.equal(result.available, true);
  assert.equal(result.display, ":0");
  assert.deepEqual(invocation.slice(0, 2), [launcher.command, [...launcher.prefixArgs, "-c", runtimeDisplayProbeScript]]);
  assert.equal(invocation[2].windowsHide, true);
  assert.equal(invocation[2].timeout, 10000);
  assert.match(runtimeDisplayProbeScript, /wx.App\(False\)/);
  assert.doesNotMatch(runtimeDisplayProbeScript, /wx.Frame/);
});

test("missing wxPython, absent displays and disconnected displays are separate actionable failures", async () => {
  for (const [value, message] of [
    [{ available: false, wx: false }, /wxPython is not available/],
    [{ available: false, wx: true, reason: "No X11 or Wayland display is configured in the launch environment." }, /No X11 or Wayland/],
    [{ available: false, wx: true, display: ":0" }, /cannot connect/]
  ]) {
    const display = await runtimeDisplayStatus(runtime, launcher, async () => output(value));
    assert.equal(display.available, false);
    assert.match(display.reason, message);
    assert.throws(() => requireRuntimeDisplay(runtime, display), (error) => error.statusCode === 409 && /Run without external windows/.test(error.message));
  }
  assert.doesNotThrow(() => requireRuntimeDisplay(runtime, { available: true }));
});

test("failed and malformed probes cannot masquerade as a working GUI or leak command errors", async () => {
  for (const runner of [
    async () => { throw new Error("private runtime path"); },
    async () => ({ stdout: "unexpected output" }),
    async () => output({ available: "true", wx: true })
  ]) {
    const result = await runtimeDisplayStatus(runtime, launcher, runner);
    assert.equal(result.available, false);
    assert.doesNotMatch(result.reason, /private/);
  }
  const result = await runtimeDisplayStatus({ available: false }, launcher, () => assert.fail("No runtime should not be probed"));
  assert.equal(result.available, false);
});
