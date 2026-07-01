import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const libraryDir = path.join(dataDir, "library");
const libraryFile = path.join(libraryDir, "custom-components.json");

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
    throw error;
  }
}

async function writeLibrary(components) {
  await ensureLibrary();
  await writeFile(libraryFile, JSON.stringify(components, null, 2), "utf8");
}

export async function listCustomComponents() {
  const components = await readLibrary();
  return components.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function saveCustomComponent(component) {
  const components = await readLibrary();
  const now = new Date().toISOString();
  const normalized = {
    ...component,
    id: component.id || randomUUID(),
    name: String(component.name || "Custom component").trim() || "Custom component",
    baseType: String(component.baseType || "").trim(),
    properties: component.properties && typeof component.properties === "object" ? component.properties : {},
    updatedAt: now
  };
  const next = [normalized, ...components.filter((entry) => entry.id !== normalized.id)];
  await writeLibrary(next);
  return normalized;
}

export async function deleteCustomComponent(id) {
  const components = await readLibrary();
  const next = components.filter((entry) => entry.id !== id);
  await writeLibrary(next);
  return components.length !== next.length;
}
