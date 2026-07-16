import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESIGN_ID_PATTERN, listDesigns, saveDesign } from "./designStore.js";

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
