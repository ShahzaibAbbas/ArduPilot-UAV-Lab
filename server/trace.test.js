import assert from "node:assert/strict";
import test from "node:test";
import dgram from "node:dgram";
import { once } from "node:events";
import { clearTelemetryTrace, downloadMission, missionItemsFromText, missionSyncStatus, parseMavlinkDatagram, pauseTelemetryTrace, resumeTelemetryTrace, sendMavlinkCommand, shutdownTelemetry, startTelemetryListener, stopTelemetryListener, telemetryStatus, telemetryTrace, uploadMission } from "./telemetry.js";
import { TraceBuffer } from "./trace.js";

function traceEvent(index, overrides = {}) {
  return {
    direction: index % 2 ? "rx" : "tx",
    protocol: "MAVLink2",
    sequence: index,
    systemId: 1,
    componentId: 1,
    messageId: index % 2 ? 0 : 76,
    messageName: index % 2 ? "HEARTBEAT" : "COMMAND_LONG",
    payloadLength: 2,
    frameLength: 14,
    datagramLength: 14,
    summary: `event ${index}`,
    rawFrame: Buffer.from([index, 0xaa, 0xbb, 0xcc]),
    ...overrides
  };
}

// Independent bit-at-a-time reference (CRC-16/MCRF4XX), separate from the production accumulator.
function referenceCrc(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
  }
  return crc;
}

function mavlinkFrame({ version = 2, messageId = 0, payload = Buffer.from([0, 0, 0, 0, 2, 3, 0, 4, 3]), crcExtra = 50, flags = 0, sysid = 241, compid = 2 } = {}) {
  const header = version === 1
    ? Buffer.from([0xfe, payload.length, 7, sysid, compid, messageId])
    : Buffer.from([0xfd, payload.length, flags, 0, 7, sysid, compid, messageId & 255, (messageId >> 8) & 255, (messageId >> 16) & 255]);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(referenceCrc(Buffer.concat([header.subarray(1), payload, Buffer.from([crcExtra])])));
  return Buffer.concat([header, payload, crc, version === 2 && (flags & 1) ? Buffer.alloc(13, 0xfd) : Buffer.alloc(0)]);
}

test("bounds trace history and caps raw frame previews", () => {
  const trace = new TraceBuffer({ maxCount: 3, maxBytes: 1024 * 1024, rawPreviewBytes: 2 });
  for (let index = 1; index <= 5; index += 1) {
    trace.add(traceEvent(index));
  }

  const events = trace.query({ limit: 50 });
  assert.deepEqual(
    events.map((event) => event.id),
    [3, 4, 5]
  );
  assert.equal(events[0].rawPreviewHex.length, 4);
  assert.equal(trace.stats().droppedCount, 2);
});

test("filters trace events and pauses collection without resetting monotonic ids", () => {
  const trace = new TraceBuffer({ maxCount: 10 });
  trace.add(traceEvent(1, { systemId: 1, componentId: 2, messageId: 0, summary: "primary heartbeat" }));
  trace.add(traceEvent(2, { systemId: 7, componentId: 1, messageId: 76, direction: "tx" }));

  assert.equal(trace.query({ sysid: 7 }).length, 1);
  assert.equal(trace.query({ compid: 2, text: "heartbeat" }).length, 1);
  assert.equal(trace.query({ direction: "rx", protocol: "MAVLink2" }).length, 1);

  trace.pause();
  assert.equal(trace.add(traceEvent(3)), undefined);
  trace.resume();
  const resumed = trace.add(traceEvent(4));
  assert.equal(resumed.id, 3);
  assert.equal(trace.clear(), 3);
  assert.equal(trace.stats().count, 0);
});

test("exports bounded JSON and escaped CSV", () => {
  const trace = new TraceBuffer({ maxCount: 10 });
  trace.add(traceEvent(1, { summary: 'status, "ready"' }));
  const json = JSON.parse(trace.export("json").content);
  const csv = trace.export("csv").content;

  assert.equal(json.format, "ardupilot-uav-lab.mavtrace");
  assert.equal(json.events.length, 1);
  assert.match(csv, /"status, ""ready"""/);
});

test("parses MAVLink v1 framing data used by the receive trace", () => {
  const frame = mavlinkFrame({ version: 1, sysid: 1 });
  const packets = parseMavlinkDatagram(frame);

  assert.equal(packets.length, 1);
  assert.equal(packets[0].version, 1);
  assert.equal(packets[0].seq, 7);
  assert.equal(packets[0].sysid, 1);
  assert.equal(packets[0].compid, 2);
  assert.equal(packets[0].frameLength, 17);
  assert.equal(packets[0].checksumStatus, "valid");
  assert.deepEqual(packets[0].frame, frame);
});

test("enforces hard caps even with excessive environment-style settings", () => {
  const trace = new TraceBuffer({ maxCount: 1e9, maxBytes: 1e9, rawPreviewBytes: 1e9 });
  assert.equal(trace.maxCount, 10000);
  assert.equal(trace.maxBytes, 16 * 1024 * 1024);
  assert.equal(trace.add(traceEvent(1, { rawFrame: Buffer.alloc(1024) })).rawPreviewHex.length, 560);
  const defaults = new TraceBuffer({ maxCount: Infinity, maxBytes: "invalid", rawPreviewBytes: {} });
  assert.equal(defaults.maxCount, 1000);
  assert.equal(defaults.maxBytes, 1024 * 1024);
  assert.equal(defaults.rawPreviewBytes, 96);
});

test("enforces byte capacity and avoids evicting prior events for an oversized event", () => {
  const trace = new TraceBuffer({ maxBytes: 1024, rawPreviewBytes: 280 });
  trace.add(traceEvent(1));
  const previous = trace.query();
  assert.equal(trace.add(traceEvent(2, { summary: "🚁".repeat(320), rawFrame: Buffer.alloc(280) })), undefined);
  assert.deepEqual(trace.query(), previous);
  assert.equal(trace.stats().droppedCount, 1);
  for (let index = 3; index < 30; index += 1) trace.add(traceEvent(index));
  assert.ok(trace.stats().approximateBytes <= 1024);
  assert.ok(trace.stats().count < 10);
  assert.equal(trace.query().at(-1).sequence, 29);
});

test("trace snapshots cannot mutate stored endpoint data", () => {
  const trace = new TraceBuffer();
  const result = trace.add(traceEvent(1, { remote: { host: "127.0.0.1", port: 14550 } }));
  result.remote.host = "changed";
  trace.query()[0].remote.port = 1;
  assert.deepEqual(trace.query()[0].remote, { host: "127.0.0.1", port: 14550 });
});

test("invalid filters cannot silently expand to all packets", () => {
  const trace = new TraceBuffer();
  trace.add(traceEvent(1));
  for (const value of ["invalid", "1e0", "0x1", -1, true, [1], {}, Infinity]) {
    assert.deepEqual(trace.query({ systemId: value }), []);
  }
  assert.equal(trace.query({ systemId: " 1 ", componentId: "", direction: "all" }).length, 1);
  assert.deepEqual(trace.query({ direction: "invalid" }), []);
  assert.deepEqual(trace.query({ protocol: "invalid" }), []);
  assert.deepEqual(trace.query({ afterId: "invalid" }), []);
  assert.deepEqual(trace.query({ afterId: 1 }), []);
});

test("exports every filtered buffered event beyond the paged API limit", () => {
  const trace = new TraceBuffer();
  for (let index = 1; index <= 900; index += 1) trace.add(traceEvent(index));
  assert.equal(trace.query({ limit: 9999 }).length, 500);
  const exported = JSON.parse(trace.export("json", { limit: 250 }).content);
  assert.equal(exported.events.length, 900);
  assert.equal(exported.exportedCount, 900);
  assert.equal(JSON.parse(trace.export("json", { direction: "rx" }).content).events.length, 450);
  assert.equal(trace.export("csv", { direction: "tx" }).content.trim().split("\n").length, 451);
});

test("CSV export neutralizes spreadsheet formulas while JSON preserves original text", () => {
  for (const summary of ["=1+1", "+SUM(1,2)", "@SUM(1)", "-1+2", " \t=1", "\n=2"]) {
    const trace = new TraceBuffer();
    trace.add(traceEvent(1, { summary }));
    assert.equal(JSON.parse(trace.export("json").content).events[0].summary, summary);
    assert.ok(trace.export("csv").content.includes(`"'${summary}"`));
  }
});

test("clear preserves pause state and monotonic ids, without retaining byte usage", () => {
  const trace = new TraceBuffer();
  trace.add(traceEvent(1));
  trace.pause();
  trace.clear();
  assert.equal(trace.stats().paused, true);
  assert.equal(trace.stats().approximateBytes, 0);
  assert.equal(trace.add(traceEvent(2)), undefined);
  trace.resume();
  assert.equal(trace.add(traceEvent(3)).id, 2);
});

test("validates reference CRCs and labels corrupt supported messages", () => {
  assert.equal(referenceCrc(Buffer.from("123456789")), 0x6f91);
  for (const version of [1, 2]) {
    const frame = mavlinkFrame({ version });
    assert.equal(parseMavlinkDatagram(frame)[0].checksumStatus, "valid");
    frame[version === 1 ? 6 : 10] ^= 0x80;
    assert.equal(parseMavlinkDatagram(frame)[0].checksumStatus, "invalid");
  }
});

test("MAVLink2 restores omitted zero bytes while retaining exact raw framing", () => {
  const frame = mavlinkFrame({ messageId: 77, payload: Buffer.from([0x90, 1]), crcExtra: 143 });
  const [packet] = parseMavlinkDatagram(frame);
  assert.equal(packet.checksumStatus, "valid");
  assert.equal(packet.payloadLength, 2);
  assert.equal(packet.payload.length, 3);
  assert.equal(packet.payload.readUInt16LE(0), 400);
  assert.equal(packet.payload[2], 0); // MAV_RESULT_ACCEPTED omitted on the wire.
  assert.deepEqual(packet.frame, frame);
});

test("handles mixed datagrams, signatures, unknown dialect ids and unsupported flags", () => {
  const first = mavlinkFrame({ version: 1 });
  const signed = mavlinkFrame({ flags: 1 });
  const unknown = mavlinkFrame({ messageId: 0x123456, payload: Buffer.from([1, 2]) });
  const unsupported = mavlinkFrame({ flags: 2 });
  const packets = parseMavlinkDatagram(Buffer.concat([Buffer.from([1, 2, 3]), first, signed, unsupported, unknown]));
  assert.equal(packets.length, 3);
  assert.equal(packets[1].signed, true);
  assert.equal(packets[1].checksumStatus, "valid");
  assert.equal(packets[1].frameLength, signed.length);
  assert.equal(packets[2].msgid, 0x123456);
  assert.equal(packets[2].checksumStatus, "unknown");
});

test("rejects incomplete frames and recovers after a stray truncated frame marker", () => {
  const frame = mavlinkFrame({ flags: 1 });
  for (let length = 0; length < frame.length; length += 1) {
    assert.deepEqual(parseMavlinkDatagram(frame.subarray(0, length)), []);
  }
  const valid = mavlinkFrame();
  const packets = parseMavlinkDatagram(Buffer.concat([Buffer.from([0xfd, 255, 0, 0]), valid]));
  assert.equal(packets.length, 1);
  assert.equal(packets[0].checksumStatus, "valid");
  assert.deepEqual(parseMavlinkDatagram(undefined), []);
});

async function waitFor(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for loopback telemetry");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("loopback telemetry traces corruption, preserves live state while paused, and emits valid command CRCs", async () => {
  const peer = dgram.createSocket("udp4");
  const probe = dgram.createSocket("udp4");
  peer.bind(0, "127.0.0.1");
  await once(peer, "listening");
  probe.bind(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  try {
    await startTelemetryListener({ port });
    clearTelemetryTrace();
    resumeTelemetryTrace();
    const valid = mavlinkFrame();
    peer.send(valid, port, "127.0.0.1");
    await waitFor(() => telemetryTrace().events.length === 1);
    assert.equal(telemetryStatus().vehicles[0].heartbeat.armed, false);

    const corrupt = Buffer.from(valid);
    corrupt[16] = 0x80;
    peer.send(corrupt, port, "127.0.0.1");
    await waitFor(() => telemetryTrace().events.length === 2);
    assert.equal(telemetryTrace().events.at(-1).checksumStatus, "invalid");
    assert.equal(telemetryStatus().vehicles[0].heartbeat.armed, false);
    assert.equal(telemetryStatus().vehicles[0].messageCount, 1);

    pauseTelemetryTrace();
    peer.send(mavlinkFrame({ payload: Buffer.from([0, 0, 0, 0, 2, 3, 0x80, 4, 3]) }), port, "127.0.0.1");
    await waitFor(() => telemetryStatus().vehicles[0].messageCount === 2);
    assert.equal(telemetryStatus().vehicles[0].heartbeat.armed, true);
    assert.equal(telemetryTrace().events.length, 2);
    resumeTelemetryTrace();

    const received = once(peer, "message");
    await sendMavlinkCommand({ sysid: 241, compid: 2, action: "custom", commandId: 511, params: [33, 100000] });
    const [outbound] = await received;
    assert.equal(outbound.readUInt16LE(outbound.length - 2), referenceCrc(Buffer.concat([outbound.subarray(1, -2), Buffer.from([152])])));
    assert.equal(telemetryTrace().events.at(-1).direction, "tx");
    assert.equal(telemetryTrace().events.at(-1).checksumStatus, "valid");
  } finally {
    await shutdownTelemetry();
    clearTelemetryTrace();
    resumeTelemetryTrace();
    await new Promise((resolve) => peer.close(resolve));
  }
});

async function bindPeer() {
  const peer = dgram.createSocket("udp4");
  peer.bind(0, "127.0.0.1");
  await once(peer, "listening");
  return peer;
}

async function freePort() {
  const probe = await bindPeer();
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function withTelemetryPeer(run) {
  await shutdownTelemetry();
  const peer = await bindPeer();
  const port = await freePort();
  const received = [];
  peer.on("message", (frame) => received.push(...parseMavlinkDatagram(frame)));
  try {
    await startTelemetryListener({ port });
    clearTelemetryTrace();
    resumeTelemetryTrace();
    peer.send(mavlinkFrame(), port, "127.0.0.1");
    await waitFor(() => telemetryStatus().vehicles.length === 1);
    await run({ peer, port, received, send: (frame) => peer.send(frame, port, "127.0.0.1") });
  } finally {
    await shutdownTelemetry();
    clearTelemetryTrace();
    resumeTelemetryTrace();
    await new Promise((resolve) => peer.close(resolve));
  }
}

test("listener transitions serialize and recover after a busy UDP port", async () => {
  await shutdownTelemetry();
  const busy = await bindPeer();
  const port = await freePort();
  try {
    await assert.rejects(startTelemetryListener({ port: busy.address().port }), (error) => error.statusCode === 409 && /already in use/.test(error.message));
    assert.equal(telemetryStatus().listener.active, false);
    await stopTelemetryListener();
    await Promise.all([
      startTelemetryListener({ port }),
      startTelemetryListener({ port }),
      stopTelemetryListener(),
      startTelemetryListener({ port, host: "localhost" })
    ]);
    assert.equal(telemetryStatus().listener.active, true);
    assert.equal(telemetryStatus().listener.port, port);
    for (const invalid of [0, 1023, 65536, 1234.5, NaN, {}, [14552], true, "1e4", "0x4000"]) {
      await assert.rejects(startTelemetryListener({ port: invalid }), (error) => error.statusCode === 400);
    }
    await assert.rejects(startTelemetryListener({ port, host: "::1" }), /IPv4/);
    assert.equal(telemetryStatus().listener.active, true);
    assert.equal(telemetryStatus().listener.port, port);
  } finally {
    await shutdownTelemetry();
    await new Promise((resolve) => busy.close(resolve));
  }
});

test("listener restart clears return links and status snapshots cannot mutate live vehicles", async () => {
  await withTelemetryPeer(async ({ port, send }) => {
    const snapshot = telemetryStatus();
    snapshot.vehicles[0].heartbeat.armed = true;
    snapshot.vehicles[0].link.port = 1;
    assert.equal(telemetryStatus().vehicles[0].heartbeat.armed, false);
    assert.notEqual(telemetryStatus().vehicles[0].link.port, 1);
    await stopTelemetryListener();
    await startTelemetryListener({ port });
    assert.equal(telemetryStatus().vehicles[0].link, undefined);
    await assert.rejects(sendMavlinkCommand({ sysid: 241, compid: 2, action: "custom", commandId: 511 }), (error) => error.statusCode === 409 && /new MAVLink packet/.test(error.message));
    send(mavlinkFrame());
    await waitFor(() => Boolean(telemetryStatus().vehicles[0].link));
    await assert.rejects(sendMavlinkCommand({ sysid: 241, compid: 3, action: "custom", commandId: 511 }), /component id 3/);
    await assert.rejects(sendMavlinkCommand({ sysid: 241, compid: 256, action: "custom", commandId: 511 }), /component id/);
    await assert.rejects(sendMavlinkCommand({ sysid: 241, compid: 2, action: "custom", commandId: 511, params: [1e100] }), /finite float/);
  });
});

test("decodes VFR_HUD according to MAVLink wire layout and retains unknown frames only in the trace", async () => {
  await withTelemetryPeer(async ({ send }) => {
    const payload = Buffer.alloc(20);
    payload.writeFloatLE(12.5, 0);
    payload.writeFloatLE(10.25, 4);
    payload.writeFloatLE(123.75, 8);
    payload.writeFloatLE(-2.5, 12);
    payload.writeInt16LE(278, 16);
    payload.writeUInt16LE(63, 18);
    send(mavlinkFrame({ messageId: 74, crcExtra: 20, payload }));
    await waitFor(() => Boolean(telemetryStatus().vehicles[0].vfrHud));
    assert.deepEqual(telemetryStatus().vehicles[0].vfrHud, {
      airspeedMps: 12.5, groundspeedMps: 10.25, altM: 123.75, climbMps: -2.5, headingDeg: 278, throttlePercent: 63
    });
    const before = telemetryStatus().listener.packetCount;
    send(mavlinkFrame({ sysid: 242, messageId: 0x123456 }));
    await waitFor(() => telemetryStatus().listener.packetCount > before);
    assert.equal(telemetryTrace().events.at(-1).checksumStatus, "unknown");
    assert.equal(telemetryStatus().vehicles.length, 1);
  });
});

test("invalid known message lengths cannot establish trusted MAVLink state", () => {
  assert.equal(parseMavlinkDatagram(mavlinkFrame({ version: 1, payload: Buffer.from([1]) }))[0].checksumStatus, "invalid");
  assert.equal(parseMavlinkDatagram(mavlinkFrame({ payload: Buffer.alloc(0) }))[0].checksumStatus, "invalid");
});

test("vehicle discovery history is bounded while recently active vehicles remain available", async () => {
  await withTelemetryPeer(async ({ send }) => {
    for (let batch = 0; batch < 6; batch += 1) {
      const before = telemetryStatus().listener.packetCount;
      const frames = Array.from({ length: 50 }, (_unused, index) => {
        const identity = batch * 50 + index;
        return mavlinkFrame({ sysid: identity % 250 + 1, compid: Math.floor(identity / 250) + 1 });
      });
      send(Buffer.concat(frames));
      await waitFor(() => telemetryStatus().listener.packetCount > before);
    }
    const current = telemetryStatus().vehicles;
    assert.equal(current.length, 256);
    assert.equal(current.some((vehicle) => vehicle.id === "1:1"), false);
    assert.equal(current.some((vehicle) => vehicle.id === "50:2"), true);
  });
});

test("named flight modes use the detected ArduPilot vehicle family", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    for (const [vehicleType, expectedGuidedMode] of [[2, 4], [29, 4], [1, 15], [10, 15]]) {
      send(mavlinkFrame({ payload: Buffer.from([0, 0, 0, 0, vehicleType, 3, 0, 4, 3]) }));
      await waitFor(() => telemetryStatus().vehicles[0].heartbeat.type === vehicleType);
      const previous = received.length;
      await sendMavlinkCommand({ sysid: 241, compid: 2, action: "mode", mode: "guided" });
      await waitFor(() => received.length > previous);
      assert.equal(received.at(-1).msgid, 76);
      assert.equal(received.at(-1).payload.readUInt16LE(28), 176);
      assert.equal(received.at(-1).payload.readFloatLE(4), expectedGuidedMode);
    }
    await assert.rejects(sendMavlinkCommand({ sysid: 241, compid: 2, action: "mode", mode: "alt-hold" }), /not supported/);
    send(mavlinkFrame({ payload: Buffer.from([0, 0, 0, 0, 2, 12, 0, 4, 3]) }));
    await waitFor(() => telemetryStatus().vehicles[0].heartbeat.autopilot === 12);
    await assert.rejects(sendMavlinkCommand({ sysid: 241, compid: 2, action: "mode", mode: "guided" }), /ArduPilot heartbeat/);
  });
});

function missionLine(overrides = {}) {
  const item = { seq: 0, current: 1, frame: 3, command: 16, p1: 0, p2: 0, p3: 0, p4: 0, x: 33.5, y: 73.25, z: 40, autocontinue: 1, ...overrides };
  return Object.values(item).join("\t");
}

test("mission input validation rejects partial missions and encodes frame coordinates accurately", () => {
  const [global] = missionItemsFromText(`QGC WPL 110\n${missionLine()}`);
  assert.equal(global.frame, 6);
  assert.equal(global.x, 335000000);
  assert.equal(global.y, 732500000);
  const [local] = missionItemsFromText(`QGC WPL 110\n${missionLine({ frame: 1, x: 5.25, y: -4.5 })}`);
  assert.equal(local.x, 52500);
  assert.equal(local.y, -45000);
  const [unscaled] = missionItemsFromText(`QGC WPL 110\n${missionLine({ frame: 2, x: 17, y: 42 })}`);
  assert.equal(unscaled.x, 17);
  assert.equal(unscaled.y, 42);
  for (const text of [
    `${missionLine()}\nmalformed line`,
    `${missionLine()}\n${missionLine()}`,
    missionLine({ seq: 1 }),
    missionLine({ seq: -1 }),
    missionLine({ command: 65536 }),
    missionLine({ frame: 256 }),
    missionLine({ x: 91 }),
    missionLine({ p1: 1e100 }),
    missionLine({ z: "NaN" }),
    missionLine({ autocontinue: 2 }),
    "x".repeat(2 * 1024 * 1024 + 1)
  ]) assert.throws(() => missionItemsFromText(`QGC WPL 110\n${text}`), /Mission|sequence/);
});

function missionCountFrame(count, overrides = {}) {
  const payload = Buffer.alloc(5);
  payload.writeUInt16LE(count, 0);
  payload[2] = overrides.targetSystem ?? 255;
  payload[3] = 190;
  payload[4] = overrides.missionType ?? 0;
  return mavlinkFrame({ messageId: 44, crcExtra: 221, payload });
}

function missionItemFrame(seq, fields = {}) {
  const payload = Buffer.alloc(38);
  payload.writeFloatLE(fields.p1 ?? 0, 0);
  payload.writeInt32LE(fields.x ?? 335000000 + seq, 16);
  payload.writeInt32LE(fields.y ?? 732500000, 20);
  payload.writeFloatLE(fields.z ?? 40, 24);
  payload.writeUInt16LE(seq, 28);
  payload.writeUInt16LE(16, 30);
  payload[32] = 255;
  payload[33] = 190;
  payload[34] = fields.frame ?? 6;
  payload[35] = fields.current ?? (seq === 0 ? 1 : 0);
  payload[36] = fields.autocontinue ?? 1;
  return mavlinkFrame({ messageId: 73, crcExtra: 38, payload });
}

function missionRequestFrame(seq) {
  const payload = Buffer.from([0, 0, 255, 190, 0]);
  payload.writeUInt16LE(seq, 0);
  return mavlinkFrame({ messageId: 51, crcExtra: 196, payload });
}

function missionAckFrame(result = 0) {
  return mavlinkFrame({ messageId: 47, crcExtra: 153, payload: Buffer.from([255, 190, result, 0]) });
}

test("zero-item mission download completes with ACK and concurrent transfers cannot overwrite it", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    await downloadMission({ sysid: 241, compid: 2 });
    await assert.rejects(downloadMission({ sysid: 241, compid: 2 }), (error) => error.statusCode === 409);
    send(missionCountFrame(0));
    await waitFor(() => !missionSyncStatus().active && received.some((packet) => packet.msgid === 47));
    assert.equal(missionSyncStatus().missionText, "QGC WPL 110\n");
    assert.equal(missionSyncStatus().downloadedCount, 0);
    assert.equal(received.some((packet) => packet.msgid === 51), false);
  });
});

test("mission download ignores other recipients and mission types, and re-requests out-of-order items", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    await downloadMission({ sysid: 241, compid: 2 });
    const packetCount = telemetryStatus().listener.packetCount;
    send(Buffer.concat([missionCountFrame(1, { targetSystem: 254 }), missionCountFrame(1, { missionType: 1 })]));
    await waitFor(() => telemetryStatus().listener.packetCount > packetCount);
    assert.equal(missionSyncStatus().expectedCount, 0);
    send(missionCountFrame(2));
    await waitFor(() => received.some((packet) => packet.msgid === 51));
    let requests = received.filter((packet) => packet.msgid === 51).length;
    send(missionItemFrame(1));
    await waitFor(() => received.filter((packet) => packet.msgid === 51).length > requests);
    assert.equal(received.at(-1).payload.readUInt16LE(0), 0);
    assert.equal(missionSyncStatus().downloadedCount, 0);
    requests = received.filter((packet) => packet.msgid === 51).length;
    send(missionItemFrame(0));
    await waitFor(() => received.filter((packet) => packet.msgid === 51).length > requests);
    assert.equal(received.at(-1).payload.readUInt16LE(0), 1);
    send(missionItemFrame(1));
    await waitFor(() => !missionSyncStatus().active);
    const rows = missionSyncStatus().missionText.trim().split("\n");
    assert.equal(rows.length, 3);
    assert.equal(rows[1].split("\t")[2], "3");
    assert.equal(missionSyncStatus().downloadedCount, 2);
  });
});

test("mission limits and listener stop terminate transfers without stale callbacks", async () => {
  await withTelemetryPeer(async ({ send }) => {
    await downloadMission({ sysid: 241, compid: 2 });
    send(missionCountFrame(65535));
    await waitFor(() => !missionSyncStatus().active);
    assert.match(missionSyncStatus().message, /5000-item transfer limit/);
    await downloadMission({ sysid: 241, compid: 2 });
    await stopTelemetryListener();
    assert.equal(missionSyncStatus().active, false);
    assert.match(missionSyncStatus().message, /cancelled/);
  });
});

test("upload ACK received beside a request cannot be undone by a pending send callback", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    await uploadMission({ sysid: 241, compid: 2, missionText: `QGC WPL 110\n${missionLine()}` });
    const request = mavlinkFrame({ messageId: 51, crcExtra: 196, payload: Buffer.from([0, 0, 255, 190, 0]) });
    const ack = mavlinkFrame({ messageId: 47, crcExtra: 153, payload: Buffer.from([255, 190, 0, 0]) });
    send(Buffer.concat([request, ack]));
    await waitFor(() => received.some((packet) => packet.msgid === 73));
    assert.equal(missionSyncStatus().active, false);
    assert.match(missionSyncStatus().message, /accepted/);
    assert.equal(received.find((packet) => packet.msgid === 73).payload[34], 6);
  });
});

test("upload ignores premature success ACKs until every mission item has been requested", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    const missionText = `QGC WPL 110\n${missionLine()}\n${missionLine({ seq: 1, current: 0 })}`;
    await uploadMission({ sysid: 241, compid: 2, missionText });
    let packets = telemetryStatus().listener.packetCount;
    send(missionAckFrame());
    await waitFor(() => telemetryStatus().listener.packetCount > packets);
    assert.equal(missionSyncStatus().active, true);
    assert.equal(missionSyncStatus().uploadedCount, 0);

    send(Buffer.concat([missionRequestFrame(0), missionAckFrame()]));
    await waitFor(() => received.some((packet) => packet.msgid === 73));
    assert.equal(missionSyncStatus().active, true);
    packets = telemetryStatus().listener.packetCount;
    send(Buffer.concat([missionRequestFrame(1), missionAckFrame()]));
    await waitFor(() => telemetryStatus().listener.packetCount > packets);
    assert.equal(missionSyncStatus().active, false);
    assert.equal(missionSyncStatus().uploadedCount, 2);
    assert.match(missionSyncStatus().message, /accepted/);
  });
});

test("a header-only mission uploads zero items and completes on the vehicle ACK", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    await uploadMission({ sysid: 241, compid: 2, missionText: "QGC WPL 110\n" });
    await waitFor(() => received.some((packet) => packet.msgid === 44));
    assert.equal(received.find((packet) => packet.msgid === 44).payload.readUInt16LE(0), 0);
    send(missionAckFrame());
    await waitFor(() => !missionSyncStatus().active);
    assert.match(missionSyncStatus().message, /accepted \(0 items\)/);
    assert.equal(received.some((packet) => packet.msgid === 73), false);
  });
});

test("invalid upload requests receive an error ACK and release the transfer", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    await uploadMission({ sysid: 241, compid: 2, missionText: `QGC WPL 110\n${missionLine()}` });
    send(missionRequestFrame(1));
    await waitFor(() => !missionSyncStatus().active && received.some((packet) => packet.msgid === 47));
    assert.equal(received.find((packet) => packet.msgid === 47).payload[2], 13);
    assert.match(missionSyncStatus().message, /invalid mission sequence 1/);
    await downloadMission({ sysid: 241, compid: 2 });
    assert.equal(missionSyncStatus().active, true);
  });
});

test("download exports preserve float precision and ACK retransmitted final items", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    await downloadMission({ sysid: 241, compid: 2 });
    send(missionCountFrame(1));
    await waitFor(() => received.some((packet) => packet.msgid === 51));
    const finalItem = missionItemFrame(0, { p1: 1e-10, z: 1e-8 });
    send(finalItem);
    await waitFor(() => !missionSyncStatus().active);
    const completed = missionSyncStatus();
    const [item] = missionItemsFromText(completed.missionText);
    assert.equal(item.params[0], Math.fround(1e-10));
    assert.equal(item.z, Math.fround(1e-8));

    await waitFor(() => received.some((packet) => packet.msgid === 47));
    const acknowledgements = received.filter((packet) => packet.msgid === 47).length;
    send(finalItem);
    await waitFor(() => received.filter((packet) => packet.msgid === 47).length > acknowledgements);
    assert.equal(received.at(-1).payload[2], 0);
    assert.deepEqual(missionSyncStatus(), completed);
  });
});

test("download rejects invalid item fields with an error ACK instead of exporting invalid routes", async () => {
  await withTelemetryPeer(async ({ send, received }) => {
    for (const fields of [{ z: NaN }, { frame: 255 }, { current: 2 }, { autocontinue: 2 }, { x: 910000000 }]) {
      await downloadMission({ sysid: 241, compid: 2 });
      const requests = received.filter((packet) => packet.msgid === 51).length;
      send(missionCountFrame(1));
      await waitFor(() => received.filter((packet) => packet.msgid === 51).length > requests);
      const acknowledgements = received.filter((packet) => packet.msgid === 47).length;
      send(missionItemFrame(0, fields));
      await waitFor(() => !missionSyncStatus().active && received.filter((packet) => packet.msgid === 47).length > acknowledgements);
      assert.equal(received.at(-1).payload[2], 5);
      assert.equal(missionSyncStatus().missionText, undefined);
    }
  });
});

test("lost mission responses retry a bounded number of times and return to idle", { timeout: 14000 }, async () => {
  await withTelemetryPeer(async ({ received }) => {
    await downloadMission({ sysid: 241, compid: 2 });
    await waitFor(() => !missionSyncStatus().active, 12000);
    assert.match(missionSyncStatus().message, /timed out after 5 retries/);
    assert.equal(received.filter((packet) => packet.msgid === 43).length, 6);
  });
});
