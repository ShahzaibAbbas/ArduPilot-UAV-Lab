import dgram from "node:dgram";
import { isIPv4 } from "node:net";
import { GcsBridge } from "./gcsBridge.js";
import { mavlinkDefinitions } from "./mavlinkDefinitions.js";
import { TraceBuffer } from "./trace.js";
import { adviseTelemetryMessage } from "./telemetryAdvisor.js";
import { MAX_MISSION_ITEMS, missionCoordinateScale, parseMissionText } from "./missionFiles.js";

export class TelemetryError extends Error {
  constructor(message, statusCode = 400, options) {
    super(message, options);
    this.name = "TelemetryError";
    this.statusCode = statusCode;
  }
}

let socket;
let listenerTransition = Promise.resolve();
const MAX_VEHICLES = 256;
let listener = {
  active: false,
  host: "127.0.0.1",
  port: 14552,
  pid: process.pid,
  startedAt: undefined,
  lastPacketAt: undefined,
  packetCount: 0,
  byteCount: 0,
  error: undefined,
  errorCode: undefined,
  errorAt: undefined
};

const vehicles = new Map();
const traceBuffer = new TraceBuffer({
  maxCount: Number(process.env.MAVLINK_TRACE_MAX_COUNT || 1000),
  maxBytes: Number(process.env.MAVLINK_TRACE_MAX_BYTES || 1024 * 1024),
  rawPreviewBytes: Number(process.env.MAVLINK_TRACE_PREVIEW_BYTES || 96)
});
let mavlinkSequence = 0;
let uploadSession;
let downloadSession;
let completedDownloadSession;
let missionSync = {
  active: false,
  direction: undefined,
  message: "Mission sync idle",
  updatedAt: undefined,
  target: undefined,
  uploadedCount: 0,
  downloadedCount: 0,
  expectedCount: 0,
  missionText: undefined
};

const mavTypes = {
  0: "Generic",
  1: "Fixed wing",
  2: "Quadrotor",
  3: "Coaxial",
  4: "Helicopter",
  10: "Ground rover",
  13: "Hexarotor",
  14: "Octorotor",
  15: "Tricopter",
  19: "VTOL"
};

const systemStatuses = {
  0: "Uninitialized",
  1: "Boot",
  2: "Calibrating",
  3: "Standby",
  4: "Active",
  5: "Critical",
  6: "Emergency",
  7: "Poweroff",
  8: "Terminating"
};

const commandAckResults = {
  0: "Accepted",
  1: "Temporarily rejected",
  2: "Denied",
  3: "Unsupported",
  4: "Failed",
  5: "In progress",
  6: "Cancelled"
};

const missionAckResults = {
  0: "Accepted",
  1: "Error",
  2: "Unsupported frame",
  3: "Unsupported command",
  4: "No space",
  5: "Invalid mission",
  6: "Invalid parameter 1",
  7: "Invalid parameter 2",
  8: "Invalid parameter 3",
  9: "Invalid parameter 4",
  10: "Invalid parameter 5",
  11: "Invalid parameter 6",
  12: "Invalid parameter 7",
  13: "Invalid sequence",
  14: "Denied",
  15: "Operation cancelled"
};

const messageNames = {
  0: "HEARTBEAT",
  1: "SYS_STATUS",
  24: "GPS_RAW_INT",
  30: "ATTITUDE",
  33: "GLOBAL_POSITION_INT",
  40: "MISSION_REQUEST",
  43: "MISSION_REQUEST_LIST",
  44: "MISSION_COUNT",
  47: "MISSION_ACK",
  51: "MISSION_REQUEST_INT",
  73: "MISSION_ITEM_INT",
  74: "VFR_HUD",
  76: "COMMAND_LONG",
  77: "COMMAND_ACK",
  147: "BATTERY_STATUS",
  253: "STATUSTEXT"
};

const messageDefinitions = mavlinkDefinitions;

function traceCorrelation(packet, explicitCorrelation) {
  if (explicitCorrelation) {
    return explicitCorrelation;
  }
  if ([40, 43, 44, 47, 51, 73].includes(packet.msgid)) {
    return "mission";
  }
  if (packet.msgid === 76 || packet.msgid === 77) {
    return "command";
  }
  return undefined;
}

function packetSummary(packet) {
  const payload = packet.payload;
  if (packet.msgid === 0 && payload.length >= 9) {
    const type = payload.readUInt8(4);
    const status = payload.readUInt8(7);
    return `${payload.readUInt8(6) & 0x80 ? "armed" : "disarmed"} · ${mavTypes[type] ?? `type ${type}`} · ${
      systemStatuses[status] ?? `status ${status}`
    }`;
  }
  if (packet.msgid === 1 && payload.length >= 31) {
    const voltage = readUInt16(payload, 14);
    const current = readInt16(payload, 16);
    return `battery ${voltage === 65535 ? "n/a" : `${((voltage ?? 0) / 1000).toFixed(2)} V`} · current ${
      current === -1 ? "n/a" : `${((current ?? 0) / 100).toFixed(2)} A`
    }`;
  }
  if (packet.msgid === 24 && payload.length >= 30) {
    return `fix ${payload.readUInt8(28)} · satellites ${payload.readUInt8(29)}`;
  }
  if (packet.msgid === 30 && payload.length >= 16) {
    return `roll ${(((readFloat(payload, 4) ?? 0) * 180) / Math.PI).toFixed(1)}° · pitch ${(
      ((readFloat(payload, 8) ?? 0) * 180) /
      Math.PI
    ).toFixed(1)}°`;
  }
  if (packet.msgid === 44 && payload.length >= 2) {
    return `mission items ${payload.readUInt16LE(0)}`;
  }
  if (packet.msgid === 47 && payload.length >= 3) {
    return `mission ACK ${payload.readUInt8(2)}`;
  }
  if ((packet.msgid === 40 || packet.msgid === 51) && payload.length >= 2) {
    return `mission sequence ${payload.readUInt16LE(0)}`;
  }
  if (packet.msgid === 73 && payload.length >= 32) {
    return `mission item ${payload.readUInt16LE(28)} · command ${payload.readUInt16LE(30)}`;
  }
  if (packet.msgid === 76 && payload.length >= 30) {
    return `command ${payload.readUInt16LE(28)}`;
  }
  if (packet.msgid === 77 && payload.length >= 3) {
    const result = payload.readUInt8(2);
    return `command ${payload.readUInt16LE(0)} · ${commandAckResults[result] ?? `result ${result}`}`;
  }
  if (packet.msgid === 253) {
    const statusText = parseStatusText(payload);
    return statusText ? `severity ${statusText.severity} · ${statusText.text}` : "status text";
  }
  return `${payload.length} byte payload`;
}

function recordPacketTrace(direction, packet, { remote, local, datagramLength, correlation } = {}) {
  traceBuffer.add({
    direction,
    protocol: packet.version === 1 ? "MAVLink1" : "MAVLink2",
    remote,
    local,
    datagramLength,
    frameLength: packet.frameLength,
    sequence: packet.seq,
    systemId: packet.sysid,
    componentId: packet.compid,
    messageId: packet.msgid,
    messageName: messageNames[packet.msgid] ?? `MSG_${packet.msgid}`,
    payloadLength: packet.payloadLength,
    checksumStatus: packet.checksumStatus,
    signed: packet.signed,
    summary: packetSummary(packet),
    correlation: traceCorrelation(packet, correlation),
    rawFrame: packet.frame
  });
}

function recordOutboundTrace(frame, link, correlation, local = { host: listener.host, port: listener.port }) {
  for (const packet of parseMavlinkDatagram(frame)) {
    recordPacketTrace("tx", packet, {
      remote: link ? { host: link.host, port: link.port } : undefined,
      local,
      datagramLength: frame.length,
      correlation
    });
  }
}

const gcsBridge = new GcsBridge({
  parse: parseMavlinkDatagram,
  sendUdp: (frame, endpoint) => new Promise((resolve, reject) => {
    if (!socket || !listener.active) { reject(new TelemetryError("The telemetry listener stopped.", 409)); return; }
    socket.send(frame, endpoint.port, endpoint.host, (error) => error ? reject(error) : resolve());
  }),
  trace: (direction, packet, remote, local, correlation) => recordPacketTrace(direction, packet, {
    remote, local: local || { host: listener.host, port: listener.port }, datagramLength: packet.frameLength, correlation
  })
});

export function configureGcsBridge(options = {}) {
  return queueListenerTransition(async () => {
    if (!socket || !listener.active) throw new TelemetryError("Start the MAVLink telemetry reader before starting the GCS bridge.", 409);
    await gcsBridge.start(options, listener);
    return telemetryStatus();
  });
}

export function stopGcsBridge() {
  return queueListenerTransition(async () => {
    await gcsBridge.stop();
    invalidateVehicleLinks();
    return telemetryStatus();
  });
}

/**
 * SITL exited: drop the simulator return path and any transfer bound to it, but
 * keep the relay listening so connected ground stations survive a relaunch.
 */
export function detachGcsBridgeUpstream() {
  return queueListenerTransition(async () => {
    gcsBridge.detachUpstream();
    invalidateVehicleLinks();
    return telemetryStatus();
  });
}

function vehicleKey(sysid, compid) {
  return `${sysid}:${compid}`;
}

function vehicleFor(packet) {
  const key = vehicleKey(packet.sysid, packet.compid);
  if (!vehicles.has(key) && vehicles.size >= MAX_VEHICLES) {
    vehicles.delete(vehicles.keys().next().value);
  }
  const current =
    vehicles.get(key) ??
    {
      id: key,
      sysid: packet.sysid,
      compid: packet.compid,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: undefined,
      messageCount: 0,
      statusHistory: []
    };
  current.lastSeenAt = new Date().toISOString();
  current.messageCount += 1;
  vehicles.delete(key);
  vehicles.set(key, current);
  return current;
}

function setVehicleLink(vehicle, remote) {
  if (!remote?.address || !remote?.port) {
    return;
  }

  vehicle.link = {
    host: remote.address,
    port: remote.port,
    localPort: listener.port,
    lastPacketAt: new Date().toISOString()
  };
}

function readFloat(payload, offset) {
  return offset + 4 <= payload.length ? payload.readFloatLE(offset) : undefined;
}

function readInt16(payload, offset) {
  return offset + 2 <= payload.length ? payload.readInt16LE(offset) : undefined;
}

function readUInt16(payload, offset) {
  return offset + 2 <= payload.length ? payload.readUInt16LE(offset) : undefined;
}

function readInt32(payload, offset) {
  return offset + 4 <= payload.length ? payload.readInt32LE(offset) : undefined;
}

function readUInt32(payload, offset) {
  return offset + 4 <= payload.length ? payload.readUInt32LE(offset) : undefined;
}

function degreesFromScaled(value) {
  return typeof value === "number" ? value / 10000000 : undefined;
}

function metersFromMm(value) {
  return typeof value === "number" ? value / 1000 : undefined;
}

function parseStatusText(payload) {
  if (payload.length < 2) {
    return undefined;
  }
  const severity = payload.readUInt8(0);
  const text = payload.subarray(1, 51).toString("utf8").replace(/\0+$/g, "").trim();
  return text ? { severity, text } : undefined;
}

function batteryRemaining(value) {
  return value >= 0 && value <= 100 ? value : undefined;
}

function parseBatteryStatus(packet) {
  // MAVLink 2 trims trailing zero bytes even inside extension integers.
  // Decode the complete extension layout without carrying forward old values.
  const payload = Buffer.alloc(54);
  packet.payload.copy(payload, 0, 0, 54);
  const voltagesV = [];
  for (let offset = 10; offset < 30; offset += 2) {
    const voltage = payload.readUInt16LE(offset);
    if (voltage !== 65535) voltagesV.push(voltage / 1000);
  }
  if (packet.version === 2) {
    for (let offset = 41; offset < 49; offset += 2) {
      const voltage = payload.readUInt16LE(offset);
      // Extension cell slots use zero for unsupported, unlike base slots.
      if (voltage !== 0 && voltage !== 65535) voltagesV.push(voltage / 1000);
    }
  }
  const current = payload.readInt16LE(30);
  const consumed = payload.readInt32LE(0);
  const temperature = payload.readInt16LE(8);
  const timeRemaining = packet.version === 2 ? payload.readInt32LE(36) : 0;
  return {
    id: payload.readUInt8(32),
    source: "BATTERY_STATUS",
    receivedAt: new Date().toISOString(),
    voltageV: voltagesV.length ? voltagesV.reduce((sum, voltage) => sum + voltage, 0) : undefined,
    voltagesV,
    currentA: current !== -1 ? current / 100 : undefined,
    remainingPercent: batteryRemaining(payload.readInt8(35)),
    consumedMah: consumed >= 0 ? consumed : undefined,
    temperatureC: temperature !== 32767 ? temperature / 100 : undefined,
    timeRemainingS: timeRemaining > 0 ? timeRemaining : undefined,
    chargeState: packet.version === 2 ? payload.readUInt8(40) : undefined,
    faultBitmask: packet.version === 2 ? payload.readUInt32LE(50) : undefined
  };
}

function updateVehicle(packet, remote) {
  const vehicle = vehicleFor(packet);
  const payload = packet.payload;
  setVehicleLink(vehicle, remote);

  if (packet.msgid === 0 && payload.length >= 9) {
    const type = payload.readUInt8(4);
    const systemStatus = payload.readUInt8(7);
    vehicle.heartbeat = {
      customMode: readUInt32(payload, 0),
      type,
      typeName: mavTypes[type] ?? `Type ${type}`,
      autopilot: payload.readUInt8(5),
      baseMode: payload.readUInt8(6),
      armed: Boolean(payload.readUInt8(6) & 0x80),
      systemStatus,
      systemStatusName: systemStatuses[systemStatus] ?? `Status ${systemStatus}`
    };
  }

  if (packet.msgid === 1 && payload.length >= 31) {
    const voltage = readUInt16(payload, 14);
    const current = readInt16(payload, 16);
    const battery = {
      source: "SYS_STATUS",
      receivedAt: new Date().toISOString(),
      voltageV: typeof voltage === "number" && voltage !== 65535 ? voltage / 1000 : undefined,
      currentA: typeof current === "number" && current !== -1 ? current / 100 : undefined,
      remainingPercent: batteryRemaining(payload.readInt8(30))
    };
    // SYS_STATUS is ambiguous on multi-pack systems. Once battery ID 0 has
    // reported, only that pack can update (or refresh) the primary reading.
    if (!vehicle.batteries?.some((sample) => sample.id === 0)) vehicle.battery = battery;
  }

  if (packet.msgid === 24 && payload.length >= 30) {
    const groundSpeed = readUInt16(payload, 24);
    const satellites = payload.readUInt8(29);
    vehicle.gps = {
      lat: degreesFromScaled(readInt32(payload, 8)),
      lon: degreesFromScaled(readInt32(payload, 12)),
      altM: metersFromMm(readInt32(payload, 16)),
      // MAVLink uses UINT16_MAX and UINT8_MAX for unknown speed and satellite count.
      groundSpeedMps: groundSpeed === undefined || groundSpeed === 65535 ? undefined : groundSpeed / 100,
      fixType: payload.readUInt8(28),
      satellites: satellites === 255 ? undefined : satellites
    };
  }

  if (packet.msgid === 30 && payload.length >= 28) {
    vehicle.attitude = {
      rollDeg: ((readFloat(payload, 4) ?? 0) * 180) / Math.PI,
      pitchDeg: ((readFloat(payload, 8) ?? 0) * 180) / Math.PI,
      yawDeg: ((readFloat(payload, 12) ?? 0) * 180) / Math.PI
    };
  }

  if (packet.msgid === 33 && payload.length >= 28) {
    const heading = readUInt16(payload, 26);
    vehicle.position = {
      lat: degreesFromScaled(readInt32(payload, 4)),
      lon: degreesFromScaled(readInt32(payload, 8)),
      altM: metersFromMm(readInt32(payload, 12)),
      relativeAltM: metersFromMm(readInt32(payload, 16)),
      vxMps: (readInt16(payload, 20) ?? 0) / 100,
      vyMps: (readInt16(payload, 22) ?? 0) / 100,
      vzMps: (readInt16(payload, 24) ?? 0) / 100,
      // UINT16_MAX means the vehicle does not know its heading.
      headingDeg: heading === undefined || heading === 65535 ? undefined : heading / 100
    };
  }

  if (packet.msgid === 74 && payload.length >= 20) {
    vehicle.vfrHud = {
      airspeedMps: readFloat(payload, 0),
      groundspeedMps: readFloat(payload, 4),
      headingDeg: readInt16(payload, 16),
      throttlePercent: readUInt16(payload, 18),
      altM: readFloat(payload, 8),
      climbMps: readFloat(payload, 12)
    };
  }

  if (packet.msgid === 77 && payload.length >= 3) {
    const result = payload.readUInt8(2);
    vehicle.commandAck = {
      command: readUInt16(payload, 0),
      result,
      resultName: commandAckResults[result] ?? `Result ${result}`,
      progress: payload.length >= 4 ? payload.readUInt8(3) : undefined,
      receivedAt: new Date().toISOString()
    };
  }

  if (packet.msgid === 147 && payload.length >= 36) {
    const battery = parseBatteryStatus(packet);
    vehicle.batteries = [...(vehicle.batteries ?? []).filter((sample) => sample.id !== battery.id), battery]
      .sort((left, right) => left.id - right.id);
    if (battery.id === 0) vehicle.battery = battery;
  }

  if (packet.msgid === 253) {
    const statusText = parseStatusText(payload);
    if (statusText) {
      const receivedAt = new Date().toISOString();
      const advice = adviseTelemetryMessage({ ...statusText, battery: vehicle.battery });
      vehicle.statusText = { ...statusText, receivedAt, advice };
      vehicle.statusHistory = [
        ...(vehicle.statusHistory ?? []),
        { ...statusText, receivedAt, advice }
      ].slice(-20);
    }
  }
}

export function parseMavlinkDatagram(buffer) {
  const packets = [];
  if (!Buffer.isBuffer(buffer)) return packets;
  let offset = 0;

  while (offset < buffer.length) {
    const magic = buffer.readUInt8(offset);
    if (magic !== 0xfe && magic !== 0xfd) {
      offset += 1;
      continue;
    }

    const version = magic === 0xfe ? 1 : 2;
    const headerLength = version === 1 ? 6 : 10;
    if (offset + headerLength + 2 > buffer.length) {
      offset += 1;
      continue;
    }
    const payloadLength = buffer.readUInt8(offset + 1);
    const incompatFlags = version === 2 ? buffer.readUInt8(offset + 2) : 0;
    const signed = Boolean(incompatFlags & 0x01);
    const frameLength = headerLength + payloadLength + 2 + (signed ? 13 : 0);
    if (offset + frameLength > buffer.length) {
      // A stray magic byte in a damaged datagram must not hide a later complete frame.
      offset += 1;
      continue;
    }
    if (incompatFlags & ~0x01) {
      offset += frameLength;
      continue;
    }
    const msgid = version === 1 ? buffer.readUInt8(offset + 5) : buffer.readUIntLE(offset + 7, 3);
    const payloadEnd = offset + headerLength + payloadLength;
    const definition = messageDefinitions[msgid];
    const validPayloadLength = !definition || (version === 1 ? payloadLength === definition[1] : payloadLength > 0 && payloadLength <= definition[2]);
    const checksumStatus = definition
      ? (validPayloadLength && x25Crc(buffer.subarray(offset + 1, payloadEnd), definition[0]) === buffer.readUInt16LE(payloadEnd) ? "valid" : "invalid")
      : "unknown";
    let payload = buffer.subarray(offset + headerLength, payloadEnd);
    // MAVLink 2 omits trailing zero bytes, including bytes within a multi-byte field.
    // Keep the actual wire length and frame alongside the zero-filled decoded payload.
    if (version === 2 && definition && payloadLength > 0 && payloadLength < definition[1]) {
      const decoded = Buffer.alloc(definition[1]);
      payload.copy(decoded);
      payload = decoded;
    }
    packets.push({
      version,
      seq: buffer.readUInt8(offset + (version === 1 ? 2 : 4)),
      sysid: buffer.readUInt8(offset + (version === 1 ? 3 : 5)),
      compid: buffer.readUInt8(offset + (version === 1 ? 4 : 6)),
      msgid,
      payloadLength,
      frameLength,
      checksumStatus,
      signed,
      payload,
      frame: buffer.subarray(offset, offset + frameLength)
    });
    offset += frameLength;
  }

  return packets;
}

function onMessage(message, remote) {
  listener.packetCount += 1;
  listener.byteCount += message.length;
  listener.lastPacketAt = new Date().toISOString();
  listener.error = undefined;

  const packets = parseMavlinkDatagram(message);
  for (const packet of packets) {
    recordPacketTrace("rx", packet, {
      remote: { host: remote.address, port: remote.port },
      local: { host: listener.host, port: listener.port },
      datagramLength: message.length
    });
    if (gcsBridge.receive(packet, remote)) continue;
    // A ground station heartbeat must never establish a vehicle command link.
    if (packet.checksumStatus !== "valid" || packet.sysid === 0 || (packet.msgid === 0 && packet.payload[4] === 6)) continue;
    updateVehicle(packet, remote);
    handleMissionPacket(packet, remote);
  }
}

function crcAccumulate(byte, crc) {
  let value = byte ^ (crc & 0xff);
  value = (value ^ (value << 4)) & 0xff;
  return (((crc >> 8) ^ (value << 8) ^ (value << 3) ^ (value >> 4)) & 0xffff) >>> 0;
}

function x25Crc(buffer, extra) {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc = crcAccumulate(byte, crc);
  }
  return crcAccumulate(extra, crc);
}

function encodeMavlink2Message({ msgid, payload, crcExtra, sourceSystem = 255, sourceComponent = 190 }) {
  const header = Buffer.from([
    0xfd,
    payload.length,
    0,
    0,
    mavlinkSequence,
    sourceSystem,
    sourceComponent,
    msgid & 0xff,
    (msgid >> 8) & 0xff,
    (msgid >> 16) & 0xff
  ]);
  mavlinkSequence = (mavlinkSequence + 1) & 0xff;

  const checksum = x25Crc(Buffer.concat([header.subarray(1), payload]), crcExtra);
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE(checksum);
  return Buffer.concat([header, payload, crc]);
}

function encodeCommandLong({
  sourceSystem = 255,
  sourceComponent = 190,
  targetSystem,
  targetComponent,
  command,
  confirmation = 0,
  params = []
}) {
  const payload = Buffer.alloc(33);
  for (let index = 0; index < 7; index += 1) {
    const value = Number(params[index]);
    payload.writeFloatLE(Number.isFinite(value) ? value : 0, index * 4);
  }
  payload.writeUInt16LE(command, 28);
  payload.writeUInt8(targetSystem, 30);
  payload.writeUInt8(targetComponent, 31);
  payload.writeUInt8(confirmation, 32);

  return encodeMavlink2Message({ msgid: 76, payload, crcExtra: 152, sourceSystem, sourceComponent });
}

export function missionItemsFromText(text) {
  try {
    return parseMissionText(text);
  } catch (error) {
    throw new TelemetryError(error.message);
  }
}

function missionTextFromItems(items) {
  const lines = ["QGC WPL 110"];
  for (const item of items.sort((left, right) => left.seq - right.seq)) {
    const scale = missionCoordinateScale(item.frame);
    const lat = item.x / scale;
    const lon = item.y / scale;
    lines.push(
      [
        item.seq,
        item.current,
        ({ 5: 0, 6: 3, 11: 10 })[item.frame] ?? item.frame,
        item.command,
        ...item.params.map((value) => String(value)),
        lat.toFixed(7),
        lon.toFixed(7),
        String(item.z),
        item.autocontinue
      ].join("\t")
    );
  }
  return `${lines.join("\n")}\n`;
}

function encodeMissionCount(targetSystem, targetComponent, count) {
  const payload = Buffer.alloc(5);
  payload.writeUInt16LE(count, 0);
  payload.writeUInt8(targetSystem, 2);
  payload.writeUInt8(targetComponent, 3);
  payload.writeUInt8(0, 4);
  return encodeMavlink2Message({ msgid: 44, payload, crcExtra: 221 });
}

function encodeMissionRequestList(targetSystem, targetComponent) {
  const payload = Buffer.alloc(3);
  payload.writeUInt8(targetSystem, 0);
  payload.writeUInt8(targetComponent, 1);
  payload.writeUInt8(0, 2);
  return encodeMavlink2Message({ msgid: 43, payload, crcExtra: 132 });
}

function encodeMissionRequestInt(targetSystem, targetComponent, seq) {
  const payload = Buffer.alloc(5);
  payload.writeUInt16LE(seq, 0);
  payload.writeUInt8(targetSystem, 2);
  payload.writeUInt8(targetComponent, 3);
  payload.writeUInt8(0, 4);
  return encodeMavlink2Message({ msgid: 51, payload, crcExtra: 196 });
}

function encodeMissionAck(targetSystem, targetComponent, type = 0) {
  const payload = Buffer.alloc(4);
  payload.writeUInt8(targetSystem, 0);
  payload.writeUInt8(targetComponent, 1);
  payload.writeUInt8(type, 2);
  payload.writeUInt8(0, 3);
  return encodeMavlink2Message({ msgid: 47, payload, crcExtra: 153 });
}

function encodeMissionItemInt(targetSystem, targetComponent, item) {
  const payload = Buffer.alloc(38);
  for (let index = 0; index < 4; index += 1) {
    payload.writeFloatLE(Number(item.params[index] || 0), index * 4);
  }
  payload.writeInt32LE(Number(item.x || 0), 16);
  payload.writeInt32LE(Number(item.y || 0), 20);
  payload.writeFloatLE(Number(item.z || 0), 24);
  payload.writeUInt16LE(item.seq, 28);
  payload.writeUInt16LE(item.command, 30);
  payload.writeUInt8(targetSystem, 32);
  payload.writeUInt8(targetComponent, 33);
  payload.writeUInt8(item.frame, 34);
  payload.writeUInt8(item.current ? 1 : 0, 35);
  payload.writeUInt8(item.autocontinue ? 1 : 0, 36);
  payload.writeUInt8(0, 37);
  return encodeMavlink2Message({ msgid: 73, payload, crcExtra: 38 });
}

function parseMissionRequestSeq(packet) {
  if ((packet.msgid !== 40 && packet.msgid !== 51) || packet.payload.length < 4) {
    return undefined;
  }
  return packet.payload.readUInt16LE(0);
}

function parseMissionCount(packet) {
  if (packet.msgid !== 44 || packet.payload.length < 2) {
    return undefined;
  }
  return packet.payload.readUInt16LE(0);
}

function parseMissionAck(packet) {
  if (packet.msgid !== 47 || packet.payload.length < 3) {
    return undefined;
  }
  return packet.payload.readUInt8(2);
}

function parseMissionItemInt(packet) {
  if (packet.msgid !== 73 || packet.payload.length < 37) {
    return undefined;
  }
  return {
    params: [0, 4, 8, 12].map((offset) => packet.payload.readFloatLE(offset)),
    x: packet.payload.readInt32LE(16),
    y: packet.payload.readInt32LE(20),
    z: packet.payload.readFloatLE(24),
    seq: packet.payload.readUInt16LE(28),
    command: packet.payload.readUInt16LE(30),
    frame: packet.payload.readUInt8(34),
    current: packet.payload.readUInt8(35),
    autocontinue: packet.payload.readUInt8(36)
  };
}

async function sendToVehicle(vehicle, packet, correlation) {
  if (!socket || !listener.active) {
    throw new TelemetryError("Start the MAVLink telemetry reader before mission sync.", 409);
  }
  if (!vehicle.link) {
    throw new TelemetryError(`No UDP return address is known for SYS ${vehicle.sysid}.`, 409);
  }
  const sending = socket;
  const link = { ...vehicle.link };
  const local = { host: listener.host, port: listener.port };
  await new Promise((resolve, reject) => {
    sending.send(packet, link.port, link.host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  recordOutboundTrace(packet, link, correlation, local);
}

function missionTargetMatches(session, packet, remote) {
  if (!session || session.finishing || packet.sysid !== session.sysid || packet.compid !== session.compid
    || remote.address !== session.vehicle.link.host || remote.port !== session.vehicle.link.port) return false;
  const offsets = ({ 40: [2, 3, 4], 44: [2, 3, 4], 47: [0, 1, 3], 51: [2, 3, 4], 73: [32, 33, 37] })[packet.msgid];
  if (!offsets) return false;
  const [systemOffset, componentOffset, typeOffset] = offsets;
  return [0, 255].includes(packet.payload[systemOffset])
    && [0, 190].includes(packet.payload[componentOffset])
    && (packet.payload[typeOffset] ?? 0) === 0;
}

function setMissionSync(next) {
  missionSync = {
    ...missionSync,
    ...next,
    updatedAt: new Date().toISOString()
  };
}

function isCurrentMissionSession(session) {
  return session && (uploadSession === session || downloadSession === session);
}

function clearMissionSession(session) {
  if (!session) return;
  clearTimeout(session.retryTimer);
  if (uploadSession === session) uploadSession = undefined;
  if (downloadSession === session) downloadSession = undefined;
}

function failMissionSession(session, message) {
  if (!isCurrentMissionSession(session)) return;
  clearMissionSession(session);
  setMissionSync({ active: false, message });
}

function rejectMissionSession(session, message, result) {
  if (!isCurrentMissionSession(session)) return;
  const ack = encodeMissionAck(session.sysid, session.compid, result);
  failMissionSession(session, message);
  void sendToVehicle(session.vehicle, ack, `mission-${session.direction}`).catch(() => undefined);
}

async function sendMissionPacket(session, packet, retry = false) {
  if (!isCurrentMissionSession(session)) return;
  clearTimeout(session.retryTimer);
  session.lastPacket = packet;
  if (!retry) session.retryCount = 0;
  try {
    await sendToVehicle(session.vehicle, packet, `mission-${session.direction}`);
  } catch (error) {
    failMissionSession(session, error.message);
    throw error;
  }
  if (!isCurrentMissionSession(session) || session.lastPacket !== packet) return;
  session.retryTimer = setTimeout(() => {
    if (!isCurrentMissionSession(session)) return;
    if (session.retryCount >= 5) {
      failMissionSession(session, "Mission sync timed out after 5 retries. Check the UDP connection and try again.");
      return;
    }
    session.retryCount += 1;
    void sendMissionPacket(session, packet, true).catch(() => undefined);
  }, 1500);
  session.retryTimer.unref();
}

function completeMissionDownload(session) {
  session.finishing = true;
  clearTimeout(session.retryTimer);
  const ack = encodeMissionAck(session.sysid, session.compid, 0);
  void sendToVehicle(session.vehicle, ack, "mission-download").then(() => {
    if (!isCurrentMissionSession(session)) return;
    clearMissionSession(session);
    // A lost final ACK makes the vehicle resend its last response. Keep one bounded
    // completion record long enough to ACK those retransmissions without reopening sync.
    completedDownloadSession = {
      sysid: session.sysid,
      compid: session.compid,
      vehicle: session.vehicle,
      expectedCount: session.expectedCount,
      completedAt: Date.now(),
      completionAck: ack
    };
    setMissionSync({
      active: false,
      direction: "download",
      message: `Mission download complete (${session.items.length} items).`,
      downloadedCount: session.items.length,
      expectedCount: session.expectedCount,
      missionText: missionTextFromItems(session.items)
    });
  }).catch((error) => failMissionSession(session, error.message));
}

function handleMissionPacket(packet, remote) {
  if (missionTargetMatches(uploadSession, packet, remote)) {
    const session = uploadSession;
    const requestedSeq = parseMissionRequestSeq(packet);
    if (typeof requestedSeq === "number") {
      const item = session.items[requestedSeq];
      if (!item) {
        rejectMissionSession(session, `Vehicle requested invalid mission sequence ${requestedSeq}.`, 13);
      } else {
        const payload = encodeMissionItemInt(session.sysid, session.compid, item);
        // Register the response before the asynchronous UDP callback. The ACK may
        // arrive in the same datagram as the request for the final mission item.
        session.requestedItems.add(requestedSeq);
        void sendMissionPacket(session, payload)
          .then(() => {
            if (!isCurrentMissionSession(session)) return;
            session.sentItems.add(requestedSeq);
            setMissionSync({
              active: true,
              direction: "upload",
              message: `Sent mission item ${requestedSeq + 1}/${session.items.length}`,
              uploadedCount: session.sentItems.size,
              expectedCount: session.items.length
            });
          })
          .catch(() => undefined);
      }
      return;
    }

    const ack = parseMissionAck(packet);
    if (typeof ack === "number") {
      const ok = ack === 0;
      // A delayed ACK from an earlier transfer cannot accept an incomplete upload.
      if (ok && session.requestedItems.size !== session.items.length) return;
      setMissionSync({
        active: false,
        direction: "upload",
        message: ok ? `Mission upload accepted (${session.items.length} items).` : `Mission upload returned ACK ${ack} (${missionAckResults[ack] ?? "Unknown result"}).`,
        uploadedCount: ok ? session.items.length : missionSync.uploadedCount,
        expectedCount: session.items.length
      });
      clearMissionSession(session);
    }
  }

  if (missionTargetMatches(downloadSession, packet, remote)) {
    const session = downloadSession;
    const ack = parseMissionAck(packet);
    if (typeof ack === "number") {
      failMissionSession(session, `Mission download returned ACK ${ack} (${missionAckResults[ack] ?? "Unknown result"}) before completing.`);
      return;
    }
    const count = parseMissionCount(packet);
    if (typeof count === "number") {
      if (count > MAX_MISSION_ITEMS) {
        rejectMissionSession(session, `Vehicle mission exceeds the ${MAX_MISSION_ITEMS}-item transfer limit.`, 4);
        return;
      }
      // Repeated counts are retransmissions, not a request to discard downloaded items.
      if (session.expectedCount !== undefined && session.expectedCount !== count) {
        rejectMissionSession(session, "Vehicle mission changed during download. Start the download again.", 1);
        return;
      }
      session.expectedCount = count;
      setMissionSync({
        active: true,
        direction: "download",
        message: `Vehicle reports ${count} mission items.`,
        expectedCount: count,
        downloadedCount: session.items.length
      });
      if (count === 0) completeMissionDownload(session);
      else {
        const request = encodeMissionRequestInt(session.sysid, session.compid, session.items.length);
        void sendMissionPacket(session, request).catch(() => undefined);
      }
      return;
    }

    const item = parseMissionItemInt(packet);
    if (item && session.expectedCount !== undefined) {
      const scale = missionCoordinateScale(item.frame);
      if (![item.z, ...item.params].every(Number.isFinite)
        || item.frame > 21 || ![0, 1].includes(item.current) || ![0, 1].includes(item.autocontinue)
        || (scale === 10000000 && (Math.abs(item.x) > 900000000 || Math.abs(item.y) > 1800000000))) {
        rejectMissionSession(session, "Vehicle sent a mission item with invalid or out-of-range fields.", 5);
        return;
      }
      // Only accept the requested sequence; out-of-order items re-request the missing one.
      if (item.seq === session.items.length && item.seq < session.expectedCount) session.items.push(item);
      const downloaded = session.items.length;
      if (downloaded === session.expectedCount) {
        completeMissionDownload(session);
      } else {
        const request = encodeMissionRequestInt(session.sysid, session.compid, downloaded);
        void sendMissionPacket(session, request).catch(() => undefined);
        setMissionSync({
          active: true,
          direction: "download",
          message: `Received mission item ${downloaded}/${session.expectedCount}`,
          downloadedCount: downloaded
        });
      }
    }
  }

  const completed = completedDownloadSession;
  if (completed && Date.now() - completed.completedAt > 10000) completedDownloadSession = undefined;
  else if (missionTargetMatches(completed, packet, remote)
    && ((packet.msgid === 73 && parseMissionItemInt(packet)?.seq === completed.expectedCount - 1)
      || (completed.expectedCount === 0 && parseMissionCount(packet) === 0))) {
    void sendToVehicle(completed.vehicle, completed.completionAck, "mission-download").catch(() => undefined);
  }
}

const ardupilotModes = {
  stabilize: 0,
  acro: 1,
  "alt-hold": 2,
  alt_hold: 2,
  auto: 3,
  guided: 4,
  loiter: 5,
  rtl: 6,
  circle: 7,
  land: 9,
  drift: 11,
  sport: 13,
  poshold: 16,
  brake: 17,
  throw: 18,
  avoid_adsb: 19,
  guided_nogps: 20,
  smart_rtl: 21
};

const planeModes = {
  manual: 0, circle: 1, stabilize: 2, training: 3, acro: 4, fbwa: 5, fbwb: 6,
  cruise: 7, autotune: 8, auto: 10, rtl: 11, loiter: 12, takeoff: 13,
  avoid_adsb: 14, guided: 15, qstabilize: 17, qhover: 18, qloiter: 19,
  qland: 20, qrtl: 21, qautotune: 22, qacro: 23, thermal: 24, autoland: 26
};
const roverModes = {
  manual: 0, acro: 1, steering: 3, hold: 4, loiter: 5, follow: 6,
  simple: 7, dock: 8, circle: 9, auto: 10, rtl: 11, smart_rtl: 12, guided: 15
};

function modesForVehicle(vehicle) {
  const heartbeat = vehicle.heartbeat;
  if (!heartbeat || heartbeat.autopilot !== 3) {
    throw new TelemetryError("Wait for an ArduPilot heartbeat before choosing a named flight mode.", 409);
  }
  if ([1, 19, 20, 21, 22, 23, 24, 28].includes(heartbeat.type)) return planeModes;
  if ([10, 11].includes(heartbeat.type)) return roverModes;
  if ([2, 3, 4, 13, 14, 15, 29, 35, 43].includes(heartbeat.type)) return ardupilotModes;
  throw new TelemetryError("Named flight modes are supported for ArduPilot Copter, Plane, and Rover vehicles.");
}

function numericParamList(params = []) {
  if (!Array.isArray(params) || params.length > 7 || params.some((value) => typeof value !== "number" || !Number.isFinite(Math.fround(value)))) {
    throw new TelemetryError("MAVLink command parameters must be at most 7 finite float values.");
  }
  return Array.from({ length: 7 }, (_entry, index) => {
    const value = Number(params[index] ?? 0);
    return Number.isFinite(value) ? value : 0;
  });
}

function commandFromRequest(request, vehicle) {
  const action = String(request.action || "").toLowerCase();

  if (action === "custom") {
    const command = Number(request.commandId);
    if (!Number.isInteger(command) || command < 0 || command > 65535) {
      throw new TelemetryError("Custom MAVLink command id must be between 0 and 65535.");
    }
    return {
      label: `MAV_CMD ${command}`,
      command,
      params: numericParamList(request.params)
    };
  }

  if (action === "mode") {
    const modeKey = String(request.mode || "guided").trim().toLowerCase();
    const mode = modesForVehicle(vehicle)[modeKey];
    if (typeof mode !== "number") {
      throw new TelemetryError(`Mode ${modeKey} is not supported for this ${vehicle.heartbeat.typeName} vehicle.`);
    }
    return {
      label: `Set mode ${modeKey.toUpperCase().replaceAll("_", "-")}`,
      command: 176,
      params: [1, mode, 0, 0, 0, 0, 0]
    };
  }

  if (action === "arm") {
    return { label: "Arm", command: 400, params: [1, 0, 0, 0, 0, 0, 0] };
  }
  if (action === "disarm") {
    return { label: "Disarm", command: 400, params: [0, 0, 0, 0, 0, 0, 0] };
  }
  if (action === "takeoff") {
    const altitude = Number(request.altitudeM ?? 20);
    if (!Number.isFinite(altitude) || altitude < 0 || altitude > 10000) throw new TelemetryError("Takeoff altitude must be between 0 and 10000 metres.");
    return { label: `Takeoff ${altitude} m`, command: 22, params: [0, 0, 0, 0, 0, 0, altitude] };
  }
  if (action === "land") {
    return { label: "Land", command: 21, params: [0, 0, 0, 0, 0, 0, 0] };
  }
  if (action === "rtl") {
    return { label: "Return to launch", command: 20, params: [0, 0, 0, 0, 0, 0, 0] };
  }

  throw new TelemetryError("Choose a supported MAVLink action.");
}

function findVehicle(sysid, compid) {
  const candidates = Array.from(vehicles.values()).filter((vehicle) => vehicle.sysid === sysid);
  if (compid) {
    return candidates.find((vehicle) => vehicle.compid === compid);
  }
  return candidates.find((vehicle) => vehicle.heartbeat) ?? candidates[0];
}

function queueListenerTransition(action) {
  const transition = listenerTransition.then(action);
  listenerTransition = transition.catch(() => undefined);
  return transition;
}

function closeSocket(closing) {
  return new Promise((resolve, reject) => {
    try {
      closing.close(resolve);
    } catch (error) {
      if (error.code === "ERR_SOCKET_DGRAM_NOT_RUNNING") resolve();
      else reject(error);
    }
  });
}

function invalidateVehicleLinks() {
  for (const vehicle of vehicles.values()) delete vehicle.link;
  clearMissionSession(uploadSession);
  clearMissionSession(downloadSession);
  completedDownloadSession = undefined;
  if (missionSync.active) setMissionSync({ active: false, message: "Mission sync cancelled: telemetry listener stopped." });
}

async function stopListener() {
  await gcsBridge.stop();
  const closing = socket;
  socket = undefined;
  listener = { ...listener, active: false };
  invalidateVehicleLinks();
  if (closing) await closeSocket(closing);
  return telemetryStatus();
}

export async function startTelemetryListener({ port = 14552, host = "127.0.0.1" } = {}) {
  const nextPort = typeof port === "number" || (typeof port === "string" && /^\d+$/.test(port.trim())) ? Number(port) : NaN;
  if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
    throw new TelemetryError("Telemetry port must be between 1024 and 65535.");
  }
  const nextHost = typeof host === "string" && host.trim().toLowerCase() === "localhost" ? "127.0.0.1" : host;
  if (typeof nextHost !== "string" || !isIPv4(nextHost)) {
    throw new TelemetryError("Telemetry bind host must be an IPv4 address or localhost.");
  }

  return queueListenerTransition(async () => {
    if (socket && listener.active && listener.port === nextPort && listener.host === nextHost) return telemetryStatus();
    await stopListener();
    const opening = dgram.createSocket("udp4");
    socket = opening;
    listener = { active: false, host: nextHost, port: nextPort, packetCount: 0, byteCount: 0 };
    opening.on("message", (message, remote) => {
      if (socket === opening && listener.active) onMessage(message, remote);
    });
    opening.on("error", (error) => {
      if (socket === opening) listener = { ...listener, error: error.message, errorCode: error.code, errorAt: new Date().toISOString() };
    });

    try {
      await new Promise((resolve, reject) => {
        opening.once("error", reject);
        opening.bind(nextPort, nextHost, () => {
          opening.off("error", reject);
          resolve();
        });
      });
      listener = { ...listener, active: true, pid: process.pid, startedAt: new Date().toISOString(), error: undefined, errorCode: undefined, errorAt: undefined };
    } catch (error) {
      socket = undefined;
      await closeSocket(opening);
      const message = error.code === "EADDRINUSE"
        ? `UDP port ${nextPort} is already in use. Stop its current listener or choose another telemetry port and update the SITL output to match.`
        : error.code === "EADDRNOTAVAIL"
          ? "Telemetry bind address is unavailable on this computer. Choose a local IPv4 address."
          : `Could not listen on UDP port ${nextPort} (${error.code || "socket error"}).`;
      listener = { ...listener, active: false, error: message, errorCode: error.code, errorAt: new Date().toISOString() };
      throw new TelemetryError(message, 409, { cause: error });
    }
    return telemetryStatus();
  });
}

export function stopTelemetryListener() {
  return queueListenerTransition(stopListener);
}

export function telemetryStatus() {
  return {
    listener: { ...listener },
    gcsBridge: gcsBridge.status(),
    vehicles: structuredClone(Array.from(vehicles.values()).sort((left, right) => left.sysid - right.sysid || left.compid - right.compid))
  };
}

function validateTarget(request = {}) {
  const targetSystem = request.sysid;
  const requestedComponent = request.compid ?? 0;
  if (!Number.isInteger(targetSystem) || targetSystem <= 0 || targetSystem > 255) {
    throw new TelemetryError("Target MAVLink system id must be between 1 and 255.");
  }
  if (!Number.isInteger(requestedComponent) || requestedComponent < 0 || requestedComponent > 255) {
    throw new TelemetryError("Target MAVLink component id must be between 0 and 255.");
  }
  return { targetSystem, requestedComponent };
}

export async function sendMavlinkCommand(request) {
  const { targetSystem, requestedComponent } = validateTarget(request);
  if (!socket || !listener.active) {
    throw new TelemetryError("Start the MAVLink telemetry reader before sending commands.", 409);
  }

  const vehicle = findVehicle(targetSystem, requestedComponent);
  if (!vehicle) {
    throw new TelemetryError(`No live vehicle with system id ${targetSystem}${requestedComponent ? ` and component id ${requestedComponent}` : ""} has been seen.`, 409);
  }
  if (!vehicle.link) {
    throw new TelemetryError(`No UDP return address is known for SYS ${targetSystem}. Wait for a new MAVLink packet and try again.`, 409);
  }

  const targetComponent = requestedComponent || vehicle.compid || 1;
  const command = commandFromRequest(request, vehicle);
  const packet = encodeCommandLong({
    targetSystem,
    targetComponent,
    command: command.command,
    params: command.params
  });

  const link = { ...vehicle.link };
  await sendToVehicle({ ...vehicle, link }, packet, `command:${command.command}`);

  return {
    sent: true,
    label: command.label,
    command: command.command,
    target: {
      sysid: targetSystem,
      compid: targetComponent
    },
    link,
    bytes: packet.length,
    message: `${command.label} sent to SYS ${targetSystem} via ${link.host}:${link.port}.`
  };
}

export function missionSyncStatus() {
  return structuredClone(missionSync);
}

function createMissionSession(request, direction) {
  const { targetSystem, requestedComponent } = validateTarget(request);
  if (!socket || !listener.active) throw new TelemetryError("Start the MAVLink telemetry reader before mission sync.", 409);
  if (uploadSession || downloadSession) throw new TelemetryError("A mission transfer is already running. Wait for completion or stop the telemetry listener to cancel it.", 409);
  const vehicle = findVehicle(targetSystem, requestedComponent);
  if (!vehicle?.link) throw new TelemetryError(`Wait for a fresh MAVLink packet from SYS ${targetSystem} before mission sync.`, 409);
  completedDownloadSession = undefined;
  return {
    sysid: targetSystem,
    compid: requestedComponent || vehicle.compid || 1,
    vehicle: structuredClone(vehicle),
    direction,
    items: [],
    sentItems: new Set(),
    requestedItems: new Set(),
    expectedCount: undefined,
    retryCount: 0
  };
}

export async function uploadMission(request) {
  const items = missionItemsFromText(request.missionText);
  const session = createMissionSession(request, "upload");
  session.items = items;
  uploadSession = session;
  const countPacket = encodeMissionCount(session.sysid, session.compid, items.length);
  setMissionSync({
    active: true,
    direction: "upload",
    target: { sysid: session.sysid, compid: session.compid },
    message: `Mission upload started (${items.length} items). Waiting for vehicle requests.`,
    uploadedCount: 0,
    downloadedCount: 0,
    expectedCount: items.length,
    missionText: undefined
  });
  await sendMissionPacket(session, countPacket);
  return missionSyncStatus();
}

export async function downloadMission(request) {
  const session = createMissionSession(request, "download");
  downloadSession = session;
  const requestPacket = encodeMissionRequestList(session.sysid, session.compid);
  setMissionSync({
    active: true,
    direction: "download",
    target: { sysid: session.sysid, compid: session.compid },
    message: "Mission download requested. Waiting for vehicle mission count.",
    uploadedCount: 0,
    downloadedCount: 0,
    expectedCount: 0,
    missionText: undefined
  });
  await sendMissionPacket(session, requestPacket);
  return missionSyncStatus();
}

export async function shutdownTelemetry() {
  await stopTelemetryListener();
  vehicles.clear();
  uploadSession = undefined;
  downloadSession = undefined;
  setMissionSync({
    active: false,
    direction: undefined,
    message: "Mission sync idle",
    target: undefined,
    uploadedCount: 0,
    downloadedCount: 0,
    expectedCount: 0,
    missionText: undefined
  });
}

export function telemetryTrace(filters = {}) {
  return {
    events: traceBuffer.query(filters),
    stats: traceBuffer.stats()
  };
}

export function telemetryTraceStats() {
  return traceBuffer.stats();
}

export function clearTelemetryTrace() {
  const cleared = traceBuffer.clear();
  return { cleared, stats: traceBuffer.stats() };
}

export function pauseTelemetryTrace() {
  return traceBuffer.pause();
}

export function resumeTelemetryTrace() {
  return traceBuffer.resume();
}

export function exportTelemetryTrace(format, filters = {}) {
  return traceBuffer.export(format, filters);
}
