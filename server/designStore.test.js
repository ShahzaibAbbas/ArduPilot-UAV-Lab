import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESIGN_ID_PATTERN, listDesigns, loadDesign, saveDesign } from "./designStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const designsDir = path.join(projectRoot, "data", "designs");

function design(overrides = {}) {
  return {
    name: "Regression test design",
    nodes: [],
    edges: [],
    settings: {},
    ...overrides
  };
}

test("generates canonical IDs and atomically stores valid designs", async () => {
  const saved = await saveDesign(design());
  const target = path.join(designsDir, `${saved.id}.json`);

  try {
    assert.match(saved.id, DESIGN_ID_PATTERN);
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), saved);
    const temporaryFiles = (await readdir(designsDir)).filter((file) => file.includes(saved.id) && file.endsWith(".tmp"));
    assert.deepEqual(temporaryFiles, []);
  } finally {
    await rm(target, { force: true });
  }
});

test("preserves and updates designs that already have valid UUID-like IDs", async () => {
  const id = randomUUID();
  const target = path.join(designsDir, `${id}.json`);

  try {
    await saveDesign(design({ id, name: "First version" }));
    const updated = await saveDesign(design({ id, name: "Updated version" }));
    const stored = JSON.parse(await readFile(target, "utf8"));

    assert.equal(updated.id, id);
    assert.equal(stored.id, id);
    assert.equal(stored.name, "Updated version");
    assert.equal((await listDesigns()).some((entry) => entry.id === id), true);
  } finally {
    await rm(target, { force: true });
  }
});

test("rejects path-traversal IDs without creating files outside the design store", async () => {
  const marker = `design-store-traversal-${randomUUID()}`;
  const maliciousId = `../../${marker}`;
  const escapedTarget = path.resolve(designsDir, `${maliciousId}.json`);

  await rm(escapedTarget, { force: true });
  try {
    await assert.rejects(
      saveDesign(design({ id: maliciousId })),
      /canonical UUID format/
    );
    await assert.rejects(access(escapedTarget));
  } finally {
    await rm(escapedTarget, { force: true });
  }
});

test("rejects other filename-like and malformed IDs", async () => {
  for (const id of ["..\\..\\outside", "/tmp/outside", "design.json", "", "not-a-uuid", 123]) {
    await assert.rejects(saveDesign(design({ id })), /canonical UUID format/);
  }
});

test("loads saved workspaces and searches names, vehicles and UUIDs without changing optional data", async () => {
  const id = randomUUID();
  const target = path.join(designsDir, `${id}.json`);
  try {
    const saved = await saveDesign(design({
      id, name: `Search fixture ${id}`, settings: { vehicle: "ArduPlane", frame: "quadplane" },
      lab: { viewport3d: { cameraPosition: [4, 5, 6] } },
      nodes: [{ id: "one", transform3d: { position: [1, 2, 3] } }]
    }));
    assert.deepEqual(await loadDesign(id), saved);
    assert.equal((await listDesigns({ query: id.toUpperCase() }))[0].id, id);
    assert.equal((await listDesigns({ query: "ARDUPLANE" })).some((item) => item.id === id), true);
    assert.equal((await listDesigns({ query: "quadplane" })).some((item) => item.id === id), true);
    assert.equal((await listDesigns({ query: `unmatched-${randomUUID()}` })).length, 0);
    assert.equal((await listDesigns({ limit: 1 })).length, 1);
  } finally {
    await rm(target, { force: true });
  }
});

test("one malformed workspace does not prevent discovery of healthy saved workspaces", async () => {
  const saved = await saveDesign(design());
  const brokenId = randomUUID();
  const wrongShapeId = randomUUID();
  const files = [saved.id, brokenId, wrongShapeId].map((id) => path.join(designsDir, `${id}.json`));
  try {
    await writeFile(files[1], "{ invalid json", "utf8");
    await writeFile(files[2], JSON.stringify({ id: 123, name: "invalid" }), "utf8");
    const results = await listDesigns();
    assert.equal(results.some((item) => item.id === saved.id), true);
    assert.equal(results.some((item) => item.id === brokenId || item.id === wrongShapeId), false);
    await assert.rejects(loadDesign(brokenId), { statusCode: 422 });
    await assert.rejects(loadDesign(wrongShapeId), { statusCode: 422 });
  } finally {
    await Promise.all(files.map((target) => rm(target, { force: true })));
  }
});

test("workspace reads reject traversal and report missing files without revealing local paths", async () => {
  await assert.rejects(loadDesign("../secrets"), { statusCode: 400 });
  await assert.rejects(loadDesign(randomUUID()), (error) => {
    assert.equal(error.statusCode, 404);
    assert.equal(error.message.includes(projectRoot), false);
    return true;
  });
});
