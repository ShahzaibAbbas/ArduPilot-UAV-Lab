import test from "node:test";
import assert from "node:assert/strict";
import { restoreDesignBrowserWindow } from "./design-browser-window.mjs";

test("app browser resets a saved minimized or off-screen window before activating it", async () => {
  const calls = [];
  const session = {
    send: async (method, parameters) => { calls.push([method, parameters]); return { windowId: 42 }; },
    detach: async () => { calls.push(["detach"]); }
  };
  const page = { context: () => ({ newCDPSession: async () => session }), bringToFront: async () => { calls.push(["front"]); } };
  await restoreDesignBrowserWindow(page, { width: 1280, height: 720 });
  assert.deepEqual(calls, [
    ["Browser.getWindowForTarget", undefined],
    ["Browser.setWindowBounds", { windowId: 42, bounds: { windowState: "normal" } }],
    ["Browser.setWindowBounds", { windowId: 42, bounds: { left: 0, top: 0, width: 1280, height: 720 } }],
    ["Browser.setWindowBounds", { windowId: 42, bounds: { windowState: "fullscreen" } }],
    ["front"], ["detach"]
  ]);
});

test("display recovery releases its CDP connection if restoring the window fails", async () => {
  let detached = false;
  const page = { context: () => ({ newCDPSession: async () => ({
    send: async () => { throw new Error("Window closed"); },
    detach: async () => { detached = true; }
  }) }) };
  await assert.rejects(restoreDesignBrowserWindow(page, { width: 1280, height: 720 }), /Window closed/);
  assert.equal(detached, true);
});
