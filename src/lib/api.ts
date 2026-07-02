import type { ComponentDefinition, UavDesign } from "../domain/design";

export interface SystemStatus {
  sitl: {
    available: boolean;
    path?: string;
    command?: string;
    notes: string[];
  };
}

export interface SitlPlan {
  available: boolean;
  commandLine: string;
  command?: string;
  args: string[];
  cwd: string;
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

export interface TelemetryStatus {
  listener: {
    active: boolean;
    host: string;
    port: number;
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
    battery?: {
      voltageV?: number;
      currentA?: number;
      remainingPercent?: number;
    };
    statusText?: {
      severity: number;
      text: string;
    };
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function fileNameFromDisposition(value: string | null, fallback: string) {
  const match = value?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  return match ? decodeURIComponent(match[1].replace(/^"|"$/g, "")) : fallback;
}

export async function getSystemStatus() {
  return parseResponse<SystemStatus>(await fetch("/api/system"));
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

export async function listDesigns() {
  return parseResponse<{ designs: UavDesign[] }>(await fetch("/api/designs"));
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

export async function launchSitl(design: UavDesign) {
  return parseResponse<{ pid: number; plan: SitlPlan }>(
    await fetch("/api/sitl/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(design)
    })
  );
}

export async function getTelemetryStatus() {
  return parseResponse<TelemetryStatus>(await fetch("/api/telemetry"));
}

export async function startTelemetryListener(port: number) {
  return parseResponse<TelemetryStatus>(
    await fetch("/api/telemetry/listener", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port })
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
