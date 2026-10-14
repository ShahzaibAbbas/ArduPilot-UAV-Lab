import assert from "node:assert/strict";
import { once } from "node:events";
import dgram from "node:dgram";
import { createConnection, createServer } from "node:net";
import test from "node:test";
import { GcsBridge, gcsBridgeOptions } from "./gcsBridge.js";
import { clearTelemetryTrace, configureGcsBridge, detachGcsBridgeUpstream, parseMavlinkDatagram, shutdownTelemetry, startTelemetryListener, stopGcsBridge, telemetryStatus, telemetryTrace } from "./telemetry.js";

function frame({ messageId = 0, extra = 50, sysid = 1, payload = Buffer.from([0, 0, 0, 0, 2, 3, 0, 4, 3]), signed = false } = {}) {
  const header = Buffer.from([0xfd, payload.length, signed ? 1 : 0, 0, 42, sysid, 1, messageId & 255, (messageId >> 8) & 255, (messageId >> 16) & 255]);
  let crc = 0xffff;
  for (const byte of Buffer.concat([header.subarray(1), payload, Buffer.from([extra])])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16LE(crc);
  return Buffer.concat([header, payload, checksum, signed ? Buffer.alloc(13, 0xaa) : Buffer.alloc(0)]);
}

async function waitFor(check, label = "network event") {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function udp() {
  const socket = dgram.createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const received = [];
  socket.on("message", (data, remote) => received.push({ data, remote }));
  return { socket, port: socket.address().port, received };
}

async function freeTcpPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fixture(t) {
  const upstream = await udp();
  const gcs = await udp();
  const reservation = await udp();
  const labPort = reservation.port;
  await new Promise((resolve) => reservation.socket.close(resolve));
  const tcpPort = await freeTcpPort();
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.destroy();
    await shutdownTelemetry();
    upstream.socket.close();
    gcs.socket.close();
  });
  await startTelemetryListener({ host: "127.0.0.1", port: labPort });
  await configureGcsBridge({ tcp: { host: "127.0.0.1", port: tcpPort }, outputs: [{ id: "mission-planner", name: "Mission Planner", host: "localhost", port: gcs.port }] });
  return {
    upstream, gcs, labPort, tcpPort,
    sendUpstream: (packet) => upstream.socket.send(packet, labPort, "127.0.0.1"),
    sendGcs: (packet) => gcs.socket.send(packet, labPort, "127.0.0.1"),
    connect: async () => {
      const client = createConnection({ host: "127.0.0.1", port: tcpPort });
      client.on("error", () => undefined);
      clients.push(client);
      const received = [];
      client.on("data", (data) => received.push(data));
      await once(client, "connect");
      return { client, received };
    }
  };
}

test("Windows GCS UDP receives exact signed frames and replies through the existing listener", async (t) => {
  const f = await fixture(t);
  clearTelemetryTrace();
  assert.equal(telemetryStatus().gcsBridge.upstreamConnected, false);
  const gcsHeartbeat = frame({ sysid: 42, payload: Buffer.from([0, 0, 0, 0, 6, 8, 0, 4, 3]) });
  f.sendGcs(gcsHeartbeat);
  await waitFor(() => telemetryStatus().gcsBridge.droppedFrames === 1);
  assert.equal(telemetryStatus().gcsBridge.upstream, undefined);
  assert.equal(telemetryStatus().vehicles.some((vehicle) => vehicle.sysid === 42), false);
  const heartbeat = frame();
  f.sendUpstream(heartbeat);
  await waitFor(() => f.gcs.received.length === 1);
  assert.deepEqual(f.gcs.received[0].data, heartbeat);
  assert.equal(f.gcs.received[0].remote.port, f.labPort);
  assert.equal(telemetryStatus().gcsBridge.upstreamConnected, true);
  const parameter = frame({ messageId: 22, extra: 220, payload: Buffer.alloc(25, 2), signed: true });
  f.sendUpstream(parameter);
  await waitFor(() => f.gcs.received.length === 2);
  assert.deepEqual(f.gcs.received[1].data, parameter);
  const request = frame({ messageId: 21, extra: 159, payload: Buffer.from([1, 1]), sysid: 42 });
  f.sendGcs(request);
  await waitFor(() => f.upstream.received.length === 1);
  assert.deepEqual(f.upstream.received[0].data, request);
  assert.equal(telemetryStatus().vehicles.some((vehicle) => vehicle.sysid === 42), false);
  const trace = telemetryTrace({ limit: 100 }).events;
  assert.ok(trace.some((event) => event.direction === "tx" && event.correlation === "bridge:gcs-to-sitl"));
  assert.ok(trace.some((event) => event.direction === "tx" && event.correlation === "bridge:sitl-to-gcs-udp"));
});

test("TCP bridge supports split and coalesced MAVLink frames and drops corrupt/unknown commands", async (t) => {
  const f = await fixture(t);
  const tcp = await f.connect();
  f.sendUpstream(frame());
  await waitFor(() => tcp.received.length > 0);
  assert.deepEqual(Buffer.concat(tcp.received), frame());
  const request = frame({ messageId: 21, extra: 159, payload: Buffer.from([1, 1]), sysid: 99 });
  const command = frame({ messageId: 76, extra: 152, payload: Buffer.alloc(33), sysid: 99 });
  tcp.client.write(request.subarray(0, 5));
  tcp.client.write(Buffer.concat([request.subarray(5), command]));
  await waitFor(() => f.upstream.received.length === 2);
  assert.deepEqual(f.upstream.received.map((entry) => entry.data), [request, command]);
  const corrupt = Buffer.from(request);
  corrupt[corrupt.length - 1] ^= 0x40;
  const unknown = frame({ messageId: 0x123456, payload: Buffer.alloc(2) });
  tcp.client.write(Buffer.concat([Buffer.alloc(8192, 1), corrupt, unknown, request]));
  await waitFor(() => f.upstream.received.length === 3);
  assert.deepEqual(f.upstream.received.at(-1).data, request);
  assert.ok(telemetryStatus().gcsBridge.droppedFrames >= 2);
});

test("bridge pins vehicle upstream, bounds clients, and releases TCP port and return links on stop", async (t) => {
  const f = await fixture(t);
  const outsider = await udp();
  t.after(() => outsider.socket.close());
  f.sendUpstream(frame());
  await waitFor(() => telemetryStatus().gcsBridge.upstreamConnected);
  outsider.socket.send(frame({ sysid: 73 }), f.labPort, "127.0.0.1");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(telemetryStatus().gcsBridge.upstream.port, f.upstream.port);
  assert.equal(telemetryStatus().vehicles.some((vehicle) => vehicle.sysid === 73), false);
  for (let index = 0; index < 4; index += 1) await f.connect();
  await waitFor(() => telemetryStatus().gcsBridge.tcp.clients === 4);
  const extra = await f.connect();
  await waitFor(() => extra.client.destroyed);
  assert.equal(telemetryStatus().gcsBridge.tcp.clients, 4);
  await stopGcsBridge();
  assert.equal(telemetryStatus().gcsBridge.active, false);
  assert.equal(telemetryStatus().gcsBridge.upstream, undefined);
  assert.ok(telemetryStatus().vehicles.every((vehicle) => !vehicle.link));
  const rebound = createServer();
  rebound.listen(f.tcpPort, "127.0.0.1");
  await once(rebound, "listening");
  await new Promise((resolve) => rebound.close(resolve));
});

test("GCS bridge rejects local UDP recursion, invalid settings, and busy TCP endpoints", async (t) => {
  const f = await fixture(t);
  await assert.rejects(configureGcsBridge({ tcp: { host: "127.0.0.1", port: f.tcpPort }, outputs: [{ host: "localhost", port: f.labPort }] }), /cannot use the lab telemetry listener's port/);
  for (const port of [0, 1023, 65536, 1.5, true, {}, ""]) assert.throws(() => gcsBridgeOptions({ gcsTcpPort: port }), { statusCode: 400 });
  assert.deepEqual(gcsBridgeOptions(), { host: "127.0.0.1", port: 5762 });
  const occupied = createServer();
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  await assert.rejects(configureGcsBridge({ tcp: { host: "127.0.0.1", port: occupied.address().port }, outputs: [] }), (error) => error.statusCode === 409 && /already in use/.test(error.message));
  assert.equal(telemetryStatus().gcsBridge.active, false);
});

test("bridge UDP send backlog is bounded and stale upstream cannot receive commands", async () => {
  const bridge = new GcsBridge({ parse: parseMavlinkDatagram, sendUdp: () => new Promise(() => undefined), trace: () => undefined });
  bridge.state.active = true;
  bridge.state.outputs = [{ host: "127.0.0.1", port: 14551 }];
  const packet = parseMavlinkDatagram(frame())[0];
  for (let index = 0; index < 1000; index += 1) bridge.receive(packet, { address: "127.0.0.1", port: 16000 });
  assert.equal(bridge.pendingUdp, 256);
  assert.equal(bridge.status().droppedFrames, 744);
  bridge.state.upstream.lastPacketAt = new Date(Date.now() - 30000).toISOString();
  assert.equal(bridge.status().upstreamConnected, false);
  bridge.toUpstream(packet);
  assert.equal(bridge.status().droppedFrames, 745);
  await bridge.stop();
});

const gcsHeartbeatFrame = (sysid = 255) => frame({ sysid, payload: Buffer.from([0, 0, 0, 0, 6, 8, 0, 4, 3]) });

test("a loopback client-mode GCS on the lab listener port receives vehicle data and reaches SITL", async (t) => {
  const f = await fixture(t);
  const client = await udp();
  const remote = await udp();
  t.after(() => { client.socket.close(); remote.socket.close(); });
  f.sendUpstream(frame());
  await waitFor(() => telemetryStatus().gcsBridge.upstreamConnected, "upstream");
  // Mission Planner UDPCl sends to the lab port from an ephemeral port instead of listening.
  client.socket.send(gcsHeartbeatFrame(), f.labPort, "127.0.0.1");
  await waitFor(() => telemetryStatus().gcsBridge.outputs.some((output) => output.dynamic), "client registration");
  const registered = telemetryStatus().gcsBridge.outputs.find((output) => output.dynamic);
  assert.equal(registered.port, client.port);
  assert.equal(telemetryStatus().gcsBridge.upstream.port, f.upstream.port, "a GCS heartbeat must not replace the simulator upstream");
  f.sendUpstream(frame({ messageId: 22, extra: 220, payload: Buffer.alloc(25, 3) }));
  await waitFor(() => client.received.length === 1, "vehicle data at the client");
  assert.equal(client.received[0].remote.port, f.labPort);
  const request = frame({ messageId: 21, extra: 159, payload: Buffer.from([1, 1]), sysid: 255 });
  client.socket.send(request, f.labPort, "127.0.0.1");
  await waitFor(() => f.upstream.received.some((entry) => entry.data.equals(request)), "client request upstream");
  const link = telemetryStatus().gcsBridge.gcsLinks.find((entry) => entry.port === client.port);
  assert.deepEqual([link.transport, link.sysid, link.compid, link.connected, link.dynamic], ["udp", 255, 1, true, true]);
  assert.equal(telemetryStatus().vehicles.some((vehicle) => vehicle.sysid === 255), false);
  // Only heartbeats from a ground station register; other traffic from new endpoints stays ignored.
  remote.socket.send(frame({ sysid: 9 }), f.labPort, "127.0.0.1");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(telemetryStatus().gcsBridge.outputs.filter((output) => output.dynamic).length, 1);
  await stopGcsBridge();
  assert.equal(telemetryStatus().gcsBridge.outputs.some((output) => output.dynamic), false);
});

test("a ground station holding two live links is reported, and TCP heartbeats identify the client", async (t) => {
  const f = await fixture(t);
  const tcp = await f.connect();
  f.sendUpstream(frame());
  await waitFor(() => telemetryStatus().gcsBridge.upstreamConnected, "upstream");
  f.sendGcs(gcsHeartbeatFrame());
  await waitFor(() => telemetryStatus().gcsBridge.gcsLinks.length === 1, "UDP link");
  assert.deepEqual(telemetryStatus().gcsBridge.warnings, []);
  tcp.client.write(gcsHeartbeatFrame());
  await waitFor(() => telemetryStatus().gcsBridge.gcsLinks.length === 2, "TCP link");
  const status = telemetryStatus().gcsBridge;
  assert.deepEqual(status.gcsLinks.map((link) => link.transport).sort(), ["tcp", "udp"]);
  assert.equal(status.warnings.length, 1);
  assert.match(status.warnings[0], /SYS 255\/1 is live on 2 links/);
  // UDP plus TCP is a doubled connection, not AutoConnect's two UDP listeners.
  assert.match(status.warnings[0], /connected more than once/);
  assert.doesNotMatch(status.warnings[0], /AutoConnect/);
});

test("a slow TCP reader skips frames instead of being disconnected mid-download", async () => {
  const bridge = new GcsBridge({ parse: parseMavlinkDatagram, sendUdp: async () => undefined, trace: () => undefined });
  bridge.state.active = true;
  const writes = [];
  const slow = { destroyed: false, writableLength: 600 * 1024, remotePort: 50000, write: (data) => writes.push(data), destroy() { this.destroyed = true; } };
  const detail = { host: "127.0.0.1", port: 50000, sentPackets: 0, droppedFrames: 0 };
  bridge.clients.add(slow);
  bridge.clientDetails.set(slow, detail);
  const packet = parseMavlinkDatagram(frame())[0];
  bridge.receive(packet, { address: "127.0.0.1", port: 16000 });
  assert.equal(slow.destroyed, false);
  assert.equal(writes.length, 0);
  assert.equal(detail.droppedFrames, 1);
  slow.writableLength = 0;
  bridge.receive(packet, { address: "127.0.0.1", port: 16000 });
  assert.equal(writes.length, 1);
  assert.equal(detail.sentPackets, 1);
  await bridge.stop();
});

test("an endpoint that later sends a vehicle heartbeat stops being treated as a client-mode GCS", async () => {
  const bridge = new GcsBridge({ parse: parseMavlinkDatagram, sendUdp: async () => undefined, trace: () => undefined });
  bridge.state.active = true;
  const gcs = parseMavlinkDatagram(gcsHeartbeatFrame())[0];
  const vehicle = parseMavlinkDatagram(frame())[0];
  const endpoint = { address: "127.0.0.1", port: 17000 };
  assert.equal(bridge.receive(gcs, endpoint), true);
  assert.equal(bridge.state.outputs.filter((output) => output.dynamic).length, 1);
  assert.equal(bridge.receive(vehicle, endpoint), false);
  assert.equal(bridge.state.outputs.length, 0);
  assert.equal(bridge.state.upstream.port, 17000);
  assert.equal(bridge.receive(gcs, { address: "10.0.0.5", port: 17001 }), true, "non-loopback GCS traffic is consumed");
  assert.equal(bridge.state.outputs.length, 0, "non-loopback ground stations never register");
  await bridge.stop();
});

test("a SITL relaunch keeps the TCP ground station connected and pins the new simulator immediately", async (t) => {
  const f = await fixture(t);
  const tcp = await f.connect();
  f.sendUpstream(frame());
  await waitFor(() => tcp.received.length === 1, "first simulator heartbeat");
  // SITL exits: the simulator return path is released, the relay keeps listening.
  await detachGcsBridgeUpstream();
  assert.equal(telemetryStatus().gcsBridge.upstream, undefined);
  assert.equal(telemetryStatus().gcsBridge.tcp.listening, true);
  assert.equal(tcp.client.destroyed, false);
  // Relaunch on the same endpoints reuses the relay instead of dropping clients.
  await configureGcsBridge({ tcp: { host: "127.0.0.1", port: f.tcpPort }, outputs: [{ id: "mission-planner", name: "Mission Planner", host: "localhost", port: f.gcs.port }] });
  assert.equal(telemetryStatus().gcsBridge.tcp.clients, 1);
  const relaunched = await udp();
  t.after(() => relaunched.socket.close());
  const heartbeat = frame({ sysid: 2 });
  relaunched.socket.send(heartbeat, f.labPort, "127.0.0.1");
  await waitFor(() => tcp.received.length === 2, "relaunched simulator heartbeat");
  assert.deepEqual(tcp.received[1], heartbeat);
  assert.equal(telemetryStatus().gcsBridge.upstream.port, relaunched.port);
  const request = frame({ messageId: 21, extra: 159, payload: Buffer.from([2, 1]), sysid: 255 });
  tcp.client.write(request);
  await waitFor(() => relaunched.received.length === 1, "request reaches the relaunched simulator");
  assert.deepEqual(relaunched.received[0].data, request);
  assert.equal(f.upstream.received.length, 0, "the exited simulator endpoint receives nothing");
});

test("two lab UDP outputs on 14550 and 14551 with one identity are explained as Mission Planner AutoConnect", () => {
  const bridge = new GcsBridge({ parse: parseMavlinkDatagram, sendUdp: async () => undefined, trace: () => undefined });
  bridge.state.active = true;
  bridge.state.outputs = [14550, 14551].map((port) => ({ name: `GCS ${port}`, host: "127.0.0.1", port, sentPackets: 0, receivedPackets: 0 }));
  const heartbeat = parseMavlinkDatagram(gcsHeartbeatFrame())[0];
  for (const port of [14550, 14551]) bridge.receive(heartbeat, { address: "127.0.0.1", port });
  const [warning] = bridge.status().warnings;
  assert.match(warning, /AutoConnect is listening on UDP 14550 and 14551/);
});
