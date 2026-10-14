const DEFAULT_MAX_COUNT = 1000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_RAW_PREVIEW_BYTES = 96;
const MAX_QUERY_LIMIT = 500;
const HARD_MAX_COUNT = 10000;
const HARD_MAX_BYTES = 16 * 1024 * 1024;
const HARD_MAX_PREVIEW_BYTES = 280;

function finiteInteger(value) {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !/^\d+$/.test(value.trim()))) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function boundedInteger(value, fallback, min, max) {
  return Math.min(max, Math.max(min, finiteInteger(value) ?? fallback));
}

function copyEvent({ approximateBytes: _approximateBytes, ...event }) {
  return { ...event, remote: event.remote ? { ...event.remote } : undefined, local: event.local ? { ...event.local } : undefined };
}

function endpointFor(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const host = typeof value.host === "string" ? value.host.slice(0, 128) : undefined;
  const port = finiteInteger(value.port);
  return host && port > 0 && port <= 65535 ? { host, port } : undefined;
}

function csvCell(value) {
  let text = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Quoting alone does not prevent spreadsheets from evaluating formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function eventBytes(event) {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

function rawPreviewFor(input, maxBytes) {
  if (Buffer.isBuffer(input.rawFrame)) {
    return input.rawFrame.subarray(0, maxBytes).toString("hex");
  }
  if (typeof input.rawPreviewHex === "string") {
    const hex = input.rawPreviewHex.slice(0, maxBytes * 4).replace(/[^a-f0-9]/gi, "").slice(0, maxBytes * 2).toLowerCase();
    return hex.slice(0, hex.length - (hex.length % 2));
  }
  return "";
}

function matchesNumber(eventValue, requestedValue) {
  if (requestedValue === undefined || requestedValue === null || (typeof requestedValue === "string" && !requestedValue.trim())) return true;
  const value = finiteInteger(requestedValue);
  return value !== undefined && eventValue === value;
}

function matchesText(event, requestedText) {
  const text = String(requestedText ?? "").slice(0, 512).trim().toLowerCase();
  if (!text) {
    return true;
  }
  const haystack = [
    event.messageName,
    event.summary,
    event.correlation,
    event.protocol,
    event.direction,
    event.checksumStatus,
    event.remote?.host,
    event.remote?.port,
    event.local?.host,
    event.local?.port,
    event.rawPreviewHex
  ]
    .filter((value) => value !== undefined)
    .join(" ")
    .toLowerCase();
  return haystack.includes(text);
}

export class TraceBuffer {
  constructor({
    maxCount = DEFAULT_MAX_COUNT,
    maxBytes = DEFAULT_MAX_BYTES,
    rawPreviewBytes = DEFAULT_RAW_PREVIEW_BYTES
  } = {}) {
    this.maxCount = boundedInteger(maxCount, DEFAULT_MAX_COUNT, 1, HARD_MAX_COUNT);
    this.maxBytes = boundedInteger(maxBytes, DEFAULT_MAX_BYTES, 1024, HARD_MAX_BYTES);
    this.rawPreviewBytes = boundedInteger(rawPreviewBytes, DEFAULT_RAW_PREVIEW_BYTES, 1, HARD_MAX_PREVIEW_BYTES);
    this.events = [];
    this.approximateBytes = 0;
    this.nextId = 1;
    this.paused = false;
    this.droppedCount = 0;
  }

  add(input = {}) {
    if (this.paused) {
      return undefined;
    }

    const event = {
      id: this.nextId,
      receivedAt: typeof input.receivedAt === "string" && input.receivedAt.length <= 64 && Number.isFinite(Date.parse(input.receivedAt)) ? new Date(input.receivedAt).toISOString() : new Date().toISOString(),
      direction: input.direction === "tx" ? "tx" : "rx",
      protocol: input.protocol === "MAVLink1" ? "MAVLink1" : "MAVLink2",
      remote: endpointFor(input.remote),
      local: endpointFor(input.local),
      datagramLength: boundedInteger(input.datagramLength, 0, 0, 65535),
      frameLength: boundedInteger(input.frameLength, 0, 0, 280),
      sequence: boundedInteger(input.sequence, 0, 0, 255),
      systemId: boundedInteger(input.systemId, 0, 0, 255),
      componentId: boundedInteger(input.componentId, 0, 0, 255),
      messageId: boundedInteger(input.messageId, 0, 0, 16777215),
      messageName: String(input.messageName || `MSG_${finiteInteger(input.messageId) ?? 0}`).slice(0, 80),
      payloadLength: boundedInteger(input.payloadLength, 0, 0, 255),
      checksumStatus: input.checksumStatus === "valid" || input.checksumStatus === "invalid" ? input.checksumStatus : "unknown",
      signed: input.signed === true,
      summary: String(input.summary || "").slice(0, 320),
      correlation: input.correlation ? String(input.correlation).slice(0, 120) : undefined,
      rawPreviewHex: rawPreviewFor(input, this.rawPreviewBytes)
    };
    this.nextId += 1;

    const size = eventBytes(event);
    if (size > this.maxBytes) {
      this.droppedCount += 1;
      return undefined;
    }
    this.events.push({ ...event, approximateBytes: size });
    this.approximateBytes += size;

    while (this.events.length > this.maxCount || this.approximateBytes > this.maxBytes) {
      const removed = this.events.shift();
      if (!removed) {
        break;
      }
      this.approximateBytes -= removed.approximateBytes;
      this.droppedCount += 1;
    }

    return copyEvent(event);
  }

  query(filters = {}) {
    const requestedLimit = finiteInteger(filters.limit);
    const limit = Math.min(MAX_QUERY_LIMIT, Math.max(1, requestedLimit ?? 200));
    return this.matchingEvents(filters).slice(-limit).map(copyEvent);
  }

  matchingEvents(filters = {}) {
    const direction = filters.direction && filters.direction !== "all" ? filters.direction : undefined;
    const protocol = filters.protocol && filters.protocol !== "all" ? filters.protocol : undefined;
    const hasAfterId = filters.afterId !== undefined && filters.afterId !== "";
    const afterId = finiteInteger(filters.afterId);
    return this.events.filter(
        (event) =>
          (!direction || event.direction === direction) &&
          (!protocol || event.protocol === protocol) &&
          (!hasAfterId || (afterId !== undefined && event.id > afterId)) &&
          matchesNumber(event.systemId, filters.systemId ?? filters.sysid) &&
          matchesNumber(event.componentId, filters.componentId ?? filters.compid) &&
          matchesNumber(event.messageId, filters.messageId ?? filters.msgid) &&
          matchesText(event, filters.text)
      );
  }

  clear() {
    const cleared = this.events.length;
    this.events = [];
    this.approximateBytes = 0;
    return cleared;
  }

  pause() {
    this.paused = true;
    return this.stats();
  }

  resume() {
    this.paused = false;
    return this.stats();
  }

  stats() {
    const byMessageId = {};
    const byDirection = { rx: 0, tx: 0 };
    for (const event of this.events) {
      byDirection[event.direction] += 1;
      const key = String(event.messageId);
      const current = byMessageId[key] ?? {
        messageId: event.messageId,
        messageName: event.messageName,
        count: 0
      };
      current.count += 1;
      byMessageId[key] = current;
    }

    return {
      paused: this.paused,
      count: this.events.length,
      approximateBytes: this.approximateBytes,
      maxCount: this.maxCount,
      maxBytes: this.maxBytes,
      droppedCount: this.droppedCount,
      newestId: this.events.at(-1)?.id,
      oldestId: this.events[0]?.id,
      byDirection,
      byMessageId: Object.values(byMessageId).sort((left, right) => right.count - left.count || left.messageId - right.messageId)
    };
  }

  export(format, filters = {}) {
    const events = this.matchingEvents(filters).map(copyEvent);
    if (format === "csv") {
      const columns = [
        "id",
        "receivedAt",
        "direction",
        "protocol",
        "remote",
        "local",
        "datagramLength",
        "frameLength",
        "sequence",
        "systemId",
        "componentId",
        "messageId",
        "messageName",
        "payloadLength",
        "checksumStatus",
        "signed",
        "summary",
        "correlation",
        "rawPreviewHex"
      ];
      const content = [
        columns.map(csvCell).join(","),
        ...events.map((event) => columns.map((column) => csvCell(event[column])).join(","))
      ].join("\n");
      return {
        fileName: "telemetry.mavtrace.csv",
        mimeType: "text/csv; charset=utf-8",
        content: `${content}\n`
      };
    }

    return {
      fileName: "telemetry.mavtrace.json",
      mimeType: "application/json",
      content: JSON.stringify(
        {
          format: "ardupilot-uav-lab.mavtrace",
          version: 1,
          exportedAt: new Date().toISOString(),
          exportedCount: events.length,
          stats: this.stats(),
          events
        },
        null,
        2
      )
    };
  }
}
