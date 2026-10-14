import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createZip } from "../server/zip.js";

const sourceDirectories = ["src", "server", "public", "scripts", "docs", ".github"];
const sourceRootFiles = [
  "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html",
  "README.md", "design-qa.md", "AGENTS.md", "UPLOAD_RULES.md", ".gitignore", ".gitattributes", "LICENSE", "LICENSE.md",
  "Launch-Windows.bat", "Launch-Windows.ps1", "Launch-Ubuntu.sh", "Launch-macOS.command"
];
const excludedDirectories = new Set([
  "node_modules", ".git", "dist", "data", "backups", "github uploading", "updates", "coverage",
  "test-results", "playwright-report", ".cache", ".vite", ".codex", ".jetro", ".vscode", ".idea", "__pycache__"
]);
const excludedFile = /(?:^\.env(?:\.|$)|^\.ds_store$|^thumbs\.db$|^credentials(?:\.|$)|^id_(?:rsa|ed25519)(?:\.|$)|\.(?:log|zip|7z|tar|gz|bin|hex|elf|apj|saq|pem|key|p12|pfx|pyc|tmp|bak)$|\.codex-kit-backup-)/i;
const maxFileBytes = 20 * 1024 * 1024;
const maxPackageBytes = 100 * 1024 * 1024;

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function optionalStat(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Snapshot current source, including new files, without walking runtime folders. */
export async function collectSourceFiles(root) {
  const files = [];
  let totalBytes = 0;
  async function visit(relativeName) {
    const name = path.basename(relativeName);
    if (excludedDirectories.has(name.toLowerCase()) || excludedFile.test(name)) return;
    const target = path.join(root, relativeName);
    const info = await optionalStat(target);
    if (!info || info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const child of (await readdir(target)).sort()) await visit(path.join(relativeName, child));
      return;
    }
    if (!info.isFile()) return;
    if (info.size > maxFileBytes) throw new Error(`Source file exceeds the 20 MB package limit: ${relativeName}`);
    const content = await readFile(target);
    totalBytes += content.length;
    if (content.length > maxFileBytes || totalBytes > maxPackageBytes || files.length >= 10000) {
      throw new Error("Source package is too large. Move generated artifacts out of source directories.");
    }
    files.push({ name: relativeName.split(path.sep).join("/"), content });
  }
  for (const name of [...sourceRootFiles, ...sourceDirectories]) await visit(name);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureLocalDirectory(root, name) {
  const target = path.join(root, name);
  await mkdir(target, { recursive: true });
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(await realpath(target)) !== root) {
    throw new Error(`${name} must be a regular directory inside this project.`);
  }
  return target;
}

export async function prepareSourcePackage(projectRoot, { version, now = new Date() } = {}) {
  const root = await realpath(projectRoot);
  const files = await collectSourceFiles(root);
  const packageFile = files.find((file) => file.name === "package.json");
  if (!packageFile) throw new Error("package.json is required to prepare a source package.");
  const metadata = JSON.parse(packageFile.content.toString("utf8"));
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  const releaseVersion = version ?? `v${metadata.version}-${stamp}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(releaseVersion) || releaseVersion.includes("..")) {
    throw new Error("Version must use 1–100 letters, digits, dots, dashes or underscores, without '..'.");
  }
  const folderName = `ArduPilot-UAV-Lab-${releaseVersion}`;
  const backupRoot = await ensureLocalDirectory(root, "backups");
  const uploadRoot = await ensureLocalDirectory(root, "github uploading");
  const backupPath = path.join(backupRoot, `${folderName}.zip`);
  const folderPath = path.join(uploadRoot, folderName);
  const zipPath = path.join(uploadRoot, `${folderName}.zip`);
  for (const target of [backupPath, folderPath, zipPath]) {
    if (await optionalStat(target)) throw new Error("This package version already exists. Choose a new --version; existing backups are preserved.");
  }
  const manifest = {
    format: "ardupilot-uav-lab-source-package", version: 1, releaseVersion,
    applicationVersion: metadata.version, createdAt: now.toISOString(),
    files: files.map((file) => ({ path: file.name, bytes: file.content.length, sha256: digest(file.content) }))
  };
  const entries = [...files, { name: "SOURCE_MANIFEST.json", content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }];
  const zip = createZip(entries);
  // Save recovery copy first. Never replace or remove prior releases.
  await writeFile(backupPath, zip, { flag: "wx" });
  await mkdir(folderPath);
  for (const file of entries) {
    const target = path.join(folderPath, file.name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx" });
  }
  await writeFile(zipPath, zip, { flag: "wx" });
  return { backupPath, folderPath, zipPath, fileCount: files.length, sha256: digest(zip) };
}
