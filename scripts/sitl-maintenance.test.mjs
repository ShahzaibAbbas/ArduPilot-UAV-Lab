import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync(new URL("../src/lib/sitlMaintenance.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
});
const module = { exports: {} };
new Function("module", "exports", outputText)(module, module.exports);
const { stopManagedSitl } = module.exports;
const snapshot = (...processes) => ({
  processes, details: processes.map(pid => ({ pid, status: "running" })), events: []
});

test("maintenance waits until managed processes disappear before allowing relaunch", async () => {
  let reads = 0;
  const stops = [];
  const result = await stopManagedSitl({
    list: async () => ++reads < 4 ? snapshot(10, 20) : snapshot(),
    stop: async (pid) => { stops.push(pid); }
  }, { pollMs: 1 });
  assert.deepEqual(stops, [10, 20]);
  assert.equal(reads, 4);
  assert.deepEqual(result.processes, []);
});

test("already stopping processes are awaited without a duplicate stop request", async () => {
  let reads = 0;
  await stopManagedSitl({
    list: async () => ++reads < 3 ? { ...snapshot(10), details: [{ pid: 10, status: "stopping" }] } : snapshot(),
    stop: () => assert.fail("already stopping")
  }, { pollMs: 1 });
  assert.equal(reads, 3);
});

test("natural exit racing the stop request succeeds only after a fresh status read", async () => {
  let reads = 0;
  await stopManagedSitl({
    list: async () => ++reads === 1 ? snapshot(10) : snapshot(),
    stop: async () => { throw new Error("Process not found"); }
  });
  assert.equal(reads, 3);
});

test("failed stop and newly launched processes prevent relaunch", async () => {
  await assert.rejects(stopManagedSitl({
    list: async () => snapshot(10),
    stop: async () => { throw new Error("stop failed"); }
  }), /stop failed/);
  let reads = 0;
  const stops = [];
  await assert.rejects(stopManagedSitl({
    list: async () => ++reads === 1 ? snapshot(10) : snapshot(20),
    stop: async (pid) => { stops.push(pid); }
  }), /Another managed SITL process/);
  assert.deepEqual(stops, [10]);
});

test("maintenance cancels on unmount and bounds requests and process exit waits", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(stopManagedSitl({
    list: () => assert.fail("cancelled before read"), stop: () => assert.fail("cancelled")
  }, { signal: controller.signal }), /cancelled/);
  await assert.rejects(stopManagedSitl({
    list: async () => snapshot(10), stop: async () => {}
  }, { timeoutMs: 10, pollMs: 1 }), /did not finish stopping/);
  await assert.rejects(stopManagedSitl({
    list: (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
    stop: () => assert.fail("read never completed")
  }, { timeoutMs: 10 }), /did not finish stopping/);
});
