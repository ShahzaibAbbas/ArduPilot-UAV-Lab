import type { ComponentDefinition, UavDesign } from "../domain/design";

export interface SystemStatus {
  sitl: {
    available: boolean;
    source?: "native" | "cygwin" | "wsl";
    path?: string;
    displayPath?: string;
    configPath?: string;
    root?: string;
    distro?: string;
    command?: string;
    notes: string[];
    searched?: string[];
  };
}

export interface SitlPlan {
  available: boolean;
  telemetry?: { host: string; port: number; bindHost?: string };
  gcsBridge?: {
    tcp: { host: string; port: number };
    outputs: Array<{ id?: string; name: string; host: string; port: number }>;
  };
  headless?: boolean;
  source?: "native" | "cygwin" | "wsl";
  commandLine: string;
  command?: string;
  args: string[];
  cwd: string;
  displayCwd?: string;
  paramFile?: string;
  outputs?: Array<{ id?: string; name: string; host: string; port: number }>;
  swarm?: {
    count: number;
    layout: "line" | "grid" | "circle";
    spacingM: number;
    vehicles: Array<{ index: number; sysid: number; x: number; y: number; heading: number }>;
  };
  notes: string[];
}

export interface SoftwareUpdateResult {
  updated: boolean;
  message: string;
  steps: Array<{ command: string; output: string }>;
}

export interface SetupDiagnostics {
  platform: string;
  ready: boolean;
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    detail?: string;
    fix?: string;
  }>;
}

export interface CustomComponentTemplate {
  id?: string;
  name: string;
  baseType: string;
  summary?: string;
  category?: ComponentDefinition["category"];
  properties: Record<string, string | number | boolean>;
  updatedAt?: string;
}

export interface ArtifactResult {
  fileName: string;
  content: string;
  mimeType: string;
}

export interface ParamExplanation {
  parameter: string;
  value: string;
  source: string;
  reason: string;
}

export interface BinaryArtifactResult {
  fileName: string;
  blob: Blob;
}

export type MavlinkCommandAction = "arm" | "disarm" | "takeoff" | "land" | "rtl" | "mode" | "custom";

export interface MavlinkCommandRequest {
  sysid: number;
  compid?: number;
  action: MavlinkCommandAction;
  mode?: string;
  altitudeM?: number;
  commandId?: number;
  params?: number[];
}

export interface MavlinkCommandResult {
  sent: boolean;
  label: string;
  command: number;
  target: {
    sysid: number;
    compid: number;
  };
  link: {
    host: string;
    port: number;
    localPort: number;
    lastPacketAt: string;
  };
  bytes: number;
  message: string;
}

export interface GazeboStatus {
  source?: "native" | "wsl";
  distro?: string;
  searched?: string[];
  supported: boolean;
  selected?: {
    kind: "classic" | "gz-sim";
    packageName: string;
    label: string;
    available: boolean;
    version?: string;
  };
  tools: Record<string, { available: boolean; command: string; version?: string }>;
  packages: Array<{
    kind: "classic" | "gz-sim";
    packageName: string;
    label: string;
    available: boolean;
    version?: string;
  }>;
  notes: string[];
}

export interface GazeboCompileResult {
  compiled: boolean;
  status: GazeboStatus;
  projectDir: string;
  buildDir: string;
  files: string[];
  steps: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>;
  message: string;
}

export interface TelemetryBattery {
  id?: number;
  source?: "SYS_STATUS" | "BATTERY_STATUS";
  receivedAt?: string;
  voltageV?: number;
  voltagesV?: number[];
  currentA?: number;
  remainingPercent?: number;
  consumedMah?: number;
  temperatureC?: number;
  timeRemainingS?: number;
  chargeState?: number;
  faultBitmask?: number;
}

/** A ground station link identified by its MAV_TYPE_GCS heartbeat. */
export interface GcsLinkStatus {
  transport: "udp" | "tcp";
  host: string;
  port: number;
  name: string;
  /** A client-mode GCS that registered by sending to the lab listener. */
  dynamic: boolean;
  sysid: number;
  compid: number;
  lastHeartbeatAt: string;
  connected: boolean;
}

export interface TelemetryStatus {
  gcsBridge?: {
    active: boolean;
    local?: { host: string; port: number };
    tcp: { host: string; port: number; listening: boolean; clients: number; error?: string };
    outputs: Array<{ id?: string; name: string; host: string; port: number; dynamic?: boolean; sentPackets?: number; receivedPackets?: number }>;
    upstreamConnected: boolean;
    upstream?: { host: string; port: number; lastPacketAt: string };
    forwardedToGcs: number;
    forwardedToSitl: number;
    droppedFrames: number;
    gcsLinks?: GcsLinkStatus[];
    warnings?: string[];
    error?: string;
  };
  listener: {
    active: boolean;
    host: string;
    port: number;
    pid?: number;
    startedAt?: string;
    lastPacketAt?: string;
    packetCount: number;
    byteCount: number;
    error?: string;
  };
  vehicles: Array<{
    id: string;
    sysid: number;
    compid: number;
    firstSeenAt: string;
    lastSeenAt?: string;
    messageCount: number;
    heartbeat?: {
      armed: boolean;
      baseMode: number;
      customMode?: number;
      type?: number;
      autopilot?: number;
      typeName: string;
      systemStatusName: string;
    };
    gps?: {
      lat?: number;
      lon?: number;
      altM?: number;
      groundSpeedMps?: number;
      fixType?: number;
      satellites?: number;
    };
    position?: {
      lat?: number;
      lon?: number;
      altM?: number;
      relativeAltM?: number;
      headingDeg?: number;
      vxMps?: number;
      vyMps?: number;
      vzMps?: number;
    };
    attitude?: {
      rollDeg?: number;
      pitchDeg?: number;
      yawDeg?: number;
    };
    vfrHud?: {
      airspeedMps?: number;
      groundspeedMps?: number;
      headingDeg?: number;
      throttlePercent?: number;
      altM?: number;
      climbMps?: number;
    };
    battery?: TelemetryBattery;
    batteries?: TelemetryBattery[];
    statusText?: {
      severity: number;
      text: string;
      receivedAt?: string;
      advice?: TelemetryAdvice;
    };
    statusHistory?: Array<{
      severity: number;
      text: string;
      receivedAt: string;
      advice?: TelemetryAdvice;
    }>;
    commandAck?: {
      command?: number;
      result: number;
      resultName: string;
      progress?: number;
      receivedAt: string;
    };
    link?: {
      host: string;
      port: number;
      localPort: number;
      lastPacketAt: string;
    };
  }>;
}

export interface TelemetryAdvice {
  category: "battery" | "failsafe" | "general";
  title: string;
  summary: string;
  steps: string[];
  recommendedAction?: "rtl" | "land";
  severityLabel: string;
}

export interface MissionSyncStatus {
  active: boolean;
  direction?: "upload" | "download";
  message: string;
  updatedAt?: string;
  target?: {
    sysid: number;
    compid: number;
  };
  uploadedCount: number;
  downloadedCount: number;
  expectedCount: number;
  missionText?: string;
}

export interface FirmwareRecord {
  id: string;
  originalName: string;
  safeStoredName: string;
  extension: ".apj" | ".bin" | ".hex" | ".elf";
  byteSize: number;
  sha256: string;
  uploadedAt: string;
  detectedFormat: string;
  metadata: {
    boardId?: number;
    boardRevision?: number;
    description?: string;
    vehicleType?: string;
    gitIdentity?: string;
    imageSize?: number;
    imageEncoding?: string;
    imageCompression?: string;
  };
  compatibility: {
    status: "compatible" | "review" | "incompatible" | "unknown";
    message: string;
  };
  selectedNode: {
    nodeId?: string;
    board?: string;
    componentType?: string;
  };
  linkedSitlVehicle?: string;
  warnings: string[];
}

export type FirmwareWorkflowState =
  | "EMPTY"
  | "VALIDATING"
  | "READY"
  | "ERASING"
  | "FLASHING"
  | "VERIFYING"
  | "BOOTING"
  | "RUNNING"
  | "FAILED"
  | "STOPPED";

export interface FirmwareWorkflow {
  firmwareId: string;
  state: FirmwareWorkflowState;
  progress: number;
  visualSimulation: true;
  startedAt?: string;
  elapsedMs: number;
  events: Array<{
    id: string;
    timestamp: string;
    state: FirmwareWorkflowState;
    progress: number;
    origin: "workflow simulation";
    message: string;
  }>;
}

export interface SitlProcessStatus {
  processes: number[];
  details: Array<{
    pid: number;
    startedAt: string;
    status: "running" | "stopping" | "exited" | "failed" | "stopped";
    vehicle: string;
    frame: string;
    source?: string;
    distro?: string;
    command?: string;
    telemetry?: { host: string; port: number };
    gcsBridge?: {
      tcp: { host: string; port: number };
      outputs: Array<{ id?: string; name?: string; host: string; port: number }>;
    };
    console?: {
      available: boolean;
      state: "starting" | "ready" | "unavailable" | "stopped" | string;
      reason?: string;
      lastOutputAt?: string;
      lineCount: number;
      error?: string;
    };
    exitCode?: number | null;
    signal?: string | null;
    error?: string;
    endedAt?: string;
    /** When sim_vehicle.py reported starting MAVProxy. */
    mavproxyStartedAt?: string;
    /** Set while MAVProxy runs but no vehicle heartbeat reaches the lab listener. */
    telemetryWarning?: string;
  }>;
  lastProcess?: SitlProcessStatus["details"][number];
  lastFailure?: { pid?: number; at: string; message: string; code?: string | number };
  events: Array<{
    id: string;
    timestamp: string;
    origin: "SITL";
    state: string;
    message: string;
    pid?: number;
    vehicle?: string;
    frame?: string;
  }>;
}

export interface SitlConsoleLine {
  at: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface SitlConsoleStatus {
  pid: number;
  available: boolean;
  state?: "starting" | "ready" | "unavailable" | "stopped" | string;
  reason?: string;
  error?: string;
  processStatus?: SitlProcessStatus["details"][number];
  lines: SitlConsoleLine[];
}

export interface TelemetryTraceEvent {
  id: number;
  receivedAt: string;
  direction: "rx" | "tx";
  protocol: "MAVLink1" | "MAVLink2";
  remote?: { host: string; port: number };
  local?: { host: string; port: number };
  datagramLength: number;
  frameLength: number;
  sequence: number;
  systemId: number;
  componentId: number;
  messageId: number;
  messageName: string;
  payloadLength: number;
  summary: string;
  correlation?: string;
  rawPreviewHex: string;
  checksumStatus?: "valid" | "invalid" | "unknown";
  signed?: boolean;
}

export interface TelemetryTraceStats {
  paused: boolean;
  count: number;
  approximateBytes: number;
  maxCount: number;
  maxBytes: number;
  droppedCount: number;
  newestId?: number;
  oldestId?: number;
  byDirection: { rx: number; tx: number };
  byMessageId: Array<{ messageId: number; messageName: string; count: number }>;
}

export interface TelemetryTraceFilters {
  direction?: "all" | "rx" | "tx";
  protocol?: "all" | "MAVLink1" | "MAVLink2";
  systemId?: string | number;
  componentId?: string | number;
  messageId?: string | number;
  text?: string;
  limit?: number;
}

export interface AppLogEntry {
  id: string;
  ts: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface TerminalResult {
  command: string;
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Local API request failed (${response.status}). Check that the server is running and its port matches the frontend proxy.`;
    throw new Error(message);
  }
  if (payload === null) throw new Error("The server returned an invalid response. Check the API port and restart the lab.");
  return payload as T;
}

export interface RuntimeStatus {
  checkedAt: string;
  api: { host: string; port: number; url: string; protocol: "http"; listening: boolean; pid: number };
  telemetry: TelemetryStatus["listener"] & { protocol: "udp"; pid?: number; gcsBridge?: TelemetryStatus["gcsBridge"] };
  gcsBridge?: TelemetryStatus["gcsBridge"];
  sitl: { running: boolean; processes: SitlProcessStatus["details"]; lastProcess?: SitlProcessStatus["lastProcess"]; lastFailure?: SitlProcessStatus["lastFailure"] };
}

export async function getRuntimeStatus() {
  return parseResponse<RuntimeStatus>(await fetch("/api/runtime", { signal: AbortSignal.timeout(8000) }));
}

export async function exitApplication() {
  return parseResponse<{ status: "shutting-down"; message: string }>(await fetch("/api/application/exit", {
    method: "POST", headers: { "X-UAV-Lab-Action": "exit" }, signal: AbortSignal.timeout(8000)
  }));
}

export async function stopSitlProcess(pid: number, signal = AbortSignal.timeout(8000)) {
  return parseResponse<{ stopped: number; status: "stopping" | "stopped" }>(await fetch(`/api/sitl/processes/${pid}`, { method: "DELETE", signal }));
}

function fileNameFromDisposition(value: string | null, fallback: string) {
  const match = value?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return match ? decodeURIComponent(match[1].replace(/^"|"$/g, "")) : fallback;
}

export async function getSystemStatus() {
  return parseResponse<SystemStatus>(await fetch("/api/system"));
}

export async function getSetupDiagnostics(simVehiclePath = "") {
  const query = new URLSearchParams({ simVehiclePath });
  return parseResponse<SetupDiagnostics>(await fetch(`/api/setup/diagnostics?${query}`));
}

export async function locateSimVehicle(simVehiclePath: string) {
  return parseResponse<SystemStatus>(
    await fetch("/api/sitl/locate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ simVehiclePath })
    })
  );
}

export async function saveDesign(design: UavDesign) {
  return parseResponse<{ design: UavDesign }>(
    await fetch("/api/designs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function listCustomComponents() {
  return parseResponse<{ components: CustomComponentTemplate[] }>(await fetch("/api/components/custom"));
}

export async function saveCustomComponent(component: CustomComponentTemplate) {
  return parseResponse<{ component: CustomComponentTemplate }>(
    await fetch("/api/components/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(component)
    })
  );
}

export async function deleteCustomComponent(id: string) {
  return parseResponse<{ deleted: string }>(
    await fetch(`/api/components/custom/${encodeURIComponent(id)}`, {
      method: "DELETE"
    })
  );
}

export async function listDesigns(query = "") {
  return parseResponse<{ designs: UavDesign[] }>(await fetch(`/api/designs?q=${encodeURIComponent(query)}&limit=100`, { signal: AbortSignal.timeout(10000) }));
}

export async function buildParamFile(design: UavDesign) {
  return parseResponse<{ fileName: string; content: string }>(
    await fetch("/api/export/params", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildMissionFile(design: UavDesign) {
  return parseResponse<ArtifactResult>(
    await fetch("/api/export/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildPrearmFile(design: UavDesign) {
  return parseResponse<ArtifactResult>(
    await fetch("/api/export/prearm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildBomCsvFile(design: UavDesign) {
  return parseResponse<ArtifactResult>(
    await fetch("/api/export/bom/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildBomHtmlFile(design: UavDesign) {
  return parseResponse<ArtifactResult>(
    await fetch("/api/export/bom/html", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildJsonBridgeFile(design: UavDesign) {
  return parseResponse<ArtifactResult>(
    await fetch("/api/export/json-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildGazeboWorldFile(design: UavDesign) {
  return parseResponse<ArtifactResult>(
    await fetch("/api/export/gazebo-world", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function buildSimulatorBundle(design: UavDesign) {
  const response = await fetch("/api/export/bundle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(design)
  });
  if (!response.ok) {
    await parseResponse(response);
  }
  return {
    fileName: fileNameFromDisposition(response.headers.get("Content-Disposition"), "simulator-bundle.zip"),
    blob: await response.blob()
  } satisfies BinaryArtifactResult;
}

export async function buildSitlPlan(design: UavDesign) {
  return parseResponse<{ plan: SitlPlan }>(
    await fetch("/api/sitl/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function explainParamFile(design: UavDesign) {
  return parseResponse<{ explanations: ParamExplanation[] }>(
    await fetch("/api/export/params/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function launchSitl(design: UavDesign) {
  return parseResponse<{ pid: number; plan: SitlPlan }>(
    await fetch("/api/sitl/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function getSitlProcesses(signal = AbortSignal.timeout(8000)) {
  return parseResponse<SitlProcessStatus>(await fetch("/api/sitl/processes", { signal }));
}

export async function getSitlConsole(pid: number, signal = AbortSignal.timeout(8000)) {
  return parseResponse<SitlConsoleStatus>(await fetch(`/api/sitl/processes/${pid}/console`, { signal }));
}

export async function sendSitlConsoleInput(pid: number, input: string) {
  return parseResponse<{ pid: number; accepted: boolean; inputLength: number }>(
    await fetch(`/api/sitl/processes/${pid}/console`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input })
    })
  );
}

export async function clearSitlConsole(pid: number) {
  return parseResponse<{ pid: number; cleared: boolean }>(
    await fetch(`/api/sitl/processes/${pid}/console`, { method: "DELETE" })
  );
}

export async function listFirmware() {
  return parseResponse<{
    firmware: FirmwareRecord[];
    uploadLimitBytes: number;
    executionPolicy: string;
  }>(await fetch("/api/firmware"));
}

export async function uploadFirmware(
  file: File,
  target: {
    selectedNodeId?: string;
    selectedBoard?: string;
    selectedComponentType?: string;
    linkedVehicle?: string;
  }
) {
  const query = new URLSearchParams({ name: file.name });
  for (const [key, value] of Object.entries(target)) {
    if (value) query.set(key, value);
  }
  return parseResponse<{ firmware: FirmwareRecord; uploadLimitBytes: number }>(
    await fetch(`/api/firmware?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file
    })
  );
}

export async function deleteFirmware(id: string) {
  return parseResponse<{ deleted: string }>(
    await fetch(`/api/firmware/${encodeURIComponent(id)}`, {
      method: "DELETE"
    })
  );
}

export async function attachFirmware(
  id: string,
  target: { selectedNodeId: string; selectedBoard?: string; selectedComponentType: string; linkedVehicle?: string }
) {
  return parseResponse<{ firmware: FirmwareRecord }>(
    await fetch(`/api/firmware/${encodeURIComponent(id)}/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target)
    })
  );
}

export async function getFirmwareWorkflow(id: string) {
  return parseResponse<{ workflow: FirmwareWorkflow }>(await fetch(`/api/firmware/${encodeURIComponent(id)}/workflow`));
}

export async function startFirmwareWorkflow(id: string) {
  return parseResponse<{ workflow: FirmwareWorkflow }>(
    await fetch(`/api/firmware/${encodeURIComponent(id)}/workflow/start`, { method: "POST" })
  );
}

export async function stopFirmwareWorkflow(id: string) {
  return parseResponse<{ workflow: FirmwareWorkflow }>(
    await fetch(`/api/firmware/${encodeURIComponent(id)}/workflow/stop`, { method: "POST" })
  );
}

export async function wipeFirmwareWorkflow(id: string) {
  return parseResponse<{ workflow: FirmwareWorkflow }>(
    await fetch(`/api/firmware/${encodeURIComponent(id)}/workflow/wipe`, { method: "POST" })
  );
}

export async function resetFirmwareWorkflow(id: string) {
  return parseResponse<{ workflow: FirmwareWorkflow }>(
    await fetch(`/api/firmware/${encodeURIComponent(id)}/workflow/reset`, { method: "POST" })
  );
}

export async function getTelemetryStatus() {
  return parseResponse<TelemetryStatus>(await fetch("/api/telemetry", { signal: AbortSignal.timeout(6000) }));
}

function traceQuery(filters: TelemetryTraceFilters = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all") {
      query.set(key, String(value));
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export async function getTelemetryTrace(filters: TelemetryTraceFilters = {}) {
  return parseResponse<{ events: TelemetryTraceEvent[]; stats: TelemetryTraceStats }>(
    await fetch(`/api/telemetry/trace${traceQuery(filters)}`)
  );
}

export async function getTelemetryTraceStats() {
  return parseResponse<TelemetryTraceStats>(await fetch("/api/telemetry/trace/stats"));
}

export async function clearTelemetryTrace() {
  return parseResponse<{ cleared: number; stats: TelemetryTraceStats }>(
    await fetch("/api/telemetry/trace/clear", { method: "POST" })
  );
}

export async function setTelemetryTracePaused(paused: boolean) {
  return parseResponse<TelemetryTraceStats>(
    await fetch(`/api/telemetry/trace/${paused ? "pause" : "resume"}`, { method: "POST" })
  );
}

export async function exportTelemetryTrace(format: "json" | "csv", filters: TelemetryTraceFilters = {}) {
  const query = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== "all") {
      query.set(key, String(value));
    }
  }
  const response = await fetch(`/api/telemetry/trace/export?${query.toString()}`);
  if (!response.ok) {
    await parseResponse(response);
  }
  return {
    fileName: fileNameFromDisposition(response.headers.get("Content-Disposition"), `telemetry.mavtrace.${format}`),
    blob: await response.blob()
  } satisfies BinaryArtifactResult;
}

export async function startTelemetryListener(port: number, host = "127.0.0.1") {
  return parseResponse<TelemetryStatus>(
    await fetch("/api/telemetry/listener", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port, host })
    })
  );
}

export async function stopTelemetryListener() {
  return parseResponse<TelemetryStatus>(
    await fetch("/api/telemetry/listener", {
      method: "DELETE"
    })
  );
}

export async function sendMavlinkCommand(command: MavlinkCommandRequest) {
  return parseResponse<MavlinkCommandResult>(
    await fetch("/api/telemetry/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command)
    })
  );
}

export async function getMissionStatus(signal?: AbortSignal) {
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000);
  return parseResponse<{ mission: MissionSyncStatus }>(await fetch("/api/mission/status", { signal: requestSignal }));
}

export async function uploadMission(sysid: number, compid: number | undefined, missionText: string) {
  return parseResponse<{ mission: MissionSyncStatus }>(
    await fetch("/api/mission/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sysid, compid, missionText })
    })
  );
}

export async function downloadMission(sysid: number, compid?: number) {
  return parseResponse<{ mission: MissionSyncStatus }>(
    await fetch("/api/mission/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sysid, compid })
    })
  );
}

export async function getGazeboStatus() {
  return parseResponse<GazeboStatus>(await fetch("/api/gazebo/status"));
}

export async function compileGazeboPlugins(design: UavDesign) {
  return parseResponse<GazeboCompileResult>(
    await fetch("/api/gazebo/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function getLogs(limit = 200) {
  return parseResponse<{ logs: AppLogEntry[] }>(await fetch(`/api/logs?limit=${limit}`));
}

export async function clearLogs() {
  return parseResponse<{ cleared: boolean }>(
    await fetch("/api/logs", {
      method: "DELETE"
    })
  );
}

export async function runTerminalCommand(command: string) {
  return parseResponse<TerminalResult>(
    await fetch("/api/terminal/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command })
    })
  );
}

export async function updateSoftware() {
  return parseResponse<SoftwareUpdateResult>(
    await fetch("/api/software/update", {
      method: "POST"
    })
  );
}
