import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configuredPort, runtimePorts, serverListenError } from "./runtimeConfig.js";
import { prepareLocalFolders } from "./setup.js";
import { closeOwnedProcesses, runOwnedFile, spawnOwnedProcess, stopProcessTree, waitForExit, waitForSpawn } from "./processLifecycle.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("API, proxy and browser use matching configurable TCP ports", () => {
  assert.deepEqual(runtimePorts({}), {
    apiPort: 4310, clientPort: 5173, apiUrl: "http://127.0.0.1:4310", clientUrl: "http://127.0.0.1:5173/"
  });
  assert.deepEqual(runtimePorts({ PORT: "4420", CLIENT_PORT: "5280" }), {
    apiPort: 4420, clientPort: 5280, apiUrl: "http://127.0.0.1:4420", clientUrl: "http://127.0.0.1:5280/"
  });
  assert.throws(() => runtimePorts({ PORT: "5173" }), /different TCP ports/);
  for (const value of ["0", "65536", "-1", "NaN", "4e3", "4310.5", "   ", "4310abc"]) {
    assert.throws(() => configuredPort(value, 4310, "PORT"), /integer port between 1 and 65535/);
  }
  assert.equal(configuredPort(" 4420 ", 4310, "PORT"), 4420);
});

test("listener startup failures identify TCP port conflicts and permissions", () => {
  assert.match(serverListenError({ code: "EADDRINUSE" }, 4420), /4420 is already in use/);
  assert.match(serverListenError({ code: "EACCES" }, 80), /above 1023/);
  assert.doesNotMatch(serverListenError({ message: "C:\\private\\file" }, 4420), /private/);
});

test("first launch prepares the folders required by file and export workflows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "uav-runtime-"));
  try {
    await prepareLocalFolders(root);
    for (const folder of ["data/designs", "data/exports", "data/logs"]) await access(path.join(root, folder));
    await prepareLocalFolders(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn handshake rejects a missing executable and stops a tracked child", async () => {
  const missing = spawn(`uav-missing-${randomUUID()}`, [], { windowsHide: true });
  await assert.rejects(waitForSpawn(missing), { code: "ENOENT" });
  assert.equal(await waitForExit(missing, 10), true);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true, detached: process.platform !== "win32", stdio: "ignore"
  });
  const closed = once(child, "exit");
  try {
    await waitForSpawn(child);
    assert.ok(Number.isInteger(child.pid));
    const firstStop = stopProcessTree(child);
    assert.equal(stopProcessTree(child), firstStop);
    await firstStop;
    await closed;
    assert.notEqual(child.exitCode === null && child.signalCode === null, true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("live API reports the actual port and supports saved workspace search and load", { timeout: 60000 }, async (context) => {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), CLIENT_PORT: String(port === 5173 ? 5174 : 5173), ARDUPILOT_LAUNCHER_PID: "" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  const closed = once(child, "exit");
  context.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  let output = "";
  child.stdout.on("data", (data) => { output = (output + data.toString()).slice(-4000); });
  child.stderr.on("data", (data) => { output = (output + data.toString()).slice(-4000); });
  const base = `http://127.0.0.1:${port}`;
  const id = randomUUID();
  try {
    let ready = false;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        ready = (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok;
      } catch { /* The server may still be starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `API did not become ready: ${output}`);
    const runtime = await (await fetch(`${base}/api/runtime`)).json();
    assert.equal(runtime.api.port, port);
    assert.equal(runtime.api.listening, true);
    assert.equal(runtime.api.protocol, "http");
    assert.equal(runtime.telemetry.protocol, "udp");
    assert.equal(runtime.sitl.running, false);
    assert.deepEqual(runtime.sitl.processes, []);
    const design = { id, name: `Runtime test ${id}`, nodes: [], edges: [], settings: { vehicle: "ArduPlane" }, lab: { workspaceView: "3d" } };
    assert.equal((await fetch(`${base}/api/designs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(design) })).status, 200);
    const listed = await (await fetch(`${base}/api/designs?q=${id}&limit=1`)).json();
    assert.equal(listed.designs.length, 1);
    assert.equal(listed.designs[0].id, id);
    const loaded = await (await fetch(`${base}/api/designs/${id}`)).json();
    assert.equal(loaded.design.name, design.name);
    assert.deepEqual(loaded.design.lab, design.lab);
    assert.equal((await fetch(`${base}/api/designs?limit=-1`)).status, 400);
    assert.equal((await fetch(`${base}/api/designs?q=${"a".repeat(201)}`)).status, 400);
    assert.equal((await fetch(`${base}/api/designs/not-a-uuid`)).status, 400);
    assert.equal((await fetch(`${base}/api/designs/${randomUUID()}`)).status, 404);
    assert.equal((await fetch(`${base}/api/sitl/processes/NaN`, { method: "DELETE" })).status, 400);
    assert.equal((await fetch(`${base}/api/telemetry/command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sysid: 1, action: "arm" }) })).status, 409);
    assert.equal((await fetch(`${base}/api/application/exit`, { method: "POST" })).status, 400);
    assert.equal((await fetch(`${base}/api/application/exit`, { method: "POST", headers: { "X-UAV-Lab-Action": "exit", Origin: "https://example.com" } })).status, 403);
    const exited = await fetch(`${base}/api/application/exit`, { method: "POST", headers: { "X-UAV-Lab-Action": "exit" } });
    assert.equal(exited.status, 200);
    assert.equal((await exited.json()).status, "shutting-down");
    assert.equal((await closed)[0], 0, output);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await rm(path.join(projectRoot, "data", "designs", `${id}.json`), { force: true });
  }
});

test("owned command timeouts stop the command and retain bounded output", async () => {
  await assert.rejects(runOwnedFile(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], {
    windowsHide: true, timeout: 300, maxBuffer: 1024
  }), (error) => error.code === "ETIMEDOUT" && error.killed === true && Buffer.byteLength(error.stdout) <= 1024);
});

test("owned commands preserve output and exit failures", async () => {
  assert.deepEqual(await runOwnedFile(process.execPath, ["-e", "process.stdout.write('hello'); process.stderr.write('warning')"]), {
    stdout: "hello", stderr: "warning"
  });
  const binary = await runOwnedFile(process.execPath, ["-e", "process.stdout.write(Buffer.from([0, 255]))"], { encoding: "buffer" });
  assert.deepEqual(binary.stdout, Buffer.from([0, 255]));
  await assert.rejects(runOwnedFile(process.execPath, ["-e", "process.stderr.write('failed'); process.exit(7)"]),
    (error) => error.code === 7 && error.stderr === "failed");
  await assert.rejects(runOwnedFile(`uav-missing-${randomUUID()}`, []), { code: "ENOENT" });
});

test("exited Unix command leaders stop descendants holding their output pipes", {
  skip: process.platform === "win32", timeout: 15000
}, async () => {
  const script = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit']});child.unref();console.log('descendant:'+child.pid);";
  let descendant;
  try {
    // Without exit-triggered cleanup, the descendant keeps stdout/stderr open
    // until this timeout kills it, and the successful command rejects instead.
    const result = await runOwnedFile(process.execPath, ["-e", script], { timeout: 5000 }).catch((error) => {
      descendant = Number(String(error.stdout ?? "").match(/descendant:(\d+)/)?.[1]);
      throw error;
    });
    descendant = Number(result.stdout.match(/descendant:(\d+)/)?.[1]);
    assert.ok(descendant > 0, result.stdout);
  } finally {
    // Bound cleanup even if a future regression leaves the descendant alive.
    if (descendant) { try { process.kill(descendant, "SIGKILL"); } catch {} }
  }
});

test("output limits stop the owned command tree before rejecting", { timeout: 20000 }, async () => {
  const script = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(child.pid);process.stdout.write('x'.repeat(4096));setInterval(()=>{},1000);";
  let descendant;
  try {
    await assert.rejects(runOwnedFile(process.execPath, ["-e", script], { windowsHide: true, maxBuffer: 64 }), (error) => {
      descendant = Number(error.stdout.split(/\r?\n/)[0]);
      assert.equal(error.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
      assert.ok(Buffer.byteLength(error.stdout) <= 64);
      assert.ok(descendant > 0);
      return true;
    });
    assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
  } finally {
    if (descendant) { try { process.kill(descendant); } catch {} }
  }
});

test("aborting an owned command waits for termination", async () => {
  const controller = new AbortController();
  const command = runOwnedFile(process.execPath, ["-e", "setInterval(()=>{},1000)"], { signal: controller.signal, windowsHide: true });
  controller.abort("cancelled");
  await assert.rejects(command, { code: "ABORT_ERR" });
  await assert.rejects(runOwnedFile(process.execPath, ["--version"], { signal: controller.signal }), { code: "ABORT_ERR" });
});

test("shutdown stops owned process descendants and leaves an unrelated child alive", { timeout: 15000 }, async () => {
  const script = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(child.pid);setInterval(()=>{},1000);";
  const owned = spawnOwnedProcess(process.execPath, ["-e", script], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { windowsHide: true, stdio: "ignore" });
  let descendant;
  try {
    const [data] = await once(owned.stdout, "data");
    descendant = Number(String(data).trim());
    assert.ok(descendant > 0);
    await closeOwnedProcesses();
    assert.notEqual(owned.exitCode === null && owned.signalCode === null, true);
    assert.throws(() => process.kill(descendant, 0), { code: "ESRCH" });
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    await assert.rejects(runOwnedFile(process.execPath, ["--version"]), /shutting down/);
    assert.throws(() => spawnOwnedProcess(process.execPath, ["--version"]), /shutting down/);
  } finally {
    unrelated.kill();
    if (owned.exitCode === null && owned.signalCode === null) await stopProcessTree(owned);
    if (descendant) { try { process.kill(descendant); } catch {} }
  }
});

test("API exits cleanly with an actionable error when its TCP port is occupied", { timeout: 60000 }, async (context) => {
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  const port = occupied.address().port;
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), CLIENT_PORT: String(port === 5173 ? 5174 : 5173), ARDUPILOT_LAUNCHER_PID: "" },
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  context.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    occupied.close();
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data.toString(); });
  child.stderr.on("data", (data) => { output += data.toString(); });
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    assert.match(output, new RegExp(`TCP port ${port} is already in use`));
    assert.equal(output.includes(projectRoot), false);
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => occupied.close(resolve));
  }
});
