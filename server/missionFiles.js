// Shared by the browser importer and the MAVLink transfer service.
export const MAX_MISSION_ITEMS = 5000;
export const MAX_MISSION_FILE_BYTES = 2 * 1024 * 1024;

export function missionCoordinateScale(frame) {
  if ([0, 3, 5, 6, 10, 11].includes(frame)) return 10000000;
  return frame === 2 ? 1 : 10000;
}

export function parseMissionText(text) {
  if (typeof text !== "string" || text.length > MAX_MISSION_FILE_BYTES
    || new TextEncoder().encode(text).length > MAX_MISSION_FILE_BYTES) {
    throw new Error("Mission text must be a QGC WPL file no larger than 2 MiB.");
  }
  const items = [];
  let headerSeen = false;
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!headerSeen) {
      if (trimmed !== "QGC WPL 110") throw new Error("Mission must begin with the QGC WPL 110 header.");
      headerSeen = true;
      continue;
    }
    const columns = trimmed.split(/\s+/);
    if (columns.length !== 12) throw new Error(`Mission line ${lineIndex + 1} must contain 12 QGC WPL fields.`);
    const [seq, current, frame, command] = columns.slice(0, 4).map(Number);
    const params = columns.slice(4, 8).map(Number);
    const [lat, lon, z, autocontinue] = columns.slice(8).map(Number);
    const scale = missionCoordinateScale(frame);
    const x = Math.round(lat * scale);
    const y = Math.round(lon * scale);
    if (![seq, current, frame, command, lat, lon, z, autocontinue, ...params].every(Number.isFinite)
      || !Number.isInteger(seq) || seq < 0 || seq >= MAX_MISSION_ITEMS
      || ![0, 1].includes(current) || ![0, 1].includes(autocontinue)
      || !Number.isInteger(frame) || frame < 0 || frame > 21
      || !Number.isInteger(command) || command < 0 || command > 65535
      || [z, ...params].some((value) => !Number.isFinite(Math.fround(value)))
      || [x, y].some((value) => value < -2147483648 || value > 2147483647)
      || (scale === 1 && (!Number.isInteger(lat) || !Number.isInteger(lon)))
      || (scale === 10000000 && (Math.abs(lat) > 90 || Math.abs(lon) > 180))) {
      throw new Error(`Mission line ${lineIndex + 1} contains invalid or out-of-range fields.`);
    }
    items.push({ seq, current, frame: ({ 0: 5, 3: 6, 10: 11 })[frame] ?? frame,
      command, params, x, y, z, autocontinue });
    if (items.length > MAX_MISSION_ITEMS) throw new Error(`Mission must contain at most ${MAX_MISSION_ITEMS} items.`);
  }
  if (!headerSeen) throw new Error("Mission must begin with the QGC WPL 110 header.");
  items.sort((left, right) => left.seq - right.seq);
  if (items.some((item, index) => item.seq !== index)) {
    throw new Error("Mission sequence numbers must start at 0 and be consecutive without duplicates.");
  }
  return items;
}

/** Straight-line horizontal route estimate. Local positions cannot define a global route. */
export function missionDistanceKm(items) {
  const positions = items.filter((item) => [16, 21, 22, 82].includes(item.command));
  if (positions.some((item) => missionCoordinateScale(item.frame) !== 10000000)) return null;
  let total = 0;
  for (let index = 1; index < positions.length; index += 1) {
    const left = positions[index - 1];
    const right = positions[index];
    const radians = Math.PI / 180;
    const latA = left.x / 10000000 * radians;
    const latB = right.x / 10000000 * radians;
    const deltaLat = latB - latA;
    const deltaLon = (right.y - left.y) / 10000000 * radians;
    const haversine = Math.min(1, Math.max(0, Math.sin(deltaLat / 2) ** 2
      + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) ** 2));
    total += 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }
  return total;
}
