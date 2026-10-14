import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".apj", ".bin", ".hex", ".elf"]);
const FIRMWARE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_WORKFLOW_STATES = new Set(["VALIDATING", "READY", "ERASING", "FLASHING", "VERIFYING", "BOOTING"]);
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_WORKFLOW_EVENTS = 100;
const WORKFLOW_SEQUENCE = [
  { state: "VALIDATING", progress: 8, message: "Checking stored metadata and compatibility" },
  { state: "READY", progress: 16, message: "Firmware record ready for visual workflow" },
  { state: "ERASING", progress: 28, message: "Simulating device erase" },
  { state: "FLASHING", progress: 64, message: "Simulating firmware transfer" },
  { state: "VERIFYING", progress: 82, message: "Simulating hash verification" },
  { state: "BOOTING", progress: 94, message: "Simulating boot sequence" },
  { state: "RUNNING", progress: 100, message: "Visual firmware workflow is running" }
];

export class FirmwareError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "FirmwareError";
    this.statusCode = statusCode;
  }
}

function safeOriginalName(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 240 || name !== path.basename(name) || /[<>:"|?*\\/\x00-\x1f\x7f]/.test(name)) {
    throw new FirmwareError("Firmware file name is invalid.");
  }
  return name;
}

function firmwareId(value) {
  const id = String(value ?? "");
  if (!FIRMWARE_ID_PATTERN.test(id)) {
    throw new FirmwareError("Firmware record was not found.", 404);
  }
  return id.toLowerCase();
}

function textField(value, maxLength = 240) {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function positiveInteger(value) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value.trim()))) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

async function readBoundedFile(filePath, maxBytes) {
  if (!(await lstat(filePath)).isFile()) throw new FirmwareError("Stored firmware content must be a regular file.", 422);
  const file = await open(filePath, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxBytes) throw new FirmwareError("Stored firmware content exceeds its size limit.", 422);
    const buffer = Buffer.alloc(Math.min(maxBytes, info.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > info.size || offset > maxBytes) throw new FirmwareError("Stored firmware content changed while reading. Try again.", 409);
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}

function parseApjMetadata(buffer) {
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    return {
      detectedFormat: "APJ container (metadata unavailable)",
      metadata: {},
      warnings: ["The .apj file was not valid JSON, so embedded metadata was not inspected."]
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      detectedFormat: "APJ container (unexpected metadata)",
      metadata: {},
      warnings: ["The .apj JSON root was not an object."]
    };
  }

  const image = typeof parsed.image === "string" ? parsed.image : undefined;
  return {
    detectedFormat: "ArduPilot APJ JSON container",
    metadata: {
      boardId: positiveInteger(parsed.board_id ?? parsed.boardId),
      boardRevision: positiveInteger(parsed.board_revision ?? parsed.boardRevision),
      description: textField(parsed.description),
      vehicleType: textField(parsed.vehicle ?? parsed.vehicle_type ?? parsed.vehicleType),
      gitIdentity: textField(parsed.git_identity ?? parsed.gitIdentity),
      imageSize: positiveInteger(parsed.image_size ?? parsed.imageSize),
      imageEncoding: textField(parsed.image_format ?? parsed.image_encoding ?? parsed.encoding) ?? (image ? "base64 or encoded text (opaque)" : undefined),
      imageCompression: textField(parsed.image_compression ?? parsed.compression)
    },
    warnings: image ? ["Embedded firmware image data was treated as opaque and was not executed."] : []
  };
}

function inspectFormat(extension, buffer) {
  if (extension === ".apj") {
    return parseApjMetadata(buffer);
  }
  if (extension === ".elf") {
    const isElf = buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    return {
      detectedFormat: isElf ? "ELF executable image (stored only)" : "ELF extension with unrecognized header",
      metadata: {},
      warnings: isElf ? ["ELF content is stored for inspection only and is never executed."] : ["The ELF magic header was not detected."]
    };
  }
  if (extension === ".hex") {
    const isIntelHex = buffer.subarray(0, 1).toString("ascii") === ":";
    return {
      detectedFormat: isIntelHex ? "Intel HEX text image" : "HEX extension with unrecognized header",
      metadata: {},
      warnings: isIntelHex ? [] : ["The Intel HEX record prefix was not detected."]
    };
  }
  return {
    detectedFormat: "Raw binary firmware image",
    metadata: {},
    warnings: ["Raw binary metadata is not available without a board-specific manifest."]
  };
}

function vehicleMatches(metadataVehicle, linkedVehicle) {
  if (!metadataVehicle || !linkedVehicle) {
    return undefined;
  }
  const normalize = (value) => value.trim().toLowerCase().replace(/^ardu/, "");
  const left = normalize(metadataVehicle);
  const right = normalize(linkedVehicle);
  const vehicles = new Set(["copter", "plane", "rover", "sub", "blimp", "antennatracker"]);
  return vehicles.has(left) && vehicles.has(right) ? left === right : undefined;
}

function compatibilityFor({ selectedComponentType, selectedBoard, linkedVehicle }, metadata) {
  if (selectedComponentType && selectedComponentType !== "flight-controller") {
    return {
      status: "incompatible",
      message: "Firmware can only be attached to a flight-controller component in this phase."
    };
  }
  if (!selectedComponentType) {
    return {
      status: "unknown",
      message: "Select a flight controller to evaluate board compatibility."
    };
  }

  const matchesVehicle = vehicleMatches(metadata.vehicleType, linkedVehicle);
  if (matchesVehicle === false) {
    return {
      status: "incompatible",
      message: `${metadata.vehicleType} metadata does not match the linked ${linkedVehicle} SITL vehicle.`
    };
  }

  if (metadata.boardId !== undefined && selectedBoard) {
    const boardIdentifier = selectedBoard.trim().match(/^(?:(?:board(?:\s+id)?|apj)[\s:#_-]*)?(\d+)$/i)?.[1];
    if (boardIdentifier !== undefined && Number(boardIdentifier) === metadata.boardId) {
      return {
        status: "compatible",
        message: `APJ board ${metadata.boardId} matches the selected board identifier.`
      };
    }
    return {
      status: "review",
      message: `APJ board ${metadata.boardId} must be checked against ${selectedBoard} before hardware flashing.`
    };
  }

  return {
    status: "review",
    message: matchesVehicle
      ? `Firmware vehicle metadata matches ${linkedVehicle}; verify the exact ${selectedBoard || "board"} hardware target.`
      : `Verify this image against ${selectedBoard || "the selected board"} before any real hardware workflow.`
  };
}

function publicRecord(record) {
  return {
    id: record.id,
    originalName: record.originalName,
    safeStoredName: record.safeStoredName,
    extension: record.extension,
    byteSize: record.byteSize,
    sha256: record.sha256,
    uploadedAt: record.uploadedAt,
    detectedFormat: record.detectedFormat,
    metadata: record.metadata,
    compatibility: record.compatibility,
    selectedNode: record.selectedNode,
    linkedSitlVehicle: record.linkedSitlVehicle,
    warnings: record.warnings
  };
}

function storedRecord(value, expectedId) {
  if (!value || value.id !== expectedId || !SUPPORTED_EXTENSIONS.has(value.extension)
    || value.safeStoredName !== `${expectedId}${value.extension}`
    || !Number.isSafeInteger(value.byteSize) || value.byteSize <= 0
    || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)
    || typeof value.uploadedAt !== "string" || !Number.isFinite(Date.parse(value.uploadedAt))
    || typeof value.detectedFormat !== "string"
    || !["compatible", "review", "incompatible", "unknown"].includes(value.compatibility?.status)
    || typeof value.compatibility?.message !== "string") {
    throw new FirmwareError("Stored firmware metadata is invalid. Upload the file again.", 422);
  }
  const originalName = safeOriginalName(value.originalName);
  if (path.extname(originalName).toLowerCase() !== value.extension) {
    throw new FirmwareError("Stored firmware metadata is invalid. Upload the file again.", 422);
  }
  const metadata = {};
  for (const key of ["boardId", "boardRevision", "imageSize"]) metadata[key] = positiveInteger(value.metadata?.[key]);
  for (const key of ["description", "vehicleType", "gitIdentity", "imageEncoding", "imageCompression"]) {
    metadata[key] = textField(value.metadata?.[key]);
  }
  return publicRecord({
    ...value,
    originalName,
    metadata,
    detectedFormat: value.detectedFormat.slice(0, 240),
    compatibility: { status: value.compatibility.status, message: value.compatibility.message.slice(0, 500) },
    selectedNode: {
      nodeId: textField(value.selectedNode?.nodeId, 120),
      board: textField(value.selectedNode?.board, 120),
      componentType: textField(value.selectedNode?.componentType, 120)
    },
    linkedSitlVehicle: textField(value.linkedSitlVehicle, 60),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning) => typeof warning === "string").slice(0, 20).map((warning) => warning.slice(0, 500)) : []
  });
}

function workflowEvent(state, progress, message) {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    state,
    progress,
    origin: "workflow simulation",
    message
  };
}

export class FirmwareStore {
  constructor({ root, maxUploadBytes = 16 * 1024 * 1024, workflowStepMs = 650, maxWorkflows = 100 } = {}) {
    if (!root) {
      throw new Error("Firmware storage root is required.");
    }
    this.root = path.resolve(root);
    this.maxUploadBytes = boundedInteger(maxUploadBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024);
    this.workflowStepMs = boundedInteger(workflowStepMs, 650, 1, 60_000);
    this.maxWorkflows = boundedInteger(maxWorkflows, 100, 1, 1000);
    this.workflows = new Map();
    this.workflowTimers = new Map();
  }

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  recordPaths(id, extension) {
    const safeId = firmwareId(id);
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new FirmwareError("Stored firmware type is invalid.", 422);
    return {
      storagePath: path.join(this.root, `${safeId}${extension}`),
      metadataPath: path.join(this.root, `${safeId}.json`)
    };
  }

  async upload({ originalName, bytes, selectedNodeId, selectedBoard, selectedComponentType, linkedVehicle }) {
    const name = safeOriginalName(originalName);
    const extension = path.extname(name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new FirmwareError("Supported firmware types are .apj, .bin, .hex, and .elf.");
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new FirmwareError("Choose a non-empty firmware file.");
    }
    if (bytes.length > this.maxUploadBytes) {
      throw new FirmwareError(`Firmware upload exceeds the ${this.maxUploadBytes} byte limit.`, 413);
    }

    await this.init();
    const id = randomUUID();
    const paths = this.recordPaths(id, extension);
    const inspection = inspectFormat(extension, bytes);
    const selected = {
      nodeId: textField(selectedNodeId, 120),
      board: textField(selectedBoard, 120),
      componentType: textField(selectedComponentType, 120)
    };
    const compatibility = compatibilityFor(
      {
        selectedComponentType: selected.componentType,
        selectedBoard: selected.board,
        linkedVehicle: textField(linkedVehicle, 60)
      },
      inspection.metadata
    );
    const record = {
      id,
      originalName: name,
      safeStoredName: `${id}${extension}`,
      extension,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedAt: new Date().toISOString(),
      detectedFormat: inspection.detectedFormat,
      metadata: inspection.metadata,
      compatibility,
      selectedNode: selected,
      linkedSitlVehicle: textField(linkedVehicle, 60),
      warnings: inspection.warnings,
      storagePath: paths.storagePath,
      metadataPath: paths.metadataPath
    };

    await writeFile(paths.storagePath, bytes, { flag: "wx" });
    try {
      await writeFile(paths.metadataPath, JSON.stringify(publicRecord(record), null, 2), { flag: "wx" });
    } catch (error) {
      await rm(paths.storagePath, { force: true });
      throw error;
    }

    return publicRecord(record);
  }

  async get(id) {
    const safeId = firmwareId(id);
    await this.init();
    let parsed;
    try {
      parsed = JSON.parse((await readBoundedFile(path.join(this.root, `${safeId}.json`), MAX_METADATA_BYTES)).toString("utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new FirmwareError("Firmware record was not found.", 404);
      }
      if (error instanceof FirmwareError) throw error;
      throw new FirmwareError("Stored firmware metadata could not be read. Upload the file again.", 422);
    }
    return storedRecord(parsed, safeId);
  }

  async list() {
    await this.init();
    const entries = await readdir(this.root, { withFileTypes: true });
    const recent = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json") || !FIRMWARE_ID_PATTERN.test(entry.name.slice(0, -5))) continue;
      try {
        const info = await lstat(path.join(this.root, entry.name));
        recent.push({ name: entry.name, modifiedAt: info.mtimeMs });
        recent.sort((left, right) => right.modifiedAt - left.modifiedAt);
        if (recent.length > 200) recent.pop();
      } catch {
        // A concurrent removal should not break the library listing.
      }
    }
    const records = [];
    for (const { name } of recent) {
      try {
        records.push(await this.get(name.slice(0, -5)));
      } catch {
        // Ignore incomplete metadata files rather than exposing storage details.
      }
    }
    return records.sort((left, right) => String(right.uploadedAt).localeCompare(String(left.uploadedAt)));
  }

  async attach(id, { selectedNodeId, selectedBoard, selectedComponentType, linkedVehicle }) {
    const nodeId = textField(selectedNodeId, 120);
    if (!nodeId || selectedComponentType !== "flight-controller") {
      throw new FirmwareError("Select a flight-controller component before attaching firmware.");
    }
    const record = await this.get(id);
    if (ACTIVE_WORKFLOW_STATES.has(this.workflow(record.id).state)) {
      throw new FirmwareError("Stop the visual workflow before changing its flight-controller target.", 409);
    }
    record.selectedNode = { nodeId, board: textField(selectedBoard, 120), componentType: selectedComponentType };
    record.linkedSitlVehicle = textField(linkedVehicle, 60);
    record.compatibility = compatibilityFor({
      selectedComponentType,
      selectedBoard: record.selectedNode.board,
      linkedVehicle: record.linkedSitlVehicle
    }, record.metadata);
    const { metadataPath } = this.recordPaths(record.id, record.extension);
    const temporaryPath = path.join(this.root, `${record.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, JSON.stringify(record, null, 2), { flag: "wx" });
      await rename(temporaryPath, metadataPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return record;
  }

  async delete(id) {
    const record = await this.get(id);
    this.clearWorkflowTimers(record.id);
    this.workflows.delete(record.id);
    const paths = this.recordPaths(record.id, record.extension);
    await Promise.all([rm(paths.storagePath, { force: true }), rm(paths.metadataPath, { force: true })]);
    return record.id;
  }

  clearWorkflowTimers(id) {
    for (const timer of this.workflowTimers.get(id) ?? []) {
      clearTimeout(timer);
    }
    this.workflowTimers.delete(id);
  }

  close() {
    for (const id of this.workflowTimers.keys()) this.clearWorkflowTimers(id);
    this.workflows.clear();
  }

  reserveWorkflow(id) {
    if (this.workflows.has(id) || this.workflows.size < this.maxWorkflows) return;
    for (const [oldId, workflow] of this.workflows) {
      if (!ACTIVE_WORKFLOW_STATES.has(workflow.state)) {
        this.clearWorkflowTimers(oldId);
        this.workflows.delete(oldId);
        return;
      }
    }
    throw new FirmwareError("The visual workflow limit is reached. Stop another simulation before starting this one.", 409);
  }

  workflow(id) {
    const safeId = firmwareId(id);
    const workflow = this.workflows.get(safeId);
    return workflow
      ? {
        ...workflow,
        elapsedMs: ACTIVE_WORKFLOW_STATES.has(workflow.state) ? Math.max(0, Date.now() - Date.parse(workflow.startedAt)) : workflow.elapsedMs,
        events: workflow.events.map((event) => ({ ...event }))
      }
      : {
        firmwareId: safeId,
        state: "EMPTY",
        progress: 0,
        visualSimulation: true,
        startedAt: undefined,
        elapsedMs: 0,
        events: []
      };
  }

  async startWorkflow(id) {
    const record = await this.get(id);
    const current = this.workflow(record.id);
    if (ACTIVE_WORKFLOW_STATES.has(current.state)) {
      throw new FirmwareError("The visual firmware workflow is already active.", 409);
    }
    if (record.compatibility.status === "incompatible") {
      throw new FirmwareError(`Cannot start this simulation: ${record.compatibility.message}`, 409);
    }

    this.reserveWorkflow(record.id);
    this.clearWorkflowTimers(record.id);
    const startedAtMs = Date.now();
    const workflow = {
      firmwareId: record.id,
      state: "VALIDATING",
      progress: 8,
      visualSimulation: true,
      startedAt: new Date(startedAtMs).toISOString(),
      elapsedMs: 0,
      events: [workflowEvent("VALIDATING", 8, "Checking stored metadata and compatibility")]
    };
    this.workflows.set(record.id, workflow);

    try {
      const { storagePath } = this.recordPaths(record.id, record.extension);
      const bytes = await readBoundedFile(storagePath, this.maxUploadBytes);
      if (bytes.length !== record.byteSize || createHash("sha256").update(bytes).digest("hex") !== record.sha256) {
        throw new FirmwareError("Stored bytes do not match the recorded size and SHA-256. Upload the original file again.", 422);
      }
    } catch (error) {
      if (this.workflows.get(record.id) === workflow && workflow.state === "VALIDATING") {
        workflow.state = "FAILED";
        workflow.elapsedMs = Date.now() - startedAtMs;
        const message = error instanceof FirmwareError ? error.message : "Stored firmware bytes could not be read. Upload the file again.";
        workflow.events.push(workflowEvent("FAILED", workflow.progress, message));
      }
      return this.workflow(record.id);
    }
    // Stop or deletion may have happened while integrity checking read the file.
    if (this.workflows.get(record.id) !== workflow || workflow.state !== "VALIDATING") return this.workflow(record.id);

    const timers = WORKFLOW_SEQUENCE.slice(1).map((step, index) =>
      setTimeout(() => {
        const active = this.workflows.get(record.id);
        if (active !== workflow || !ACTIVE_WORKFLOW_STATES.has(active.state)) {
          return;
        }
        active.state = step.state;
        active.progress = step.progress;
        active.elapsedMs = Date.now() - startedAtMs;
        active.events = [...active.events, workflowEvent(step.state, step.progress, step.message)].slice(-MAX_WORKFLOW_EVENTS);
        if (step.state === "RUNNING") {
          this.workflowTimers.delete(record.id);
        }
      }, this.workflowStepMs * (index + 1))
    );
    this.workflowTimers.set(record.id, timers);
    return this.workflow(record.id);
  }

  async stopWorkflow(id) {
    await this.get(id);
    const workflow = this.workflow(id);
    if (workflow.state === "STOPPED" || workflow.state === "EMPTY" || workflow.state === "FAILED") return workflow;
    this.clearWorkflowTimers(workflow.firmwareId);
    workflow.state = "STOPPED";
    workflow.progress = Math.min(workflow.progress, 100);
    workflow.elapsedMs = workflow.startedAt ? Date.now() - Date.parse(workflow.startedAt) : 0;
    workflow.events = [...workflow.events, workflowEvent("STOPPED", workflow.progress, "Visual firmware workflow stopped")].slice(-MAX_WORKFLOW_EVENTS);
    this.workflows.set(workflow.firmwareId, workflow);
    return this.workflow(workflow.firmwareId);
  }

  /** Clear the visual workflow state while retaining the uploaded firmware record. */
  async wipeWorkflow(id) {
    const record = await this.get(id);
    this.clearWorkflowTimers(record.id);
    this.workflows.delete(record.id);
    return this.workflow(record.id);
  }

  /** Restart the visual workflow from validation; this never executes firmware. */
  async resetWorkflow(id) {
    const record = await this.get(id);
    this.clearWorkflowTimers(record.id);
    this.workflows.delete(record.id);
    return this.startWorkflow(record.id);
  }
}

export const supportedFirmwareExtensions = [...SUPPORTED_EXTENSIONS];
