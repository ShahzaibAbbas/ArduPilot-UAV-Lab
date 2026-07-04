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
let mavlinkSequence = 0;
let uploadSession;
let downloadSession;
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

function onMessage(message, remote) {
  listener.packetCount += 1;
  listener.byteCount += message.length;
  listener.lastPacketAt = new Date().toISOString();
  listener.error = undefined;

  for (const packet of parseMavlinkDatagram(message)) {
    updateVehicle(packet, remote);
    handleMissionPacket(packet, remote);
  }
}

function crcAccumulate(byte, crc) {
  let value = byte ^ (crc & 0xff);
  value ^= value << 4;
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

function missionItemsFromText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const items = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("QGC")) {
      continue;
    }

    const columns = trimmed.split(/\s+/);
    if (columns.length < 12) {
      continue;
    }

    const seq = Number(columns[0]);
    const current = Number(columns[1]);
    const frame = Number(columns[2]);
    const command = Number(columns[3]);
    const params = columns.slice(4, 8).map((value) => Number(value));
    const lat = Number(columns[8]);
    const lon = Number(columns[9]);
    const z = Number(columns[10]);
    const autocontinue = Number(columns[11]);

    if (![seq, current, frame, command, lat, lon, z, autocontinue, ...params].every(Number.isFinite)) {
      continue;
    }

    items.push({
      seq,
      current,
      frame,
      command,
      params,
      x: Math.round(lat * 10000000),
      y: Math.round(lon * 10000000),
      z,
      autocontinue
    });
  }

  if (items.length === 0) {
    throw new Error("Mission text did not contain QGC WPL mission items.");
  }

  return items.sort((left, right) => left.seq - right.seq);
}

function missionTextFromItems(items) {
  const lines = ["QGC WPL 110"];
  for (const item of items.sort((left, right) => left.seq - right.seq)) {
    const lat = item.x / 10000000;
    const lon = item.y / 10000000;
    lines.push(
      [
        item.seq,
        item.current,
        item.frame,
        item.command,
        ...item.params.map((value) => Number(value || 0).toFixed(8)),
        lat.toFixed(7),
        lon.toFixed(7),
        Number(item.z || 0).toFixed(6),
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

async function sendToVehicle(vehicle, packet) {
  if (!socket || !listener.active) {
    throw new Error("Start the MAVLink telemetry reader before mission sync.");
  }
  if (!vehicle.link) {
    throw new Error(`No UDP return address is known for SYS ${vehicle.sysid}.`);
  }
  await new Promise((resolve, reject) => {
    socket.send(packet, vehicle.link.port, vehicle.link.host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function missionTargetMatches(session, packet) {
  return session && packet.sysid === session.sysid && (!session.compid || packet.compid === session.compid);
}

function setMissionSync(next) {
  missionSync = {
    ...missionSync,
    ...next,
    updatedAt: new Date().toISOString()
  };
}

function handleMissionPacket(packet) {
  if (uploadSession && missionTargetMatches(uploadSession, packet)) {
    const requestedSeq = parseMissionRequestSeq(packet);
    if (typeof requestedSeq === "number") {
      const item = uploadSession.items[requestedSeq];
      if (item) {
        const payload = encodeMissionItemInt(uploadSession.sysid, uploadSession.compid || packet.compid || 1, item);
        void sendToVehicle(uploadSession.vehicle, payload)
          .then(() => {
            setMissionSync({
              active: true,
              direction: "upload",
              message: `Sent mission item ${requestedSeq + 1}/${uploadSession.items.length}`,
              uploadedCount: requestedSeq + 1,
              expectedCount: uploadSession.items.length
            });
          })
          .catch((error) => {
            setMissionSync({ active: false, direction: "upload", message: error.message });
            uploadSession = undefined;
          });
      }
      return;
    }

    const ack = parseMissionAck(packet);
    if (typeof ack === "number") {
      const ok = ack === 0;
      setMissionSync({
        active: false,
        direction: "upload",
        message: ok ? `Mission upload accepted (${uploadSession.items.length} items).` : `Mission upload returned ACK ${ack}.`,
        uploadedCount: ok ? uploadSession.items.length : missionSync.uploadedCount,
        expectedCount: uploadSession.items.length
      });
      uploadSession = undefined;
    }
  }

  if (downloadSession && missionTargetMatches(downloadSession, packet)) {
    const count = parseMissionCount(packet);
    if (typeof count === "number") {
      downloadSession.expectedCount = count;
      downloadSession.items = [];
      setMissionSync({
        active: true,
        direction: "download",
        message: `Vehicle reports ${count} mission items.`,
        expectedCount: count,
        downloadedCount: 0
      });
      const request = encodeMissionRequestInt(downloadSession.sysid, downloadSession.compid || packet.compid || 1, 0);
      void sendToVehicle(downloadSession.vehicle, request).catch((error) => {
        setMissionSync({ active: false, direction: "download", message: error.message });
        downloadSession = undefined;
      });
      return;
    }

    const item = parseMissionItemInt(packet);
    if (item) {
      downloadSession.items[item.seq] = item;
      const downloaded = downloadSession.items.filter(Boolean).length;
      if (downloaded >= downloadSession.expectedCount) {
        const ack = encodeMissionAck(downloadSession.sysid, downloadSession.compid || packet.compid || 1, 0);
        void sendToVehicle(downloadSession.vehicle, ack).catch(() => undefined);
        const missionText = missionTextFromItems(downloadSession.items.filter(Boolean));
        setMissionSync({
          active: false,
          direction: "download",
          message: `Mission download complete (${downloaded} items).`,
          downloadedCount: downloaded,
          expectedCount: downloadSession.expectedCount,
          missionText
        });
        downloadSession = undefined;
      } else {
        const request = encodeMissionRequestInt(downloadSession.sysid, downloadSession.compid || packet.compid || 1, downloaded);
        void sendToVehicle(downloadSession.vehicle, request).catch((error) => {
          setMissionSync({ active: false, direction: "download", message: error.message });
          downloadSession = undefined;
        });
        setMissionSync({
          active: true,
          direction: "download",
          message: `Received mission item ${downloaded}/${downloadSession.expectedCount}`,
          downloadedCount: downloaded
        });
      }
    }
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

function numericParamList(params = []) {
  return Array.from({ length: 7 }, (_entry, index) => {
    const value = Number(params[index] ?? 0);
    return Number.isFinite(value) ? value : 0;
  });
}

function commandFromRequest(request) {
  const action = String(request.action || "").toLowerCase();

  if (action === "custom") {
    const command = Number(request.commandId);
    if (!Number.isInteger(command) || command < 0 || command > 65535) {
      throw new Error("Custom MAVLink command id must be between 0 and 65535.");
    }
    return {
      label: `MAV_CMD ${command}`,
      command,
      params: numericParamList(request.params)
    };
  }

  if (action === "mode") {
    const modeKey = String(request.mode || "guided").trim().toLowerCase();
    const mode = ardupilotModes[modeKey];
    if (typeof mode !== "number") {
      throw new Error(`Unsupported ArduPilot mode: ${request.mode}`);
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
    return { label: `Takeoff ${altitude} m`, command: 22, params: [0, 0, 0, 0, 0, 0, Number.isFinite(altitude) ? altitude : 20] };
  }
  if (action === "land") {
    return { label: "Land", command: 21, params: [0, 0, 0, 0, 0, 0, 0] };
  }
  if (action === "rtl") {
    return { label: "Return to launch", command: 20, params: [0, 0, 0, 0, 0, 0, 0] };
  }

  throw new Error("Choose a supported MAVLink action.");
}

function findVehicle(sysid, compid) {
  const candidates = Array.from(vehicles.values()).filter((vehicle) => vehicle.sysid === sysid);
  if (compid) {
    return candidates.find((vehicle) => vehicle.compid === compid) ?? candidates[0];
  }
  return candidates.find((vehicle) => vehicle.heartbeat) ?? candidates[0];
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

export async function sendMavlinkCommand(request) {
  const targetSystem = Number(request.sysid);
  const requestedComponent = Number(request.compid || 0);
  if (!Number.isInteger(targetSystem) || targetSystem <= 0 || targetSystem > 255) {
    throw new Error("Target MAVLink system id must be between 1 and 255.");
  }

  if (!socket || !listener.active) {
    throw new Error("Start the MAVLink telemetry reader before sending commands.");
  }

  const vehicle = findVehicle(targetSystem, requestedComponent);
  if (!vehicle) {
    throw new Error(`No live vehicle with system id ${targetSystem} has been seen.`);
  }
  if (!vehicle.link) {
    throw new Error(`No UDP return address is known for SYS ${targetSystem}. Wait for a new MAVLink packet and try again.`);
  }

  const targetComponent = requestedComponent || vehicle.compid || 1;
  const command = commandFromRequest(request);
  const packet = encodeCommandLong({
    targetSystem,
    targetComponent,
    command: command.command,
    params: command.params
  });

  await new Promise((resolve, reject) => {
    socket.send(packet, vehicle.link.port, vehicle.link.host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return {
    sent: true,
    label: command.label,
    command: command.command,
    target: {
      sysid: targetSystem,
      compid: targetComponent
    },
    link: vehicle.link,
    bytes: packet.length,
    message: `${command.label} sent to SYS ${targetSystem} via ${vehicle.link.host}:${vehicle.link.port}.`
  };
}

export function missionSyncStatus() {
  return { ...missionSync };
}

export async function uploadMission(request) {
  const targetSystem = Number(request.sysid);
  const requestedComponent = Number(request.compid || 0);
  const items = missionItemsFromText(request.missionText);
  const vehicle = findVehicle(targetSystem, requestedComponent);
  if (!vehicle) {
    throw new Error(`No live vehicle with system id ${targetSystem} has been seen.`);
  }

  uploadSession = {
    sysid: targetSystem,
    compid: requestedComponent || vehicle.compid || 1,
    vehicle,
    items
  };
  downloadSession = undefined;
  const countPacket = encodeMissionCount(uploadSession.sysid, uploadSession.compid, items.length);
  await sendToVehicle(vehicle, countPacket);
  setMissionSync({
    active: true,
    direction: "upload",
    target: { sysid: uploadSession.sysid, compid: uploadSession.compid },
    message: `Mission upload started (${items.length} items). Waiting for vehicle requests.`,
    uploadedCount: 0,
    downloadedCount: 0,
    expectedCount: items.length,
    missionText: undefined
  });
  return missionSyncStatus();
}

export async function downloadMission(request) {
  const targetSystem = Number(request.sysid);
  const requestedComponent = Number(request.compid || 0);
  const vehicle = findVehicle(targetSystem, requestedComponent);
  if (!vehicle) {
    throw new Error(`No live vehicle with system id ${targetSystem} has been seen.`);
  }

  downloadSession = {
    sysid: targetSystem,
    compid: requestedComponent || vehicle.compid || 1,
    vehicle,
    expectedCount: 0,
    items: []
  };
  uploadSession = undefined;
  const requestPacket = encodeMissionRequestList(downloadSession.sysid, downloadSession.compid);
  await sendToVehicle(vehicle, requestPacket);
  setMissionSync({
    active: true,
    direction: "download",
    target: { sysid: downloadSession.sysid, compid: downloadSession.compid },
    message: "Mission download requested. Waiting for vehicle mission count.",
    uploadedCount: 0,
    downloadedCount: 0,
    expectedCount: 0,
    missionText: undefined
  });
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
