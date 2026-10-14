import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import { FirmwareError, FirmwareStore } from "./firmware.js";

async function withStore(run, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "uav-firmware-"));
  const store = new FirmwareStore({ root, workflowStepMs: 2, ...options });
  try {
    await run(store, root);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("stores supported firmware under a server-generated name with SHA-256 metadata", async () => {
  await withStore(async (store, root) => {
    const bytes = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const record = await store.upload({
      originalName: "copter.bin",
      bytes,
      selectedNodeId: "fc-1",
      selectedBoard: "Cube Orange+",
      selectedComponentType: "flight-controller",
      linkedVehicle: "ArduCopter"
    });

    assert.match(record.id, /^[0-9a-f-]{36}$/i);
    assert.equal(record.safeStoredName, `${record.id}.bin`);
    assert.equal(record.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(record.byteSize, bytes.length);
    assert.equal(record.storagePath, undefined);
    assert.deepEqual(await readFile(path.join(root, record.safeStoredName)), bytes);
    assert.equal((await store.get(record.id)).originalName, "copter.bin");
    assert.equal((await store.get(record.id.toUpperCase())).id, record.id);
  });
});

test("rejects cross-platform unsafe names, empty bytes, and untrusted IDs", async () => {
  await withStore(async (store) => {
    for (const originalName of ["..\\escape.bin", "C:\\escape.bin", "name:stream.bin", "bad\u0001.bin", "bad\n.bin", "bad?.bin", "a".repeat(241) + ".bin"]) {
      await assert.rejects(store.upload({ originalName, bytes: Buffer.from([1]) }), FirmwareError);
    }
    await assert.rejects(store.upload({ originalName: "empty.bin", bytes: Buffer.alloc(0) }), /non-empty/);
    await assert.rejects(store.upload({ originalName: "text.bin", bytes: "not a buffer" }), /non-empty/);
    for (const id of ["../../outside", "abc", "", "550e8400-e29b-11d4-a716-446655440000"]) {
      await assert.rejects(store.get(id), (error) => error instanceof FirmwareError && error.statusCode === 404);
      await assert.rejects(store.delete(id), FirmwareError);
    }
  });
});

test("APJ inspection bounds fields and does not coerce invalid integers or encoded text into image sizes", async () => {
  await withStore(async (store) => {
    const record = await store.upload({
      originalName: "metadata.APJ",
      bytes: Buffer.from(JSON.stringify({ board_id: true, board_revision: 3.5, image_size: "", description: "x".repeat(400), vehicle: {}, image: "encoded-content" }))
    });
    assert.equal(record.metadata.boardId, undefined);
    assert.equal(record.metadata.boardRevision, undefined);
    assert.equal(record.metadata.imageSize, undefined);
    assert.equal(record.metadata.vehicleType, undefined);
    assert.equal(record.metadata.description.length, 240);
    assert.equal(JSON.stringify(record).includes("encoded-content"), false);
    for (const bytes of [Buffer.from("{invalid"), Buffer.from("[]"), Buffer.from("null")]) {
      const invalid = await store.upload({ originalName: "invalid.apj", bytes });
      assert.equal(invalid.warnings.length, 1);
      assert.deepEqual(invalid.metadata, {});
    }
  });
});

test("compatibility requires exact board-number tokens and recognized vehicle identities", async () => {
  await withStore(async (store) => {
    const upload = (overrides = {}, metadata = { board_id: 140, vehicle: "ArduCopter" }) => store.upload({
      originalName: "board.apj", bytes: Buffer.from(JSON.stringify(metadata)),
      selectedComponentType: "flight-controller", selectedBoard: "Board 1400", linkedVehicle: "ArduCopter", ...overrides
    });
    assert.equal((await upload()).compatibility.status, "review");
    assert.equal((await upload({ selectedBoard: "Board 140" })).compatibility.status, "compatible");
    assert.equal((await upload({ selectedBoard: "Cube model 140" })).compatibility.status, "review");
    assert.equal((await upload({ linkedVehicle: "ArduPlane" })).compatibility.status, "incompatible");
    assert.equal((await upload({ selectedComponentType: "battery" })).compatibility.status, "incompatible");
    assert.equal((await upload({ selectedComponentType: undefined })).compatibility.status, "unknown");
    assert.equal((await upload({}, { vehicle: "ArduCopter" })).compatibility.status, "review");
    assert.equal((await upload({}, { vehicle: "Ardu" })).compatibility.status, "review");
  });
});

test("stored metadata is bounded and validated before listing or deletion", async () => {
  await withStore(async (store, root) => {
    const record = await store.upload({ originalName: "first.bin", bytes: Buffer.from([1]) });
    const other = await store.upload({ originalName: "second.bin", bytes: Buffer.from([2]) });
    const metadataPath = path.join(root, `${record.id}.json`);
    await writeFile(metadataPath, JSON.stringify({ ...record, id: other.id }));
    await assert.rejects(store.delete(record.id), (error) => error instanceof FirmwareError && error.statusCode === 422);
    assert.deepEqual(await readFile(path.join(root, other.safeStoredName)), Buffer.from([2]));
    assert.deepEqual((await store.list()).map((entry) => entry.id), [other.id]);
    await writeFile(metadataPath, "{".repeat(65 * 1024));
    await assert.rejects(store.get(record.id), /size limit/);
    await writeFile(metadataPath, "{broken-json");
    await assert.rejects(store.get(record.id), (error) => error instanceof FirmwareError && !error.message.includes(root));
    await writeFile(metadataPath, JSON.stringify({ ...record, storagePath: root, metadata: { ...record.metadata, arbitraryPath: root }, arbitraryPath: root }));
    assert.equal(JSON.stringify(await store.get(record.id)).includes(root), false);
  });
});

test("existing records can be attached to a flight controller with persisted compatibility", async () => {
  await withStore(async (store) => {
    const record = await store.upload({ originalName: "copter.apj", bytes: Buffer.from(JSON.stringify({ vehicle: "ArduCopter", board_id: 140 })) });
    await assert.rejects(store.attach(record.id, { selectedNodeId: "battery", selectedComponentType: "battery" }), /flight-controller/);
    const attached = await store.attach(record.id, { selectedNodeId: "fc-2", selectedComponentType: "flight-controller", selectedBoard: "Board 140", linkedVehicle: "ArduCopter" });
    assert.equal(attached.selectedNode.nodeId, "fc-2");
    assert.equal(attached.compatibility.status, "compatible");
    assert.equal((await store.get(record.id)).selectedNode.nodeId, "fc-2");
    assert.equal(attached.sha256, record.sha256);
  });
});

test("workflow integrity checks fail safely for modified or missing stored bytes", async () => {
  await withStore(async (store, root) => {
    const record = await store.upload({ originalName: "original.bin", bytes: Buffer.from([1, 2, 3]) });
    await writeFile(path.join(root, record.safeStoredName), Buffer.from([1, 2, 4]));
    const modified = await store.startWorkflow(record.id);
    assert.equal(modified.state, "FAILED");
    assert.match(modified.events.at(-1).message, /SHA-256/);
    assert.equal(store.workflowTimers.size, 0);
    await rm(path.join(root, record.safeStoredName));
    const missing = await store.startWorkflow(record.id);
    assert.equal(missing.state, "FAILED");
    assert.equal(missing.events.at(-1).message.includes(root), false);
  });
});

test("workflow stop is idempotent, snapshots are isolated, and restart cancels stale timers", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  await withStore(async (store) => {
    const record = await store.upload({ originalName: "flow.bin", bytes: Buffer.from([1]) });
    assert.equal((await store.stopWorkflow(record.id)).state, "EMPTY");
    const started = await store.startWorkflow(record.id);
    started.state = "RUNNING";
    started.events[0].message = "mutated";
    assert.equal(store.workflow(record.id).state, "VALIDATING");
    assert.notEqual(store.workflow(record.id).events[0].message, "mutated");
    await assert.rejects(store.startWorkflow(record.id), (error) => error instanceof FirmwareError && error.statusCode === 409);
    const stopped = await store.stopWorkflow(record.id);
    const repeated = await store.stopWorkflow(record.id);
    assert.equal(repeated.events.length, stopped.events.length);
    context.mock.timers.tick(30);
    assert.equal(store.workflow(record.id).state, "STOPPED");
    assert.equal(store.workflowTimers.size, 0);
    assert.equal((await store.startWorkflow(record.id)).state, "VALIDATING");
    await store.delete(record.id);
    context.mock.timers.tick(30);
    assert.equal(store.workflow(record.id).state, "EMPTY");
    assert.equal(store.workflowTimers.size, 0);
  }, { workflowStepMs: 3 });
});

test("workflow capacity is bounded and incompatible records cannot start", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  await withStore(async (store) => {
    const first = await store.upload({ originalName: "first.bin", bytes: Buffer.from([1]) });
    const second = await store.upload({ originalName: "second.bin", bytes: Buffer.from([2]) });
    const third = await store.upload({ originalName: "third.bin", bytes: Buffer.from([3]) });
    const incompatible = await store.upload({ originalName: "wrong.bin", bytes: Buffer.from([4]), selectedComponentType: "motor" });
    await assert.rejects(store.startWorkflow(incompatible.id), /Cannot start/);
    await store.startWorkflow(first.id);
    await store.startWorkflow(second.id);
    await assert.rejects(store.startWorkflow(third.id), /limit/);
    assert.equal(store.workflows.size, 2);
    await store.stopWorkflow(first.id);
    await store.startWorkflow(third.id);
    assert.equal(store.workflows.size, 2);
    assert.equal(store.workflow(first.id).state, "EMPTY");
    store.close();
    assert.equal(store.workflowTimers.size, 0);
    assert.equal(store.workflows.size, 0);
  }, { maxWorkflows: 2, workflowStepMs: 100 });
});

test("invalid constructor limits fall back to finite bounds", async () => {
  await withStore(async (store) => {
    assert.equal(store.maxUploadBytes, 16 * 1024 * 1024);
    assert.equal(store.workflowStepMs, 650);
    assert.equal(store.maxWorkflows, 100);
  }, { maxUploadBytes: Infinity, workflowStepMs: NaN, maxWorkflows: -4 });
});

test("rejects traversal names, unsupported extensions, and oversized uploads", async () => {
  await withStore(
    async (store) => {
      await assert.rejects(
        store.upload({ originalName: "../escape.bin", bytes: Buffer.from([1]) }),
        (error) => error instanceof FirmwareError && error.statusCode === 400
      );
      await assert.rejects(
        store.upload({ originalName: "script.exe", bytes: Buffer.from([1]) }),
        /Supported firmware types/
      );
      await assert.rejects(
        store.upload({ originalName: "large.bin", bytes: Buffer.alloc(1025) }),
        (error) => error instanceof FirmwareError && error.statusCode === 413
      );
    },
    { maxUploadBytes: 1024 }
  );
});

test("inspects bounded APJ metadata without exposing or executing the embedded image", async () => {
  await withStore(async (store) => {
    const apj = Buffer.from(
      JSON.stringify({
        board_id: 140,
        description: "ArduCopter test image",
        vehicle: "ArduCopter",
        git_identity: "deadbeef",
        image_size: 42,
        image: "opaque-encoded-data"
      })
    );
    const record = await store.upload({
      originalName: "arducopter.apj",
      bytes: apj,
      selectedNodeId: "fc-1",
      selectedBoard: "Board 140",
      selectedComponentType: "flight-controller",
      linkedVehicle: "ArduCopter"
    });

    assert.equal(record.detectedFormat, "ArduPilot APJ JSON container");
    assert.equal(record.metadata.boardId, 140);
    assert.equal(record.metadata.vehicleType, "ArduCopter");
    assert.equal(record.metadata.imageSize, 42);
    assert.equal(record.metadata.image, undefined);
    assert.equal(record.compatibility.status, "compatible");
    assert.match(record.warnings[0], /opaque/i);
  });
});

test("runs the labeled visual workflow through boot and supports stop", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  await withStore(async (store) => {
    const record = await store.upload({
      originalName: "vehicle.hex",
      bytes: Buffer.from(":00000001FF\n"),
      selectedComponentType: "flight-controller"
    });

    const started = await store.startWorkflow(record.id);
    assert.equal(started.visualSimulation, true);
    assert.equal(started.state, "VALIDATING");

    context.mock.timers.tick(25);
    const running = store.workflow(record.id);
    assert.equal(running.state, "RUNNING");
    assert.equal(running.progress, 100);
    assert.ok(running.events.some((event) => event.state === "FLASHING"));
    assert.ok(running.events.every((event) => event.origin === "workflow simulation"));

    const stopped = await store.stopWorkflow(record.id);
    assert.equal(stopped.state, "STOPPED");
  });
});

test("wipes visual state without deleting firmware and resets it safely", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  await withStore(async (store) => {
    const record = await store.upload({
      originalName: "vehicle.bin",
      bytes: Buffer.from([1, 2, 3, 4]),
      selectedComponentType: "flight-controller"
    });
    await store.startWorkflow(record.id);
    const wiped = await store.wipeWorkflow(record.id);
    assert.equal(wiped.state, "EMPTY");
    assert.equal((await store.get(record.id)).byteSize, 4);
    const reset = await store.resetWorkflow(record.id);
    assert.equal(reset.state, "VALIDATING");
    await store.stopWorkflow(record.id);
  });
});
