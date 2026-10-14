import assert from "node:assert/strict";
import test from "node:test";
import dgram from "node:dgram";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateBomCsvArtifact, generateBomHtmlArtifact, generateGazeboPluginFiles, generateJsonBridgeArtifact, generateSimulatorBundleArtifact } from "./artifacts.js";
import { batteryMetrics } from "./batteryModel.js";

async function bindPeer(port = 0) {
  const peer = dgram.createSocket("udp4");
  try {
    const listening = once(peer, "listening");
    peer.bind(port, "127.0.0.1");
    await listening;
    return peer;
  } catch (error) {
    try { peer.close(); } catch (closeError) {
      if (closeError.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") throw closeError;
    }
    throw error;
  }
}

async function freeBasePort(count = 1) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const probes = [];
    try {
      probes.push(await bindPeer());
      const port = probes[0].address().port;
      if (port + (count - 1) * 10 > 65535) continue;
      for (let index = 1; index < count; index += 1) probes.push(await bindPeer(port + index * 10));
      return port;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    } finally {
      await Promise.all(probes.map((peer) => new Promise((resolve) => peer.close(resolve))));
    }
  }
  throw new Error("Could not reserve isolated JSON bridge test ports.");
}

async function waitFor(check, diagnostics = () => "", timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for generated JSON bridge: ${diagnostics()}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function withGeneratedBridge(settings, run, { name = "Synthetic JSON model", port } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "uav-artifact-"));
  const artifact = generateJsonBridgeArtifact({ name, settings });
  const file = path.join(directory, artifact.fileName);
  let child;
  let closed;
  let output = "";
  let basePort;
  try {
    await writeFile(file, artifact.content, "utf8");
    // Probed ports are released before the bridge binds them, so a concurrently
    // running test file can take one first. Retry only those collisions.
    for (let attempt = 1; ; attempt += 1) {
      basePort = port ?? await freeBasePort(settings.swarmCount ?? 1);
      output = "";
      child = spawn(process.execPath, [file], {
        cwd: directory,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, UAV_LAB_JSON_BRIDGE_HOST: "127.0.0.1", UAV_LAB_JSON_BRIDGE_PORT: String(basePort) }
      });
      closed = once(child, "close");
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      if (port !== undefined || attempt >= 5) break;
      await waitFor(() => /JSON bridge ready|could not start/.test(output), () => output);
      if (!/could not start: bind EADDRINUSE/.test(output)) break;
      await closed;
    }
    await run({ basePort, artifact, child, closed, output: () => output });
  } finally {
    if (child?.exitCode === null && child?.signalCode === null) child.kill();
    if (closed) await closed;
    // Only remove the exact temporary directory created for this test.
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("uav-artifact-"));
    await rm(directory, { recursive: true, force: true });
  }
}

function controls({ channels = 16, frameRate = 400, frameCount = 0, magic = channels === 16 ? 18458 : 29569 } = {}) {
  const frame = Buffer.alloc(8 + channels * 2);
  frame.writeUInt16LE(magic, 0);
  frame.writeUInt16LE(frameRate, 2);
  frame.writeUInt32LE(frameCount, 4);
  for (let index = 0; index < channels; index += 1) frame.writeUInt16LE(1000 + index, 8 + index * 2);
  return frame;
}

async function exchange(peer, frame, port) {
  const received = once(peer, "message", { signal: AbortSignal.timeout(3000) });
  await new Promise((resolve, reject) => peer.send(frame, port, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  const [message] = await received;
  assert.equal(message[0], 10);
  assert.equal(message.at(-1), 10);
  return { message, data: JSON.parse(message.toString("utf8")) };
}

test("standalone generated JSON bridge accepts both servo formats with mandatory ArduPilot sensor fields", { timeout: 8000 }, async () => {
  await withGeneratedBridge({ swarmCount: 1 }, async ({ basePort, output }) => {
    await waitFor(() => output().includes("JSON bridge ready"), output);
    const peer = await bindPeer();
    try {
      const first = await exchange(peer, controls(), basePort);
      assert.deepEqual(first.data, {
        timestamp: 0,
        imu: { gyro: [0, 0, 0], accel_body: [0, 0, -9.80665] },
        position: [0, 0, 0], attitude: [0, 0, 0], velocity: [0, 0, 0]
      });
      const next = await exchange(peer, controls({ channels: 32, frameCount: 4 }), basePort);
      assert.equal(next.data.timestamp, 0.01);
      const repeated = await exchange(peer, controls({ channels: 32, frameCount: 4 }), basePort);
      assert.deepEqual(repeated.message, next.message);
      const restarted = await exchange(peer, controls({ frameCount: 0 }), basePort);
      assert.equal(restarted.data.timestamp, 0);
    } finally { await new Promise((resolve) => peer.close(resolve)); }
  });
});

test("JSON swarm routes each vehicle on its instance port and keeps clocks independent", { timeout: 8000 }, async () => {
  await withGeneratedBridge({ swarmCount: 2, swarmLayout: "line", swarmSpacingM: 20 }, async ({ basePort, output }) => {
    await waitFor(() => output().includes("JSON bridge ready"), output);
    const peer = await bindPeer();
    const received = [];
    peer.on("message", (message) => received.push(JSON.parse(message.toString("utf8"))));
    try {
      assert.deepEqual((await exchange(peer, controls(), basePort)).data.position, [-10, 0, 0]);
      assert.deepEqual((await exchange(peer, controls(), basePort + 10)).data.position, [10, 0, 0]);
      assert.equal((await exchange(peer, controls({ frameCount: 2 }), basePort)).data.timestamp, 0.005);
      assert.equal((await exchange(peer, controls({ frameCount: 1, frameRate: 50 }), basePort + 10)).data.timestamp, 0.02);
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(received.length, 4);
    } finally { await new Promise((resolve) => peer.close(resolve)); }
  });
});

test("JSON bridge ignores malformed datagrams and rejects a second active peer", { timeout: 8000 }, async () => {
  await withGeneratedBridge({ swarmCount: 1 }, async ({ basePort, output }) => {
    await waitFor(() => output().includes("JSON bridge ready"), output);
    const peer = await bindPeer();
    const stranger = await bindPeer();
    const received = [];
    let strangerResponses = 0;
    peer.on("message", (message) => received.push(message));
    stranger.on("message", () => { strangerResponses += 1; });
    try {
      for (const frame of [Buffer.from("{}"), controls({ magic: 1 }), controls({ frameRate: 0 }), controls().subarray(0, 39), controls({ channels: 32, magic: 18458 })]) {
        peer.send(frame, basePort, "127.0.0.1");
      }
      await exchange(peer, controls(), basePort);
      stranger.send(controls(), basePort, "127.0.0.1");
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(received.length, 1);
      assert.equal(strangerResponses, 0);
      assert.equal((await exchange(peer, controls({ frameCount: 1 }), basePort)).data.timestamp, 1 / 400);
    } finally {
      await Promise.all([peer, stranger].map((socket) => new Promise((resolve) => socket.close(resolve))));
    }
  });
});

test("generated JSON bridge remains valid outside the repo with arbitrary design and host strings", { timeout: 8000 }, async () => {
  await withGeneratedBridge({ swarmCount: 1, jsonHost: '"; throw new Error("injected"); //\n' }, async ({ artifact, output }) => {
    assert.ok(artifact.fileName.endsWith(".mjs"));
    await waitFor(() => output().includes("JSON bridge ready"), output);
  }, { name: 'Name\nthrow new Error("injected")\n// Unicode \u2028 test' });
});

test("JSON bridge startup failure closes earlier instance sockets", { timeout: 8000 }, async () => {
  const basePort = await freeBasePort(2);
  const busy = await bindPeer(basePort + 10);
  try {
    await withGeneratedBridge({ swarmCount: 2 }, async ({ closed, output }) => {
      const [code] = await closed;
      assert.equal(code, 1);
      assert.match(output(), /could not start/);
      const released = await bindPeer(basePort);
      await new Promise((resolve) => released.close(resolve));
    }, { port: basePort });
  } finally { await new Promise((resolve) => busy.close(resolve)); }
});

test("simulator bundles contain runnable JSON modules and explain Gazebo integration limits", () => {
  const design = { name: "Synthetic model", nodes: [], edges: [], settings: {} };
  const bundle = generateSimulatorBundleArtifact(design);
  assert.ok(bundle.files.includes("json-bridge/synthetic-model-json-bridge.mjs"));
  const readme = generateGazeboPluginFiles(design).find((file) => file.name === "README.md").content;
  assert.match(readme, /currently log the configured settings/);
  assert.match(readme, /Successful compilation verifies the helper build only/);
});

function batteryBomDesign(properties = {}) {
  return { name: "Synthetic battery BOM", nodes: [{ id: "battery", data: {
    componentType: "battery", label: "Bench battery", properties
  } }], edges: [], settings: {} };
}

test("battery BOM uses common chemistry-aware mass estimates and records pack metadata", () => {
  for (const chemistry of ["LiPo", "LiHV", "Li-ion"]) {
    const properties = { chemistry, cells: 6, parallelCells: 2, capacityMah: 10000, cRating: 10,
      continuousCurrentA: 80, connectorCurrentA: 60, specNotes: "Synthetic specification" };
    const metrics = batteryMetrics(properties);
    const csv = generateBomCsvArtifact(batteryBomDesign(properties)).content;
    const mass = Math.round(metrics.massG * 10) / 10;
    assert.ok(csv.includes(`,${mass},0,`));
    assert.match(csv, new RegExp(`${chemistry} 6S2P; 10000 mAh total pack`));
    assert.ok(csv.includes(`${metrics.energyWh.toFixed(2)} Wh; 60.00 A continuous planning limit; estimated mass`));
    assert.ok(csv.includes("Synthetic specification"));
  }
});

test("recorded battery mass takes precedence over generic estimates in CSV and printable BOM", () => {
  const design = batteryBomDesign({ chemistry: "Li-ion", cells: 6, capacityMah: 8400, specMassG: 846.5 });
  assert.match(generateBomCsvArtifact(design).content, /,846\.5,0,/);
  assert.match(generateBomCsvArtifact(design).content, /recorded mass/);
  assert.match(generateBomHtmlArtifact(design).content, /846\.5/);
});

test("BOM exports reject invalid battery specifications even when mass is recorded", () => {
  for (const properties of [{ cells: 0 }, { capacityMah: NaN }, { cRating: 0 }, { specMassG: -5 },
    { chemistry: "LiPo", maxCellVoltageV: 4.35, specMassG: 500 }]) {
    assert.throws(() => generateBomCsvArtifact(batteryBomDesign(properties)), (error) => error.statusCode === 400 && /Battery/.test(error.message));
    assert.throws(() => generateBomHtmlArtifact(batteryBomDesign(properties)), (error) => error.statusCode === 400);
  }
});
