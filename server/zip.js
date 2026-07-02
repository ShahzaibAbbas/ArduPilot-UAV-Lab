const crcTable = new Uint32Array(256);

for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function normalizedFileName(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

export function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const timestamp = dosDateTime();

  for (const file of files) {
    const fileName = normalizedFileName(file.name);
    if (!fileName) {
      continue;
    }

    const fileNameBuffer = Buffer.from(fileName, "utf8");
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content ?? ""), "utf8");
    const crc = crc32(content);

    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(timestamp.dosTime),
      uint16(timestamp.dosDate),
      uint32(crc),
      uint32(content.length),
      uint32(content.length),
      uint16(fileNameBuffer.length),
      uint16(0),
      fileNameBuffer
    ]);

    localParts.push(localHeader, content);

    centralParts.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(timestamp.dosTime),
        uint16(timestamp.dosDate),
        uint32(crc),
        uint32(content.length),
        uint32(content.length),
        uint16(fileNameBuffer.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        fileNameBuffer
      ])
    );

    offset += localHeader.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(centralParts.length),
    uint16(centralParts.length),
    uint32(centralDirectory.length),
    uint32(offset),
    uint16(0)
  ]);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}
