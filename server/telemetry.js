import dgram from "node:dgram";

let socket;
let listener = {
  active: false,
  host: "127.0.0.1",
  port: 14552,
  startedAt: undefined,
  lastPacketAt: undefined,
  packetCount: 0,
  byteCount: 0,
  error: undefined
};

const vehicles = new Map();

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

function vehicleKey(sysid, compid) {
  return `${sysid}:${compid}`;
}

function vehicleFor(packet) {
  const key = vehicleKey(packet.sysid, packet.compid);
  const current =
    vehicles.get(key) ??
    {
      id: key,
      sysid: packet.sysid,
      compid: packet.compid,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: undefined,
      messageCount: 0
    };
  current.lastSeenAt = new Date().toISOString();
  current.messageCount += 1;
  vehicles.set(key, current);
  return current;
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

function updateVehicle(packet) {
  const vehicle = vehicleFor(packet);
  const payload = packet.payload;

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
    vehicle.battery = {
      voltageV: typeof voltage === "number" && voltage !== 65535 ? voltage / 1000 : undefined,
      currentA: typeof current === "number" && current !== -1 ? current / 100 : undefined,
      remainingPercent: payload.readInt8(30)
    };
  }

  if (packet.msgid === 24 && payload.length >= 30) {
    vehicle.gps = {
      lat: degreesFromScaled(readInt32(payload, 8)),
      lon: degreesFromScaled(readInt32(payload, 12)),
      altM: metersFromMm(readInt32(payload, 16)),
      groundSpeedMps: (readUInt16(payload, 24) ?? 0) / 100,
      fixType: payload.readUInt8(28),
      satellites: payload.readUInt8(29)
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
    vehicle.position = {
      lat: degreesFromScaled(readInt32(payload, 4)),
      lon: degreesFromScaled(readInt32(payload, 8)),
      altM: metersFromMm(readInt32(payload, 12)),
      relativeAltM: metersFromMm(readInt32(payload, 16)),
      vxMps: (readInt16(payload, 20) ?? 0) / 100,
      vyMps: (readInt16(payload, 22) ?? 0) / 100,
      vzMps: (readInt16(payload, 24) ?? 0) / 100,
      headingDeg: (readUInt16(payload, 26) ?? 0) / 100
    };
  }

  if (packet.msgid === 74 && payload.length >= 20) {
    vehicle.vfrHud = {
      airspeedMps: readFloat(payload, 0),
      groundspeedMps: readFloat(payload, 4),
      headingDeg: readInt16(payload, 8),
      throttlePercent: readUInt16(payload, 10),
      altM: readFloat(payload, 12),
      climbMps: readFloat(payload, 16)
    };
  }

  if (packet.msgid === 147 && payload.length >= 36) {
    const voltages = [];
    for (let offset = 10; offset < 30; offset += 2) {
      const voltage = readUInt16(payload, offset);
      if (typeof voltage === "number" && voltage !== 65535) {
        voltages.push(voltage / 1000);
      }
    }
    const current = readInt16(payload, 30);
    vehicle.battery = {
      voltageV: voltages.length ? voltages.reduce((sum, value) => sum + value, 0) : vehicle.battery?.voltageV,
      currentA: typeof current === "number" && current !== -1 ? current / 100 : vehicle.battery?.currentA,
      remainingPercent: payload.readInt8(35)
    };
  }

  if (packet.msgid === 253) {
    const statusText = parseStatusText(payload);
    if (statusText) {
      vehicle.statusText = statusText;
    }
  }
}

function parseMavlinkDatagram(buffer) {
  const packets = [];
  let offset = 0;

  while (offset < buffer.length) {
    const magic = buffer.readUInt8(offset);
    if (magic !== 0xfe && magic !== 0xfd) {
      offset += 1;
      continue;
    }

    if (magic === 0xfe) {
      if (offset + 8 > buffer.length) {
        break;
      }
      const payloadLength = buffer.readUInt8(offset + 1);
      const frameLength = 6 + payloadLength + 2;
      if (offset + frameLength > buffer.length) {
        break;
      }
      packets.push({
        version: 1,
        seq: buffer.readUInt8(offset + 2),
        sysid: buffer.readUInt8(offset + 3),
        compid: buffer.readUInt8(offset + 4),
        msgid: buffer.readUInt8(offset + 5),
        payload: buffer.subarray(offset + 6, offset + 6 + payloadLength)
      });
      offset += frameLength;
      continue;
    }

    if (offset + 12 > buffer.length) {
      break;
    }
    const payloadLength = buffer.readUInt8(offset + 1);
    const incompatFlags = buffer.readUInt8(offset + 2);
    const signatureLength = incompatFlags & 0x01 ? 13 : 0;
    const frameLength = 10 + payloadLength + 2 + signatureLength;
    if (offset + frameLength > buffer.length) {
      break;
    }
    packets.push({
      version: 2,
      seq: buffer.readUInt8(offset + 4),
      sysid: buffer.readUInt8(offset + 5),
      compid: buffer.readUInt8(offset + 6),
      msgid: buffer.readUInt8(offset + 7) | (buffer.readUInt8(offset + 8) << 8) | (buffer.readUInt8(offset + 9) << 16),
      payload: buffer.subarray(offset + 10, offset + 10 + payloadLength)
    });
    offset += frameLength;
  }

  return packets;
}

function onMessage(message) {
  listener.packetCount += 1;
  listener.byteCount += message.length;
  listener.lastPacketAt = new Date().toISOString();
  listener.error = undefined;

  for (const packet of parseMavlinkDatagram(message)) {
    updateVehicle(packet);
  }
}

export async function startTelemetryListener({ port = 14552, host = "127.0.0.1" } = {}) {
  const nextPort = Number(port);
  if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
    throw new Error("Telemetry port must be between 1024 and 65535.");
  }

  if (socket && listener.active && listener.port === nextPort && listener.host === host) {
    return telemetryStatus();
  }

  await stopTelemetryListener();

  socket = dgram.createSocket("udp4");
  socket.on("message", onMessage);
  socket.on("error", (error) => {
    listener.error = error.message;
  });

  await new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(nextPort, host, () => {
      socket.off("error", reject);
      listener = {
        active: true,
        host,
        port: nextPort,
        startedAt: new Date().toISOString(),
        lastPacketAt: undefined,
        packetCount: 0,
        byteCount: 0,
        error: undefined
      };
      resolve();
    });
  });

  return telemetryStatus();
}

export async function stopTelemetryListener() {
  if (!socket) {
    listener = { ...listener, active: false };
    return telemetryStatus();
  }

  const closing = socket;
  socket = undefined;
  await new Promise((resolve) => closing.close(resolve));
  listener = { ...listener, active: false };
  return telemetryStatus();
}

export function telemetryStatus() {
  return {
    listener: { ...listener },
    vehicles: Array.from(vehicles.values()).sort((left, right) => left.sysid - right.sysid || left.compid - right.compid)
  };
}

export async function shutdownTelemetry() {
  await stopTelemetryListener();
  vehicles.clear();
}
