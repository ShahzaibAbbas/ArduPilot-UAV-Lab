import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe"
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }

  return result.stdout ?? "";
}

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeName(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function trackedFiles() {
  return run("git", ["ls-tree", "-r", "--name-only", "-z", "HEAD"])
    .split("\0")
    .filter(Boolean)
    .filter((file) => !file.endsWith(".md"));
}

const status = run("git", ["status", "--short"]).trim();
if (status) {
  throw new Error("Commit or discard working-tree changes before preparing a GitHub upload.");
}

const shortSha = run("git", ["rev-parse", "--short", "HEAD"]).trim();
const version = safeName(argValue("--version") ?? `v${packageJson.version}-${shortSha}`);
const uploadRoot = path.join(root, "github uploading");
const folderName = safeName(`${packageJson.name}-${version}`);
const folderPath = path.join(uploadRoot, folderName);
const zipPath = path.join(uploadRoot, `${folderName}.zip`);

await mkdir(uploadRoot, { recursive: true });
await rm(folderPath, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(folderPath, { recursive: true });

for (const file of trackedFiles()) {
  const source = path.join(root, file);
  const target = path.join(folderPath, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

run("git", ["archive", "--format=zip", `--output=${zipPath}`, "HEAD"]);

console.log(`GitHub upload folder: ${folderPath}`);
console.log(`GitHub upload zip: ${zipPath}`);
console.log(`Source commit: ${shortSha}`);
