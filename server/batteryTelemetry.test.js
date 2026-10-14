import assert from "node:assert/strict";
import dgram from "node:dgram";
import { once } from "node:events";
import test from "node:test";
import { shutdownTelemetry, startTelemetryListener, telemetryStatus } from "./telemetry.js";

// Independent CRC-16/MCRF4XX reference for synthetic wire traffic.
function crc(bytes) {
  let value = 0xffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0x8408 : value >>> 1;
  }
  return value;
}

function frame(messageId, payload, version = 2) {
  const extra = messageId === 147 ? 154 : 124;
  const header = version === 1
    ? Buffer.from([0xfe, payload.length, 0, 241, 1, messageId])
    : Buffer.from([0xfd, payload.length, 0, 0, 0, 241, 1, messageId, 0, 0]);
  const checksum = Buffer.alloc(2);
  checksum.writeUInt16LE(crc(Buffer.concat([header.subarray(1), payload, Buffer.from([extra])])));
  return Buffer.concat([header, payload, checksum]);
}

function batteryPayload({ id = 0, remaining = 80, voltages = [4000, 4000, 4000, 4000], extensionVoltages = [], current = 1200,
  consumed = 500, temperature = 2500, chargeState = 1, faultBitmask = 0, timeRemaining = 600 } = {}) {
  const payload = Buffer.alloc(54);
  payload.writeInt32LE(consumed, 0);
  payload.writeInt32LE(-1, 4);
  payload.writeInt16LE(temperature, 8);
  for (let index = 0; index < 10; index += 1) payload.writeUInt16LE(voltages[index] ?? 65535, 10 + index * 2);
  payload.writeInt16LE(current, 30);
  payload[32] = id;
  payload[33] = 1;
  payload[34] = 1;
  payload.writeInt8(remaining, 35);
  payload.writeInt32LE(timeRemaining, 36);
  payload[40] = chargeState;
  for (let index = 0; index < 4; index += 1) payload.writeUInt16LE(extensionVoltages[index] ?? 0, 41 + index * 2);
  payload.writeUInt32LE(faultBitmask, 50);
  return payload;
}

function systemPayload({ voltage = 16000, current = 1200, remaining = 80 } = {}) {
  const payload = Buffer.alloc(31);
  payload.writeUInt16LE(voltage, 14);
  payload.writeInt16LE(current, 16);
  payload.writeInt8(remaining, 30);
  return payload;
}

async function bindPeer() {
  const peer = dgram.createSocket("udp4");
  peer.bind(0, "127.0.0.1");
  await once(peer, "listening");
  return peer;
}

async function withBatteryPeer(run) {
  await shutdownTelemetry();
  const peer = await bindPeer();
  const probe = await bindPeer();
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  try {
    await startTelemetryListener({ port });
    await run(async (messageId, payload, version) => {
      const previous = telemetryStatus().vehicles[0]?.messageCount ?? 0;
      await new Promise((resolve, reject) => peer.send(frame(messageId, payload, version), port, "127.0.0.1", (error) => error ? reject(error) : resolve()));
      const deadline = Date.now() + 3000;
      while ((telemetryStatus().vehicles[0]?.messageCount ?? 0) === previous) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for synthetic battery telemetry");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return telemetryStatus().vehicles[0];
    });
  } finally {
    await shutdownTelemetry();
    await new Promise((resolve) => peer.close(resolve));
  }
}

test("SYS_STATUS unknown and invalid battery values clear earlier low readings", async () => {
  await withBatteryPeer(async (send) => {
    const low = await send(1, systemPayload({ voltage: 11000, remaining: 4 }));
    assert.equal(low.battery.remainingPercent, 4);
    assert.equal(low.battery.source, "SYS_STATUS");
    assert.ok(Number.isFinite(Date.parse(low.battery.receivedAt)));
    const unknown = await send(1, systemPayload({ voltage: 65535, current: -1, remaining: -1 }));
    assert.equal(unknown.battery.voltageV, undefined);
    assert.equal(unknown.battery.currentA, undefined);
    assert.equal(unknown.battery.remainingPercent, undefined);
    assert.equal((await send(1, systemPayload({ remaining: 127 }))).battery.remainingPercent, undefined);
    assert.equal((await send(1, systemPayload({ remaining: 0 }))).battery.remainingPercent, 0);
  });
});

test("secondary batteries are retained by ID without replacing or refreshing the primary pack", async () => {
  await withBatteryPeer(async (send) => {
    const secondaryOnly = await send(147, batteryPayload({ id: 1, remaining: 3, voltages: [3000, 3000] }));
    assert.equal(secondaryOnly.battery, undefined);
    const primary = await send(147, batteryPayload());
    assert.equal(primary.battery.id, 0);
    assert.equal(primary.battery.voltageV, 16);
    const secondary = await send(147, batteryPayload({ id: 1, remaining: 2 }));
    assert.deepEqual(secondary.battery, primary.battery);
    assert.deepEqual(secondary.batteries.map((sample) => [sample.id, sample.remainingPercent]), [[0, 80], [1, 2]]);
    secondary.batteries[0].voltagesV[0] = 99;
    assert.equal(telemetryStatus().vehicles[0].batteries[0].voltagesV[0], 4);
  });
});

test("ambiguous SYS_STATUS cannot erase BATTERY_STATUS fault metadata or make a stale primary sample fresh", async () => {
  await withBatteryPeer(async (send) => {
    await send(1, systemPayload());
    const damaged = await send(147, batteryPayload({ chargeState: 6, faultBitmask: 4 }));
    const aggregate = await send(1, systemPayload({ voltage: 24000, remaining: 100 }));
    assert.deepEqual(aggregate.battery, damaged.battery);
    assert.equal(aggregate.battery.chargeState, 6);
    assert.equal(aggregate.battery.faultBitmask, 4);
  });
});

test("BATTERY_STATUS supports cells 11–14 and zero-truncated extension integers", async () => {
  await withBatteryPeer(async (send) => {
    const payload = batteryPayload({ voltages: Array(10).fill(4100), extensionVoltages: [4100, 4100, 4100, 4100], faultBitmask: 4, chargeState: 5 });
    const vehicle = await send(147, payload.subarray(0, 51));
    assert.equal(vehicle.battery.voltagesV.length, 14);
    assert.ok(Math.abs(vehicle.battery.voltageV - 57.4) < 1e-10);
    assert.equal(vehicle.battery.faultBitmask, 4);
    assert.equal(vehicle.battery.chargeState, 5);
    assert.equal(vehicle.battery.consumedMah, 500);
    assert.equal(vehicle.battery.temperatureC, 25);
    assert.equal(vehicle.battery.timeRemainingS, 600);
    const partialCell = batteryPayload({ extensionVoltages: [4000] });
    partialCell.writeUInt16LE(125, 41);
    const trimmed = await send(147, partialCell.subarray(0, 42));
    assert.equal(trimmed.battery.voltagesV.at(-1), 0.125);
  });
});

test("fresh unknown and replacement pack samples remove prior voltage, consumption and fault values", async () => {
  await withBatteryPeer(async (send) => {
    await send(147, batteryPayload({ remaining: 2, chargeState: 5, faultBitmask: 4 }));
    const unknown = await send(147, batteryPayload({ voltages: [], current: -1, consumed: -1, remaining: -1, temperature: 32767, timeRemaining: 0, chargeState: 0 }));
    for (const key of ["voltageV", "currentA", "remainingPercent", "consumedMah", "temperatureC", "timeRemainingS"]) assert.equal(unknown.battery[key], undefined, key);
    assert.equal(unknown.battery.faultBitmask, 0);
    assert.equal(unknown.battery.chargeState, 0);
    const replacement = await send(147, batteryPayload({ remaining: 100, consumed: 0 }));
    assert.equal(replacement.battery.remainingPercent, 100);
    assert.equal(replacement.battery.consumedMah, 0);
    assert.equal(replacement.battery.faultBitmask, 0);
    assert.equal(replacement.batteries.length, 1);
  });
});

test("MAVLink 1 battery samples do not invent extension faults, cells or charge state", async () => {
  await withBatteryPeer(async (send) => {
    const vehicle = await send(147, batteryPayload().subarray(0, 36), 1);
    assert.equal(vehicle.battery.voltageV, 16);
    assert.equal(vehicle.battery.chargeState, undefined);
    assert.equal(vehicle.battery.faultBitmask, undefined);
    assert.equal(vehicle.battery.timeRemainingS, undefined);
    assert.equal(vehicle.battery.voltagesV.length, 4);
  });
});
