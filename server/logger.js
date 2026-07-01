import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "data");
const logsDir = path.join(dataDir, "logs");
const logFile = path.join(logsDir, "server.log");
const maxMemoryLogs = 800;
const memoryLogs = [];

async function ensureLogStore() {
  await mkdir(logsDir, { recursive: true });
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== "object") {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && typeof value !== "function")
  );
}

export function addLog(level, source, message, meta) {
  const entry = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    level,
    source,
    message: String(message),
    meta: normalizeMeta(meta)
  };

  memoryLogs.push(entry);
  if (memoryLogs.length > maxMemoryLogs) {
    memoryLogs.splice(0, memoryLogs.length - maxMemoryLogs);
  }

  const line = `${JSON.stringify(entry)}\n`;
  void ensureLogStore()
    .then(() => appendFile(logFile, line, "utf8"))
    .catch((error) => {
      console.error("Could not write app log:", error);
    });

  return entry;
}

export function listLogs(limit = 200) {
  const safeLimit = Math.min(800, Math.max(1, Number(limit) || 200));
  return memoryLogs.slice(-safeLimit).reverse();
}

export async function clearLogs() {
  memoryLogs.splice(0, memoryLogs.length);
  await ensureLogStore();
  await writeFile(logFile, "", "utf8");
}

export async function readLogFileTail(maxBytes = 512 * 1024) {
  await ensureLogStore();
  try {
    const content = await readFile(logFile, "utf8");
    return content.length > maxBytes ? content.slice(content.length - maxBytes) : content;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export const loggerInfo = (source, message, meta) => addLog("info", source, message, meta);
export const loggerWarn = (source, message, meta) => addLog("warn", source, message, meta);
export const loggerError = (source, message, meta) => addLog("error", source, message, meta);
