import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CompanionVmError, CompanionVmStore, companionVmArgs, companionVmSettings } from "./companionVm.js";

test("companion VM settings and QEMU arguments are bounded and direct", () => {
  assert.deepEqual(companionVmSettings(), { memoryMb: 2048, cpus: 2, diskGb: 16, boot: "disk" });
  assert.throws(() => companionVmSettings({ memoryMb: 256 }), CompanionVmError);
  assert.throws(() => companionVmSettings({ cpus: 5 }), /cpus/);
  const args = companionVmArgs({ memoryMb: 1024, cpus: 1, boot: "installer", vncPort: 5901 }, "C:\\vm\\disk.qcow2", "C:\\iso\\linux.iso");
  assert.ok(args.includes("-no-user-config") && args.includes("-no-reboot"));
  assert.ok(args.some((value) => value.includes("disk.qcow2")));
  assert.ok(args.some((value) => value.includes("linux.iso")));
  assert.ok(companionVmArgs({ memoryMb: 1024, cpus: 1, boot: "disk", displayMode: "window", vncPort: 5901 }, "C:\\vm\\disk.qcow2").includes("default"));
});

test("companion VM rejects unsafe IDs and ISO paths before spawning", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uav-companion-vm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let spawned = false;
  const store = new CompanionVmStore({
    root,
    execute: async (_command, args) => ({ stdout: args[0] === "--version" ? "QEMU" : JSON.stringify({ format: "qcow2", "virtual-size": 16 * 1024 ** 3 }) }),
    spawnProcess: () => { spawned = true; throw new Error("spawned"); },
    portAvailable: async () => true
  });
  await assert.rejects(store.start("../outside", { boot: "installer", isoPath: "C:\\safe.iso" }), /identifier is invalid/);
  await assert.rejects(store.start("companion", { boot: "installer", isoPath: "relative.iso" }), /absolute path/);
  await assert.rejects(store.start("companion", { boot: "installer", isoPath: path.join(root, "missing.iso") }), /could not be read/);
  assert.equal(spawned, false);
  await store.close();
});

test("companion VM status never exposes managed storage paths", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uav-companion-vm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new CompanionVmStore({ root, execute: async () => ({ stdout: "QEMU" }) });
  const result = await store.status();
  assert.ok(result.runtime && Array.isArray(result.machines));
  assert.equal(JSON.stringify(result).includes(root), false);
  await store.close();
});
