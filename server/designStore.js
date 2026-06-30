import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const designsDir = path.join(dataDir, "designs");

async function ensureStore() {
  await mkdir(designsDir, { recursive: true });
}

function normalizeDesign(design) {
  const now = new Date().toISOString();
  return {
    ...design,
    id: design.id || crypto.randomUUID(),
    updatedAt: now
  };
}

export async function saveDesign(design) {
  await ensureStore();
  const normalized = normalizeDesign(design);
  const target = path.join(designsDir, `${normalized.id}.json`);
  await writeFile(target, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export async function listDesigns() {
  await ensureStore();
  const files = await readdir(designsDir);
  const designs = [];

  for (const file of files.filter((entry) => entry.endsWith(".json"))) {
    const content = await readFile(path.join(designsDir, file), "utf8");
    designs.push(JSON.parse(content));
  }

  return designs.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}
