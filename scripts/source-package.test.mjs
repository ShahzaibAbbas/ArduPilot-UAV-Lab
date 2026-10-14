import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectSourceFiles, prepareSourcePackage } from "./source-package.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "uav-source-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (name, content = "source") => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  await put("package.json", JSON.stringify({ name: "ardupilot-uav-lab", version: "0.1.0" }));
  return { root, put };
}

test("package current source without Git, including new files/docs and excluding runtime/secrets", async (t) => {
  const { root, put } = await fixture(t);
  for (const name of ["README.md", "design-qa.md", ".gitignore", "AGENTS.md", "src/new.ts", "docs/guide.md", "public/logo.svg", ".github/workflows/check.yml"]) await put(name);
  for (const name of ["dist/index.js", "data/design.json", "backups/old.zip", "node_modules/pkg/index.js", ".env.local", "CODEX_REPO_SNAPSHOT.txt", "src/.env.production", "src/device.bin", "src/private.pem", "src/nested/node_modules/pkg.js", "scripts/test-results/log.json", ".jetro/daemon/credentials.json", "src/.jetro/state.json"]) await put(name, "private runtime content");
  const files = await collectSourceFiles(root);
  assert.deepEqual(files.map((file) => file.name).sort(), [".github/workflows/check.yml", ".gitignore", "AGENTS.md", "README.md", "design-qa.md", "docs/guide.md", "package.json", "public/logo.svg", "src/new.ts"].sort());
});

test("backup, ZIP and staged source share a verified manifest; existing releases are preserved", async (t) => {
  const { root, put } = await fixture(t);
  await put("src/new.ts", "export const value = 'uncommitted';\n");
  const result = await prepareSourcePackage(root, { version: "v0.1.0-test" });
  assert.deepEqual(await readFile(result.backupPath), await readFile(result.zipPath));
  const manifest = JSON.parse(await readFile(path.join(result.folderPath, "SOURCE_MANIFEST.json"), "utf8"));
  assert.equal(manifest.releaseVersion, "v0.1.0-test");
  for (const entry of manifest.files) {
    const bytes = await readFile(path.join(result.folderPath, entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  }
  const zip = await readFile(result.zipPath);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), manifest.files.length + 1);
  await assert.rejects(prepareSourcePackage(root, { version: "v0.1.0-test" }), /already exists/);
  assert.deepEqual(await readFile(result.backupPath), zip);
});

test("unsafe version paths are rejected", async (t) => {
  const { root } = await fixture(t);
  for (const version of ["../escape", "C:\\escape", "", "release/other", "..", "a".repeat(101)]) {
    await assert.rejects(prepareSourcePackage(root, { version }), /Version must/);
  }
});

test("source directory links cannot include files outside the package", async (t) => {
  const { root, put } = await fixture(t);
  await put("private/outside.txt");
  await symlink(path.join(root, "private"), path.join(root, "src"), process.platform === "win32" ? "junction" : "dir");
  assert.deepEqual((await collectSourceFiles(root)).map((file) => file.name), ["package.json"]);
});

test("output directory links are rejected", async (t) => {
  const { root } = await fixture(t);
  await mkdir(path.join(root, "elsewhere"));
  await symlink(path.join(root, "elsewhere"), path.join(root, "backups"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(prepareSourcePackage(root), /regular directory/);
});
