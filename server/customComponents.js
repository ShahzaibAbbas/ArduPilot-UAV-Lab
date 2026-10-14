import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const libraryDir = path.join(dataDir, "library");
const libraryFile = path.join(libraryDir, "custom-components.json");
// Saves and deletes read, change, and rewrite the whole library, so they run one at a time.
let libraryUpdate = Promise.resolve();

async function ensureLibrary() {
  await mkdir(libraryDir, { recursive: true });
}

async function readLibrary() {
  await ensureLibrary();
  try {
    const content = await readFile(libraryFile, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error("The custom component library contains invalid JSON. Repair or remove data/library/custom-components.json."), { statusCode: 422 });
    }
    throw error;
  }
}

async function writeLibrary(components) {
  await ensureLibrary();
  // Write a temporary file first so an interrupted save cannot leave a truncated library.
  const temporaryFile = path.join(libraryDir, `.custom-components.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, JSON.stringify(components, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporaryFile, libraryFile);
  } finally {
    await rm(temporaryFile, { force: true });
  }
}

function updateLibrary(change) {
  const update = libraryUpdate.then(async () => change(await readLibrary()));
  libraryUpdate = update.catch(() => undefined);
  return update;
}

export async function listCustomComponents() {
  const components = await readLibrary();
  return components.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export function saveCustomComponent(component) {
  return updateLibrary(async (components) => {
    const now = new Date().toISOString();
    const normalized = {
      ...component,
      id: component.id || randomUUID(),
      name: String(component.name || "Custom component").trim() || "Custom component",
      baseType: String(component.baseType || "").trim(),
      properties: component.properties && typeof component.properties === "object" ? component.properties : {},
      updatedAt: now
    };
    await writeLibrary([normalized, ...components.filter((entry) => entry.id !== normalized.id)]);
    return normalized;
  });
}

export function deleteCustomComponent(id) {
  return updateLibrary(async (components) => {
    const next = components.filter((entry) => entry.id !== id);
    if (next.length === components.length) return false;
    await writeLibrary(next);
    return true;
  });
}
