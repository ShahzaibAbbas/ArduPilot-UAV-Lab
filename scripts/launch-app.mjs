import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnOwnedProcess, stopProcessTree, waitForExit } from "../server/processLifecycle.js";
import { runtimePorts } from "../server/runtimeConfig.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ports = runtimePorts();
const withBrowser = !process.argv.includes("--no-browser");
const children = [];
let stopping = false;
let api;

function start(label, args) {
  const child = spawnOwnedProcess(process.execPath, args, {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ARDUPILOT_LAUNCHER_PID: String(process.pid) }
  });
  children.push(child);
  child.once("error", (error) => { console.error(`${label} failed to start: ${error.code ?? error.message}`); void shutdown(1); });
  child.once("exit", (code, signal) => { if (!stopping) void shutdown(code ?? (signal ? 1 : 0)); });
  return child;
}

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.log("Stopping ArduPilot UAV Lab and its managed processes…");
  if (api && api.exitCode === null && api.signalCode === null) {
    try {
      const runtime = await (await fetch(`${ports.apiUrl}/api/runtime`, { signal: AbortSignal.timeout(1500) })).json();
      if (runtime.api?.pid === api.pid) {
        await fetch(`${ports.apiUrl}/api/application/exit`, {
          method: "POST", headers: { "X-UAV-Lab-Action": "exit" }, signal: AbortSignal.timeout(3000)
        });
      }
    } catch { /* The API may be starting, already stopped, or unavailable. */ }
    if (!(await waitForExit(api, 35_000))) {
      console.error("The API did not finish cleanup in time; stopping only its owned process tree.");
      await stopProcessTree(api).catch((error) => { console.error(error.message); exitCode = 1; });
    }
  }
  const results = await Promise.allSettled(children.filter((child) => child !== api).map(stopProcessTree));
  if (results.some((result) => result.status === "rejected")) exitCode = 1;
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGHUP", () => void shutdown());

api = start("Local API", ["server/index.js"]);
start("Vite", ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"]);
if (withBrowser) start("Design browser", ["scripts/launch-design-browser.mjs"]);
