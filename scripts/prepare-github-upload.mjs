import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareSourcePackage } from "./source-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let version;
if (args.length === 1 && args[0].startsWith("--version=")) {
  version = args[0].slice("--version=".length);
} else if (args.length === 2 && args[0] === "--version") {
  version = args[1];
} else if (args.length) {
  console.error("Usage: npm run github:upload -- [--version v0.1.0-release-name]");
  process.exitCode = 1;
}

if (!process.exitCode) {
  try {
    const result = await prepareSourcePackage(root, { version });
    console.log(`Source files: ${result.fileCount}`);
    console.log(`Recovery backup: ${result.backupPath}`);
    console.log(`GitHub upload folder: ${result.folderPath}`);
    console.log(`GitHub upload ZIP: ${result.zipPath}`);
    console.log(`SHA-256: ${result.sha256}`);
    console.log("Extract the ZIP and upload its contents, including .gitignore. No Git commit is required.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Source packaging failed.");
    process.exitCode = 1;
  }
}
