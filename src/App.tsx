import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  reconnectEdge,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeProps
} from "@xyflow/react";
import {
  AlertTriangle,
  Battery,
  Boxes,
  Camera,
  CheckCircle2,
  CircleDot,
  Compass,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FilePlus,
  FileJson,
  FolderOpen,
  Gauge,
  GitBranch,
  Link2,
  MapPin,
  Pencil,
  Play,
  Plus,
  Radio,
  Radar,
  RefreshCw,
  RotateCcw,
  Rotate3D,
  Save,
  ScanLine,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Terminal,
  Trash2,
  Redo2,
  Undo2,
  Wind,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { defaultSettings, type ComponentDefinition, type ComponentPropertyDefinition } from "./domain/design";
import type { DesignEdge, DesignNode, GcsTargetSettings, SignalKind, SimulationSettings, UavDesign } from "./domain/design";
import {
  componentCatalog,
  createComponentNode,
  defaultPropertiesForComponent,
  getComponentDefinition,
  getPort,
  productSpecProperties
} from "./domain/componentCatalog";
import { createStarterDesign } from "./domain/starterDesign";
import { productTemplates } from "./domain/productTemplates";
import { componentCompatibilityMessage, expectedMotorCount, validateDesign } from "./domain/validators";
import { airframeLabel, airframeOptions, normalizeAirframeValue, rotorCountForFrame } from "./domain/airframes";
import {
  buildBomCsvFile,
  buildBomHtmlFile,
  buildGazeboWorldFile,
  buildJsonBridgeFile,
  buildMissionFile,
  buildParamFile,
  buildPrearmFile,
  buildSimulatorBundle,
  buildSitlPlan,
  clearLogs,
  compileGazeboPlugins,
  deleteCustomComponent,
  downloadMission,
  explainParamFile,
  getGazeboStatus,
  getLogs,
  getMissionStatus,
  getSetupDiagnostics,
  getTelemetryStatus,
  getSystemStatus,
  launchSitl,
  listCustomComponents,
  locateSimVehicle,
  saveDesign,
  saveCustomComponent,
  sendMavlinkCommand,
  runTerminalCommand,
  startTelemetryListener,
  stopTelemetryListener,
  uploadMission,
  updateSoftware,
  type AppLogEntry,
  type ArtifactResult,
  type CustomComponentTemplate,
  type GazeboCompileResult,
  type GazeboStatus,
  type MissionSyncStatus,
  type MavlinkCommandRequest,
  type ParamExplanation,
  type SetupDiagnostics,
  type SitlPlan,
  type SystemStatus,
  type TerminalResult,
  type TelemetryStatus
} from "./lib/api";

const iconMap = {
  AlertTriangle,
  Battery,
  Boxes,
  Camera,
  CheckCircle2,
  CircleDot,
  Compass,
  Cpu,
  Gauge,
  MapPin,
  Radio,
  Radar,
  Rotate3D,
  ScanLine,
  ShieldCheck,
  Siren,
  Wind,
  Zap,
  Frame: Boxes
};

type AppTab =
  | "inspector"
  | "validation"
  | "simulation"
  | "mission"
  | "telemetry"
  | "logs"
  | "terminal"
  | "performance"
  | "bom"
  | "params"
  | "compare";
type ObjectContextMenu =
  | { kind: "node"; nodeId: string; x: number; y: number }
  | { kind: "edge"; edgeId: string; x: number; y: number };
type HoveredConnection = { edgeId: string; x: number; y: number };

const NODE_CARD_WIDTH = 196;
const NODE_CARD_MIN_HEIGHT = 142;
const NODE_PLACEMENT_GAP = 34;
const NODE_PORT_TOP = 96;
const SIGNAL_KINDS: SignalKind[] = ["power", "pwm", "uart", "i2c", "can", "analog", "video", "mount", "telemetry"];
const signalColors: Record<SignalKind, string> = {
  power: "#c56b21",
  pwm: "#2d6cdf",
  uart: "#138a83",
  i2c: "#258a47",
  can: "#475569",
  analog: "#7d5fb2",
  video: "#bd3d78",
  mount: "#6b7280",
  telemetry: "#0f766e"
};

const SAQ_FORMAT = "ardupilot-uav-lab.workspace";
const SAQ_VERSION = 1;
const HISTORY_LIMIT = 100;

interface SaqWorkspaceFile {
  format: typeof SAQ_FORMAT;
  version: typeof SAQ_VERSION;
  savedAt: string;
  design: UavDesign;
}

interface WorkspaceSnapshot {
  id?: string;
  name: string;
  nodes: DesignNode[];
  edges: DesignEdge[];
  settings: SimulationSettings;
}

interface WorkspaceHistoryEntry {
  snapshot: WorkspaceSnapshot;
  serialized: string;
}

type SaveTextResult = "saved" | "downloaded" | "cancelled";

type NativeFileWritable = {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
};

type NativeFileHandle = {
  createWritable: () => Promise<NativeFileWritable>;
};

type NativeSaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<NativeFileHandle>;

function signalLabel(signal: SignalKind) {
  return signal.toUpperCase();
}

function safeFileName(value: string) {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "uav-space";
}

function downloadText(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(fileName, blob);
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadArtifact(artifact: ArtifactResult) {
  downloadText(artifact.fileName, artifact.content, artifact.mimeType);
}

function extensionForFileName(fileName: string) {
  const match = fileName.match(/\.[^.]+$/);
  return match?.[0] ?? ".txt";
}

function isSaveCancelled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function filePickerOptions(fileName: string, mimeType: string, description: string) {
  return {
    suggestedName: fileName,
    types: [
      {
        description,
        accept: {
          [mimeType]: [extensionForFileName(fileName)]
        }
      }
    ]
  };
}

async function saveTextToUserFile(fileName: string, content: string, mimeType: string, description: string): Promise<SaveTextResult> {
  const savePicker = (window as Window & { showSaveFilePicker?: NativeSaveFilePicker }).showSaveFilePicker;

  if (typeof savePicker === "function") {
    try {
      const handle = await savePicker(filePickerOptions(fileName, mimeType, description));
      const writable = await handle.createWritable();
      await writable.write(new Blob([content], { type: mimeType }));
      await writable.close();
      return "saved";
    } catch (error) {
      if (isSaveCancelled(error)) {
        return "cancelled";
      }
      throw error;
    }
  }

  downloadText(fileName, content, mimeType);
  return "downloaded";
}

async function saveGeneratedTextToUserFile(
  fileName: string,
  mimeType: string,
  description: string,
  createContent: () => Promise<string>
): Promise<SaveTextResult> {
  const savePicker = (window as Window & { showSaveFilePicker?: NativeSaveFilePicker }).showSaveFilePicker;

  if (typeof savePicker === "function") {
    try {
      const handle = await savePicker(filePickerOptions(fileName, mimeType, description));
      const content = await createContent();
      const writable = await handle.createWritable();
      await writable.write(new Blob([content], { type: mimeType }));
      await writable.close();
      return "saved";
    } catch (error) {
      if (isSaveCancelled(error)) {
        return "cancelled";
      }
      throw error;
    }
  }

  const content = await createContent();
  downloadText(fileName, content, mimeType);
  return "downloaded";
}

function distanceKmBetween(left: { lat: number; lon: number }, right: { lat: number; lon: number }) {
  const earthRadiusKm = 6371;
  const latA = (left.lat * Math.PI) / 180;
  const latB = (right.lat * Math.PI) / 180;
  const deltaLat = ((right.lat - left.lat) * Math.PI) / 180;
  const deltaLon = ((right.lon - left.lon) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function missionDistanceFromText(content: string) {
  const waypoints: Array<{ lat: number; lon: number }> = [];
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("QGC") || trimmed.startsWith("#")) {
      continue;
    }

    const columns = trimmed.split(/\s+/);
    if (columns.length < 11) {
      continue;
    }

    const command = Number(columns[3]);
    const lat = Number(columns[8]);
    const lon = Number(columns[9]);
    if ([16, 22, 82].includes(command) && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      waypoints.push({ lat, lon });
    }
  }

  if (waypoints.length < 2) {
    return 0;
  }

  return waypoints.slice(1).reduce((sum, waypoint, index) => sum + distanceKmBetween(waypoints[index], waypoint), 0);
}

function designFromState(
  name: string,
  nodes: DesignNode[],
  edges: DesignEdge[],
  settings: SimulationSettings,
  id?: string
): UavDesign {
  return {
    id,
    name,
    nodes,
    edges,
    settings
  };
}

function cleanHistoryNode(node: DesignNode): DesignNode {
  return {
    id: node.id,
    type: "componentNode",
    position: { ...node.position },
    data: {
      componentType: node.data.componentType,
      label: node.data.label,
      properties: { ...node.data.properties }
    },
    selected: false
  };
}

function cleanHistoryEdge(edge: DesignEdge): DesignEdge {
  return {
    ...edge,
    data: edge.data ? { ...edge.data } : undefined,
    selected: false
  };
}

function cloneWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    id: snapshot.id,
    name: snapshot.name,
    nodes: snapshot.nodes.map(cleanHistoryNode),
    edges: snapshot.edges.map(cleanHistoryEdge),
    settings: settingsWithDefaults(snapshot.settings)
  };
}

function createWorkspaceSnapshot(
  id: string | undefined,
  name: string,
  nodes: DesignNode[],
  edges: DesignEdge[],
  settings: SimulationSettings
): WorkspaceSnapshot {
  return cloneWorkspaceSnapshot({
    id,
    name,
    nodes,
    edges,
    settings
  });
}

function createHistoryEntry(snapshot: WorkspaceSnapshot): WorkspaceHistoryEntry {
  const cleanSnapshot = cloneWorkspaceSnapshot(snapshot);
  const { id: _id, ...serializableSnapshot } = cleanSnapshot;
  return {
    snapshot: cleanSnapshot,
    serialized: JSON.stringify(serializableSnapshot)
  };
}

function FrameLayoutIcon({ frame, size = 24 }: { frame?: string; size?: number }) {
  const normalizedFrame = normalizeAirframeValue(frame);

  if (normalizedFrame === "fixed-wing") {
    return (
      <svg className="frame-layout-icon frame-layout-icon-plane" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M16 4 L19 14 L29 17 L20 20 L18 28 L16 24 L14 28 L12 20 L3 17 L13 14 Z" />
      </svg>
    );
  }

  if (normalizedFrame === "rover") {
    return (
      <svg className="frame-layout-icon frame-layout-icon-rover" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect x="7" y="12" width="18" height="9" rx="3" />
        <circle cx="10" cy="24" r="3" />
        <circle cx="22" cy="24" r="3" />
        <path d="M12 12 L16 8 L21 12" />
      </svg>
    );
  }

  const rotorCount = rotorCountForFrame(normalizedFrame);
  const rotorRadius = rotorCount > 16 ? 1.2 : rotorCount > 8 ? 1.55 : 2.25;
  const showArms = rotorCount <= 12;
  const points = Array.from({ length: Math.max(1, rotorCount) }, (_, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, rotorCount)) * Math.PI * 2;
    const radius = rotorCount === 1 ? 0 : 11.5;
    return {
      x: 16 + Math.cos(angle) * radius,
      y: 16 + Math.sin(angle) * radius
    };
  });

  return (
    <svg className="frame-layout-icon frame-layout-icon-rotor" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      {showArms
        ? points.map((point, index) => <line className="frame-arm" key={`arm-${index}`} x1="16" y1="16" x2={point.x} y2={point.y} />)
        : null}
      {points.map((point, index) => (
        <circle className="frame-rotor" key={`rotor-${index}`} cx={point.x} cy={point.y} r={rotorRadius} />
      ))}
      <circle className="frame-body" cx="16" cy="16" r="5" />
      <text className="frame-count" x="16" y="18.8">
        {rotorCount}
      </text>
    </svg>
  );
}

function ObjectShape({ componentType, icon: Icon, frameLayout }: { componentType: string; icon: LucideIcon; frameLayout?: string }) {
  if (componentType === "frame") {
    return (
      <div className="object-shape object-shape-frame" aria-hidden="true">
        <FrameLayoutIcon frame={frameLayout} size={38} />
      </div>
    );
  }

  return (
    <div className={`object-shape object-shape-${componentType}`} aria-hidden="true">
      <span className="shape-arm shape-arm-a" />
      <span className="shape-arm shape-arm-b" />
      <span className="shape-plate" />
      <span className="shape-lens" />
      <Icon size={24} />
    </div>
  );
}

function ComponentNode({ data, selected }: NodeProps<DesignNode>) {
  const definition = getComponentDefinition(data.componentType);
  const Icon = iconMap[definition.icon as keyof typeof iconMap] ?? Boxes;
  const frameLayout = data.componentType === "frame" ? String(data.properties.layout ?? "quad-x") : undefined;
  const inputPorts = definition.ports.filter((port) => port.direction === "input");
  const outputPorts = definition.ports.filter((port) => port.direction === "output");
  const editObject = typeof data.onEdit === "function" ? (data.onEdit as () => void) : undefined;
  const portRows = Math.max(inputPorts.length, outputPorts.length, 1);
  const minHeight = Math.max(NODE_CARD_MIN_HEIGHT, NODE_PORT_TOP + portRows * 20 + 18);

  return (
    <div className={`component-node node-shape-${data.componentType} ${selected ? "selected" : ""} ${data.health ?? "ok"}`} style={{ minHeight }}>
      <div className="node-header">
        <span className="node-icon">
          {frameLayout ? <FrameLayoutIcon frame={frameLayout} size={17} /> : <Icon size={16} />}
        </span>
        <span className="node-title">{data.label}</span>
        {editObject ? (
          <button
            aria-label="Edit object"
            className="node-action nodrag"
            title="Edit object"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              editObject();
            }}
          >
            <Pencil size={13} />
          </button>
        ) : null}
      </div>
      <div className="node-meta">{definition.category}</div>
      <div className="node-object-shape">
        <ObjectShape componentType={data.componentType} icon={Icon} frameLayout={frameLayout} />
      </div>

      {inputPorts.map((port, index) => (
        <div
          className={`node-port input ${port.kind}`}
          key={port.id}
          style={{ top: NODE_PORT_TOP + index * 20 }}
          title={`${port.label} ${port.kind}`}
        >
          <span>{port.label}</span>
          <Handle className={`flow-handle ${port.kind}`} id={port.id} position={Position.Left} type="target" />
        </div>
      ))}

      {outputPorts.map((port, index) => (
        <div
          className={`node-port output ${port.kind}`}
          key={port.id}
          style={{ top: NODE_PORT_TOP + index * 20 }}
          title={`${port.label} ${port.kind}`}
        >
          <span>{port.label}</span>
          <Handle className={`flow-handle ${port.kind}`} id={port.id} position={Position.Right} type="source" />
        </div>
      ))}
    </div>
  );
}

const nodeTypes = { componentNode: ComponentNode };

function propertyInput(
  property: ComponentPropertyDefinition,
  value: string | number | boolean,
  onChange: (value: string | number | boolean) => void
) {
  if (property.type === "select") {
    return (
      <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
        {property.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === "boolean") {
    return (
      <label className="toggle-row">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{Boolean(value) ? "Enabled" : "Disabled"}</span>
      </label>
    );
  }

  return (
    <input
      type={property.type === "number" ? "number" : "text"}
      min={property.min}
      max={property.max}
      value={String(value)}
      onChange={(event) => onChange(property.type === "number" ? Number(event.target.value) : event.target.value)}
    />
  );
}

function nodesByType(nodes: DesignNode[], type: string) {
  return nodes.filter((node) => node.data.componentType === type);
}

function firstNodeByType(nodes: DesignNode[], type: string) {
  return nodes.find((node) => node.data.componentType === type);
}

function customComponentSummary(component: CustomComponentTemplate) {
  if (component.summary) {
    return component.summary;
  }

  try {
    return getComponentDefinition(component.baseType).name;
  } catch {
    return component.baseType;
  }
}

function estimatedNodeHeight(componentType: string) {
  const definition = getComponentDefinition(componentType);
  const inputCount = definition.ports.filter((port) => port.direction === "input").length;
  const outputCount = definition.ports.filter((port) => port.direction === "output").length;
  return Math.max(NODE_CARD_MIN_HEIGHT, NODE_PORT_TOP + Math.max(inputCount, outputCount, 1) * 20 + 18);
}

function nodeRect(node: Pick<DesignNode, "position" | "data">) {
  return {
    x: node.position.x,
    y: node.position.y,
    width: NODE_CARD_WIDTH,
    height: estimatedNodeHeight(node.data.componentType)
  };
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number
) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function findOpenNodePosition(nodes: DesignNode[], componentType: string, preferred?: { x: number; y: number }) {
  const existingRects = nodes.map(nodeRect);
  const height = estimatedNodeHeight(componentType);
  const isOpen = (position: { x: number; y: number }) => {
    const candidate = { x: position.x, y: position.y, width: NODE_CARD_WIDTH, height };
    return existingRects.every((existing) => !rectsOverlap(candidate, existing, NODE_PLACEMENT_GAP));
  };

  if (preferred && isOpen(preferred)) {
    return preferred;
  }

  const startX = 80;
  const startY = 40;
  const stepX = NODE_CARD_WIDTH + NODE_PLACEMENT_GAP + 30;
  const stepY = Math.max(estimatedNodeHeight("flight-controller"), height) + NODE_PLACEMENT_GAP + 20;
  const rightMost = existingRects.reduce((max, rect) => Math.max(max, rect.x + rect.width), 900);
  const columns = Math.max(5, Math.ceil((rightMost - startX + stepX) / stepX) + 2);

  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const position = { x: startX + column * stepX, y: startY + row * stepY };
      if (isOpen(position)) {
        return position;
      }
    }
  }

  const lowest = existingRects.reduce((max, rect) => Math.max(max, rect.y + rect.height), startY);
  return { x: startX, y: lowest + NODE_PLACEMENT_GAP + 20 };
}

function signalForEdge(edge: DesignEdge, nodes: DesignNode[]): SignalKind | undefined {
  if (edge.data?.signal) {
    return edge.data.signal;
  }

  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) {
    return undefined;
  }

  const sourcePort = getPort(source.data.componentType, edge.sourceHandle);
  const targetPort = getPort(target.data.componentType, edge.targetHandle);

  if (sourcePort?.kind && sourcePort.kind === targetPort?.kind) {
    return sourcePort.kind;
  }

  return sourcePort?.kind ?? targetPort?.kind;
}

function portText(label?: string | null, fallback = "port") {
  return label?.trim() || fallback;
}

function connectionDetails(edge: DesignEdge, nodes: DesignNode[]) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  const sourcePort = source ? getPort(source.data.componentType, edge.sourceHandle) : undefined;
  const targetPort = target ? getPort(target.data.componentType, edge.targetHandle) : undefined;
  const signal = signalForEdge(edge, nodes);
  const sourceName = source?.data.label ?? edge.source;
  const targetName = target?.data.label ?? edge.target;
  const sourcePortName = portText(sourcePort?.label, edge.sourceHandle ?? "source");
  const targetPortName = portText(targetPort?.label, edge.targetHandle ?? "target");
  const sourceSignal = sourcePort?.kind ?? "unknown";
  const targetSignal = targetPort?.kind ?? "unknown";
  const issues = edge.data?.issues ?? [];

  return {
    signal,
    label: signal ? signalLabel(signal) : "LINK",
    title: `${sourceName} -> ${targetName}`,
    route: `${sourceName} ${sourcePortName} -> ${targetName} ${targetPortName}`,
    sourceName,
    targetName,
    sourcePortName,
    targetPortName,
    sourceDetail: `${sourcePort?.direction ?? "source"} / ${sourceSignal}`,
    targetDetail: `${targetPort?.direction ?? "target"} / ${targetSignal}`,
    summary: signal ? `${signalLabel(signal)} ${sourceSignal === targetSignal ? "signal" : "route"}` : "Connection",
    issues
  };
}

function connectionTooltip(edge: DesignEdge, nodes: DesignNode[]) {
  const details = connectionDetails(edge, nodes);
  return [details.title, details.route, `${details.sourceDetail} -> ${details.targetDetail}`, ...details.issues].join("\n");
}

function checkPortConnection(connection: Connection | DesignEdge, nodes: DesignNode[]) {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return { valid: false, message: "Choose a source output and target input port." };
  }

  if (connection.source === connection.target) {
    return { valid: false, message: "A component cannot connect to itself." };
  }

  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) {
    return { valid: false, message: "Choose components that still exist in the workspace." };
  }

  const sourcePort = getPort(source.data.componentType, connection.sourceHandle);
  const targetPort = getPort(target.data.componentType, connection.targetHandle);
  if (!sourcePort || !targetPort) {
    return { valid: false, message: "Choose defined source and target ports." };
  }

  if (sourcePort.direction !== "output" || targetPort.direction !== "input") {
    return { valid: false, message: "Connections must run from an output port into an input port." };
  }

  if (sourcePort.kind !== targetPort.kind) {
    return { valid: false, message: `${sourcePort.kind.toUpperCase()} cannot connect to ${targetPort.kind.toUpperCase()}.` };
  }

  const componentMessage = componentCompatibilityMessage(
    source.data.componentType,
    target.data.componentType,
    connection.sourceHandle,
    connection.targetHandle
  );
  if (componentMessage) {
    return { valid: false, message: componentMessage };
  }

  return { valid: true, message: "Connection valid" };
}

function sameConnection(a: Connection | DesignEdge, b: Connection | DesignEdge) {
  return (
    a.source === b.source &&
    a.target === b.target &&
    (a.sourceHandle ?? null) === (b.sourceHandle ?? null) &&
    (a.targetHandle ?? null) === (b.targetHandle ?? null)
  );
}

function anchoredLayerPosition(point: { clientX?: number; clientY?: number; x?: number; y?: number }, width: number, height: number, offset = 8) {
  const x = point.clientX ?? point.x ?? offset;
  const y = point.clientY ?? point.y ?? offset;
  return {
    x: Math.max(offset, Math.min(x + offset, window.innerWidth - width - offset)),
    y: Math.max(offset, Math.min(y + offset, window.innerHeight - height - offset))
  };
}

function isTextEditingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true'], .nokey"));
}

function targetDefaults(settings: SimulationSettings): GcsTargetSettings[] {
  return settings.gcsTargets?.length
    ? settings.gcsTargets
    : [
        { id: "qgc", name: "QGroundControl", enabled: true, host: settings.gcsHost || "127.0.0.1", port: settings.gcsPort || 14550 },
        { id: "mission-planner", name: "Mission Planner", enabled: true, host: "127.0.0.1", port: 14551 }
      ];
}

function settingsWithDefaults(settings?: Partial<SimulationSettings>): SimulationSettings {
  const merged = { ...defaultSettings, ...(settings ?? {}) } as SimulationSettings;
  return {
    ...merged,
    frame: normalizeAirframeValue(merged.frame),
    gcsTargets: targetDefaults(merged).map((target) => ({ ...target }))
  };
}

function normalizeNode(rawNode: unknown): DesignNode | null {
  if (!rawNode || typeof rawNode !== "object") {
    return null;
  }

  const node = rawNode as Partial<DesignNode>;
  const data = node.data as Partial<DesignNode["data"]> | undefined;
  const componentType = typeof data?.componentType === "string" ? data.componentType : "";
  const position = node.position ?? { x: 80, y: 40 };

  try {
    const definition = getComponentDefinition(componentType);
    const properties = {
      ...defaultPropertiesForComponent(componentType),
      ...(data?.properties && typeof data.properties === "object" ? data.properties : {})
    };
    if (componentType === "frame" && typeof properties.layout === "string") {
      properties.layout = normalizeAirframeValue(properties.layout);
    }
    return {
      ...node,
      id: typeof node.id === "string" && node.id ? node.id : `${componentType}-${crypto.randomUUID()}`,
      type: "componentNode",
      position: {
        x: Number(position.x) || 0,
        y: Number(position.y) || 0
      },
      selected: false,
      data: {
        componentType,
        label: typeof data?.label === "string" && data.label ? data.label : definition.name,
        properties
      }
    } as DesignNode;
  } catch {
    return null;
  }
}

function normalizeDesignPayload(payload: unknown, fallbackName = "Loaded Space"): UavDesign {
  if (!payload || typeof payload !== "object") {
    throw new Error("The selected file is not a valid SAQ workspace.");
  }

  const candidate = payload as Partial<SaqWorkspaceFile> & Partial<UavDesign>;
  const rawDesign = candidate.format === SAQ_FORMAT ? candidate.design : candidate;

  if (!rawDesign || typeof rawDesign !== "object") {
    throw new Error("The selected SAQ file does not contain a workspace design.");
  }

  const design = rawDesign as Partial<UavDesign>;
  const nodes = Array.isArray(design.nodes) ? design.nodes.map(normalizeNode).filter((node): node is DesignNode => Boolean(node)) : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(design.edges)
    ? design.edges
        .filter((edge): edge is DesignEdge => Boolean(edge?.source && edge?.target && nodeIds.has(edge.source) && nodeIds.has(edge.target)))
        .map((edge) => ({
          ...edge,
          type: edge.type ?? "smoothstep",
          markerEnd: edge.markerEnd ?? { type: MarkerType.ArrowClosed }
        }))
    : [];

  return {
    id: typeof design.id === "string" ? design.id : undefined,
    name: typeof design.name === "string" && design.name.trim() ? design.name : fallbackName,
    nodes,
    edges,
    settings: settingsWithDefaults(design.settings as Partial<SimulationSettings> | undefined),
    updatedAt: typeof design.updatedAt === "string" ? design.updatedAt : undefined
  };
}

function saqWorkspaceFor(design: UavDesign): SaqWorkspaceFile {
  return {
    format: SAQ_FORMAT,
    version: SAQ_VERSION,
    savedAt: new Date().toISOString(),
    design: {
      ...design,
      updatedAt: new Date().toISOString()
    }
  };
}

interface BuildGuideStep {
  componentType: string;
  placement: string;
  optional?: boolean;
  target: (settings: SimulationSettings) => number;
}

interface BuildGuideItem extends BuildGuideStep {
  count: number;
  complete: boolean;
  definition: ComponentDefinition;
  targetCount: number;
}

const singleComponentTarget = () => 1;
const motorDrivenTarget = (settings: SimulationSettings) => Math.max(expectedMotorCount(settings), 0);

const buildGuideSteps: BuildGuideStep[] = [
  { componentType: "frame", placement: "Start at the canvas center, then choose layout and wheelbase.", target: singleComponentTarget },
  { componentType: "flight-controller", placement: "Place near the frame center for short power, sensor, and PWM routes.", target: singleComponentTarget },
  { componentType: "battery", placement: "Place on the left power side before the power module.", target: singleComponentTarget },
  { componentType: "power-module", placement: "Place between battery and flight controller.", target: singleComponentTarget },
  { componentType: "esc", placement: "Place one ESC near each motor arm.", target: motorDrivenTarget },
  { componentType: "motor", placement: "Place motors around the frame in the selected layout order.", target: motorDrivenTarget },
  { componentType: "gps", placement: "Place above or away from power wiring and connect by UART.", target: singleComponentTarget },
  { componentType: "compass", placement: "Place away from high current wiring and connect by I2C.", target: singleComponentTarget },
  { componentType: "airspeed-sensor", placement: "Place in clean airflow for fixed-wing or wind-heavy tests.", optional: true, target: singleComponentTarget },
  { componentType: "optical-flow", placement: "Mount downward with a rangefinder for GPS-denied hover tests.", optional: true, target: singleComponentTarget },
  { componentType: "telemetry-radio", placement: "Place at the right comms side and connect by UART.", target: singleComponentTarget },
  { componentType: "companion-computer", placement: "Place near the FC for a short MAVLink UART and payload data path.", optional: true, target: singleComponentTarget },
  { componentType: "adsb-remote-id", placement: "Place with comms hardware when traffic awareness or broadcast ID is needed.", optional: true, target: singleComponentTarget },
  { componentType: "rangefinder", placement: "Place on the lower sensor side for altitude or obstacle data.", optional: true, target: singleComponentTarget },
  { componentType: "parachute", placement: "Mount on the frame and connect an AUX/PWM trigger for recovery tests.", optional: true, target: singleComponentTarget },
  { componentType: "buzzer", placement: "Place as a status output for arming and failsafe alerts.", optional: true, target: singleComponentTarget },
  { componentType: "camera", placement: "Place with the payload stack after core flight parts are complete.", optional: true, target: singleComponentTarget },
  { componentType: "gimbal", placement: "Place after camera when a stabilized payload mount is needed.", optional: true, target: singleComponentTarget }
];

function buildGuideFor(nodes: DesignNode[], settings: SimulationSettings) {
  const items: BuildGuideItem[] = buildGuideSteps.map((step) => {
    const targetCount = step.target(settings);
    const count = nodesByType(nodes, step.componentType).length;
    return {
      ...step,
      count,
      complete: targetCount === 0 || count >= targetCount,
      definition: getComponentDefinition(step.componentType),
      targetCount
    };
  });
  const next = items.find((item) => !item.complete && item.targetCount > 0);
  const requiredItems = items.filter((item) => !item.optional && item.targetCount > 0);
  const completedRequired = requiredItems.filter((item) => item.complete).length;

  return {
    completedRequired,
    items,
    next,
    requiredTotal: requiredItems.length,
    start: items[0]
  };
}

function componentLimitFor(componentType: string, settings: SimulationSettings) {
  if (componentType === "esc" || componentType === "motor") {
    return expectedMotorCount(settings);
  }
  if (componentType === "frame") {
    return 1;
  }
  return Number.POSITIVE_INFINITY;
}

interface ComponentLimitStatus {
  allowed: boolean;
  limit: number;
  message?: string;
}

function componentLimitStatus(componentType: string, nodes: DesignNode[], settings: SimulationSettings): ComponentLimitStatus {
  const limit = componentLimitFor(componentType, settings);
  if (!Number.isFinite(limit)) {
    return { allowed: true, limit };
  }

  const count = nodesByType(nodes, componentType).length;
  if (count < limit) {
    return { allowed: true, limit };
  }

  const definition = getComponentDefinition(componentType);
  const frameName = airframeLabel(settings.frame);
  const noun = componentType === "esc" ? "ESC" : definition.name.toLowerCase();
  const plural = componentType === "esc" ? (limit === 1 ? "ESC" : "ESCs") : limit === 1 ? noun : `${noun}s`;
  return {
    allowed: false,
    limit,
    message:
      componentType === "frame"
        ? "Only one airframe can define the vehicle layout."
        : `${frameName} allows no more than ${limit} ${plural}.`
  };
}

function trimPropulsionForAirframe(nodes: DesignNode[], settings: SimulationSettings) {
  const maxPropulsionObjects = Math.max(expectedMotorCount(settings), 0);
  const counts = { esc: 0, motor: 0 };
  const removedIds: string[] = [];
  const nextNodes = nodes.filter((node) => {
    if (node.data.componentType !== "esc" && node.data.componentType !== "motor") {
      return true;
    }

    const type = node.data.componentType;
    counts[type] += 1;
    if (counts[type] <= maxPropulsionObjects) {
      return true;
    }

    removedIds.push(node.id);
    return false;
  });

  return { nodes: nextNodes, removedIds };
}

function propulsionTrimMessage(removedNodes: DesignNode[], frame: string) {
  const motors = removedNodes.filter((node) => node.data.componentType === "motor").length;
  const escs = removedNodes.filter((node) => node.data.componentType === "esc").length;
  const parts = [
    motors > 0 ? `${motors} motor${motors === 1 ? "" : "s"}` : "",
    escs > 0 ? `${escs} ESC${escs === 1 ? "" : "s"}` : ""
  ].filter(Boolean);

  return parts.length > 0 ? `${airframeLabel(frame)} selected; removed extra ${parts.join(" and ")}.` : `${airframeLabel(frame)} selected`;
}

interface AutoWireSuggestion {
  id: string;
  title: string;
  sourceId: string;
  sourceHandle: string;
  targetId: string;
  targetHandle: string;
  signal: SignalKind;
}

function autoWireSuggestions(nodes: DesignNode[], edges: DesignEdge[], settings: SimulationSettings): AutoWireSuggestion[] {
  const suggestions: AutoWireSuggestion[] = [];
  const first = (type: string) => firstNodeByType(nodes, type);
  const byType = (type: string) => nodesByType(nodes, type);
  const connectionKey = (sourceId: string, sourceHandle: string, targetId: string, targetHandle: string) =>
    `${sourceId}:${sourceHandle}->${targetId}:${targetHandle}`;
  const existing = new Set(edges.map((edge) => connectionKey(edge.source, edge.sourceHandle ?? "", edge.target, edge.targetHandle ?? "")));

  const add = (title: string, source: DesignNode | undefined, sourceHandle: string, target: DesignNode | undefined, targetHandle: string) => {
    if (!source || !target) {
      return;
    }
    const key = connectionKey(source.id, sourceHandle, target.id, targetHandle);
    if (existing.has(key) || suggestions.some((suggestion) => suggestion.id === key)) {
      return;
    }
    const candidate = {
      source: source.id,
      sourceHandle,
      target: target.id,
      targetHandle
    } as Connection;
    if (!checkPortConnection(candidate, nodes).valid) {
      return;
    }
    const sourcePort = getPort(source.data.componentType, sourceHandle);
    if (!sourcePort) {
      return;
    }
    suggestions.push({
      id: key,
      title,
      sourceId: source.id,
      sourceHandle,
      targetId: target.id,
      targetHandle,
      signal: sourcePort.kind
    });
  };

  const frame = first("frame");
  const flightController = first("flight-controller");
  const battery = first("battery");
  const powerModule = first("power-module");
  const escs = byType("esc");
  const motors = byType("motor");
  const propulsionSlots = expectedMotorCount(settings);

  add("Battery feeds power module", battery, "power-out", powerModule, "power-in");
  add("Power module feeds flight controller", powerModule, "power-out", flightController, "power-in");
  add("Power telemetry to flight controller ADC", powerModule, "analog-out", flightController, "analog-in");
  add("GPS UART to flight controller", first("gps"), "uart-out", flightController, "uart-in");
  add("Compass I2C to flight controller", first("compass"), "i2c-out", flightController, "i2c-in");
  add("Telemetry radio on flight controller UART", flightController, "uart-out", first("telemetry-radio"), "uart-in");
  add("Companion computer MAVLink UART", flightController, "uart-out", first("companion-computer"), "uart-in");
  add("Camera video to companion computer", first("camera"), "video-out", first("companion-computer"), "video-in");
  add("Gimbal mounts camera", first("gimbal"), "mount-out", first("camera"), "mount-in");
  add("ADSB/Remote ID to flight controller", first("adsb-remote-id"), "uart-out", flightController, "uart-in");
  add("Parachute trigger from flight controller", flightController, "pwm-out", first("parachute"), "pwm-in");
  add("Buzzer trigger from flight controller", flightController, "pwm-out", first("buzzer"), "pwm-in");
  add("Optical flow mounted to frame", frame, "mount-out", first("optical-flow"), "mount-in");
  add("Airspeed sensor mounted to frame", frame, "mount-out", first("airspeed-sensor"), "mount-in");
  add("Gimbal mounted to frame", frame, "mount-out", first("gimbal"), "mount-in");
  add("Rangefinder I2C to flight controller", first("rangefinder"), "i2c-out", flightController, "i2c-in");
  add("Optical flow I2C to flight controller", first("optical-flow"), "i2c-out", flightController, "i2c-in");
  add("Airspeed sensor I2C to flight controller", first("airspeed-sensor"), "i2c-out", flightController, "i2c-in");

  for (const [index, esc] of escs.slice(0, propulsionSlots).entries()) {
    add(`${esc.data.label} main power`, powerModule, "power-out", esc, "power-in");
    add(`${esc.data.label} PWM signal`, flightController, "pwm-out", esc, "pwm-in");
    add(`${motors[index]?.data.label ?? `Motor ${index + 1}`} driven by ${esc.data.label}`, esc, "power-out", motors[index], "power-in");
  }

  for (const motor of motors.slice(0, propulsionSlots)) {
    add(`${motor.data.label} mounted to frame`, frame, "mount-out", motor, "mount-in");
  }

  return suggestions;
}

interface BomRow {
  id: string;
  componentType: string;
  label: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  massG: number;
  unitCostUsd: number;
  notes: string;
}

function bomRowsFor(nodes: DesignNode[]): BomRow[] {
  return nodes.map((node) => {
    const mass = estimateMass(node);
    const properties = node.data.properties;
    return {
      id: node.id,
      componentType: node.data.componentType,
      label: node.data.label,
      manufacturer: String(properties.specManufacturer ?? ""),
      model: String(properties.specModel || properties.model || properties.board || ""),
      partNumber: String(properties.specPartNumber ?? ""),
      massG: Math.round(mass.massG * 10) / 10,
      unitCostUsd: Math.round(finiteNumber(properties.specUnitCostUsd, 0) * 100) / 100,
      notes: String(properties.specNotes ?? "")
    };
  });
}

interface ScenarioRunResult {
  ranAt: string;
  scenario: SimulationSettings["testScenario"];
  passed: boolean;
  checks: Array<{ label: string; passed: boolean; detail: string }>;
}

function scenarioRunFor(nodes: DesignNode[], edges: DesignEdge[], settings: SimulationSettings, estimate: PerformanceEstimate): ScenarioRunResult {
  const validation = validateDesign(nodes, edges, settings);
  const hasOpticalFlow = nodesByType(nodes, "optical-flow").length > 0;
  const hasRangefinder = nodesByType(nodes, "rangefinder").length > 0;
  const checks = [
    {
      label: "Validation errors",
      passed: validation.counts.error === 0,
      detail: validation.counts.error === 0 ? "No blocking design errors" : `${validation.counts.error} blocking issue(s)`
    },
    {
      label: "Battery threshold order",
      passed: settings.batteryCriticalPercent < settings.batteryLowPercent,
      detail: `${settings.batteryCriticalPercent}% critical below ${settings.batteryLowPercent}% low`
    },
    {
      label: "Mission reserve",
      passed: estimate.rangeKm === 0 || estimate.missionReservePercent >= 20,
      detail:
        estimate.rangeKm === 0
          ? "Range unavailable until propulsion and battery data are complete"
          : `${Math.round(estimate.missionReservePercent)}% estimated reserve`
    },
    {
      label: "Scenario sensors",
      passed: settings.testScenario !== "gps-denied" || (hasOpticalFlow && hasRangefinder),
      detail:
        settings.testScenario === "gps-denied"
          ? hasOpticalFlow && hasRangefinder
            ? "Optical flow and rangefinder present"
            : "GPS-denied checks need optical flow plus rangefinder"
          : "No additional GPS-denied sensor gate for this scenario"
    },
    {
      label: "Wind envelope",
      passed: settings.windGustMps <= 0 || settings.windGustMps <= Math.max(estimate.maxSpeedMps * 0.75, 1),
      detail: settings.windGustMps > 0 ? `${settings.windGustMps} m/s gust vs ${formatMetric(estimate.maxSpeedMps, 1)} m/s estimate` : "No gust configured"
    }
  ];

  return {
    ranAt: new Date().toISOString(),
    scenario: settings.testScenario,
    passed: checks.every((check) => check.passed),
    checks
  };
}

interface MassEstimate {
  nodeId: string;
  label: string;
  componentType: string;
  massG: number;
  source: "spec" | "property" | "estimated";
}

interface BatteryEstimate {
  label: string;
  cells: number;
  capacityAh: number;
  nominalVoltage: number;
  energyWh: number;
  usableWh: number;
  maxCurrentA: number;
}

interface PerformanceEstimate {
  totalMassG: number;
  batteryEnergyWh: number;
  usableEnergyWh: number;
  totalThrustG: number;
  thrustToWeight: number;
  hoverThrottle: number;
  hoverPowerW: number;
  cruisePowerW: number;
  hoverEnduranceMin: number;
  missionEnduranceMin: number;
  rangeKm: number;
  maxSpeedMps: number;
  payloadMarginG: number;
  missionDistanceKm: number;
  missionReservePercent: number;
  windPenaltyPercent: number;
  lowBatteryReserveWh: number;
  criticalBatteryReserveWh: number;
  performanceScore: number;
  confidence: "High" | "Medium" | "Low";
  warnings: string[];
  assumptions: string[];
  massItems: MassEstimate[];
  batteries: BatteryEstimate[];
  selectedImpact?: {
    title: string;
    points: string[];
  };
}

const estimatedMassByType: Record<string, number> = {
  "adsb-remote-id": 35,
  "airspeed-sensor": 18,
  buzzer: 10,
  "companion-computer": 95,
  "flight-controller": 42,
  battery: 520,
  camera: 45,
  compass: 12,
  esc: 35,
  frame: 1350,
  gimbal: 180,
  gps: 28,
  motor: 68,
  "optical-flow": 24,
  parachute: 180,
  "power-module": 26,
  rangefinder: 18,
  "telemetry-radio": 22
};

function finiteNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function propertyNumber(node: DesignNode, key: string, fallback = 0) {
  return finiteNumber(node.data.properties[key], fallback);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function estimateMass(node: DesignNode): MassEstimate {
  const specMass = propertyNumber(node, "specMassG", 0);
  if (specMass > 0) {
    return {
      nodeId: node.id,
      label: node.data.label,
      componentType: node.data.componentType,
      massG: specMass,
      source: "spec"
    };
  }

  if (node.data.componentType === "frame") {
    return {
      nodeId: node.id,
      label: node.data.label,
      componentType: node.data.componentType,
      massG: propertyNumber(node, "massKg", 1.35) * 1000,
      source: "property"
    };
  }

  if (node.data.componentType === "battery") {
    const cells = propertyNumber(node, "cells", 4);
    const capacityMah = propertyNumber(node, "capacityMah", 5200);
    return {
      nodeId: node.id,
      label: node.data.label,
      componentType: node.data.componentType,
      massG: Math.max(80, cells * capacityMah * 0.024),
      source: "estimated"
    };
  }

  if (node.data.componentType === "camera") {
    return {
      nodeId: node.id,
      label: node.data.label,
      componentType: node.data.componentType,
      massG: propertyNumber(node, "massG", estimatedMassByType.camera),
      source: "property"
    };
  }

  return {
    nodeId: node.id,
    label: node.data.label,
    componentType: node.data.componentType,
    massG: estimatedMassByType[node.data.componentType] ?? 30,
    source: "estimated"
  };
}

function estimateBattery(node: DesignNode): BatteryEstimate {
  const cells = propertyNumber(node, "cells", 4);
  const capacityAh = propertyNumber(node, "capacityMah", 5200) / 1000;
  const nominalVoltage = cells * 3.7;
  const energyWh = nominalVoltage * capacityAh;
  const usableWh = energyWh * 0.8;
  const maxCurrentA = capacityAh * propertyNumber(node, "cRating", 25);

  return {
    label: node.data.label,
    cells,
    capacityAh,
    nominalVoltage,
    energyWh,
    usableWh,
    maxCurrentA
  };
}

function estimateMotorMaxPower(node: DesignNode) {
  const thrustG = propertyNumber(node, "thrustGrams", 900);
  const kv = propertyNumber(node, "kv", 900);
  return Math.max(80, thrustG * (0.12 + clamp(kv, 400, 2400) / 20000));
}

function formatMetric(value: number, digits = 1, allowZero = false) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    return "--";
  }
  return value.toFixed(digits);
}

function scenarioLabel(scenario: SimulationSettings["testScenario"]) {
  const labels: Record<SimulationSettings["testScenario"], string> = {
    "gps-denied": "GPS Denied",
    "low-battery": "Low Battery",
    nominal: "Nominal",
    "payload-endurance": "Payload Endurance",
    "sensor-failure": "Sensor Failure",
    "wind-gust": "Wind Gust"
  };
  return labels[scenario];
}

function scenarioHint(settings: SimulationSettings) {
  if (settings.testScenario === "wind-gust") {
    return "Runs the design against configured wind and gust values; external physics backends should mirror these values.";
  }
  if (settings.testScenario === "low-battery") {
    return "Exports low and critical battery reserve parameters so the failsafe response can be tested in SITL.";
  }
  if (settings.testScenario === "gps-denied") {
    return "Checks for local-position sensors such as optical flow plus rangefinder before GPS-denied testing.";
  }
  if (settings.testScenario === "payload-endurance") {
    return "Emphasizes mission range reserve and avionics/payload energy draw.";
  }
  if (settings.testScenario === "sensor-failure") {
    return "Exports Gazebo sensor-degradation settings for GPS, compass, and rangefinder failure rehearsal.";
  }
  return "Baseline configuration for normal SITL launch and component validation.";
}

function analyzePerformance(nodes: DesignNode[], settings: SimulationSettings, selectedNode?: DesignNode): PerformanceEstimate {
  const massItems = nodes.map(estimateMass);
  const totalMassG = massItems.reduce((sum, item) => sum + item.massG, 0);
  const batteries = nodesByType(nodes, "battery").map(estimateBattery);
  const batteryEnergyWh = batteries.reduce((sum, battery) => sum + battery.energyWh, 0);
  const lowBatteryPercent = clamp(finiteNumber(settings.batteryLowPercent, 20), 1, 80);
  const criticalBatteryPercent = clamp(finiteNumber(settings.batteryCriticalPercent, 10), 0, 79);
  const lowBatteryReserveWh = batteryEnergyWh * (lowBatteryPercent / 100);
  const criticalBatteryReserveWh = batteryEnergyWh * (criticalBatteryPercent / 100);
  const usableEnergyWh = batteryEnergyWh > 0 ? Math.max(0, batteryEnergyWh - lowBatteryReserveWh) : 0;
  const motors = nodesByType(nodes, "motor");
  const escs = nodesByType(nodes, "esc");
  const companionPowerW = nodesByType(nodes, "companion-computer").reduce((sum, node) => sum + propertyNumber(node, "powerWatts", 8), 0);
  const totalThrustG = motors.reduce((sum, motor) => sum + propertyNumber(motor, "thrustGrams", 900), 0);
  const totalMaxMotorPowerW = motors.reduce((sum, motor) => sum + estimateMotorMaxPower(motor), 0);
  const totalMassKg = totalMassG / 1000;
  const thrustToWeight = totalMassG > 0 ? totalThrustG / totalMassG : 0;
  const hoverThrottle = totalThrustG > 0 ? clamp(totalMassG / totalThrustG, 0, 1.4) : 0;
  const windSpeedMps = clamp(finiteNumber(settings.windSpeedMps, 0), 0, 60);
  const windGustMps = clamp(finiteNumber(settings.windGustMps, 0), 0, 80);
  const windPowerMultiplier =
    settings.vehicle === "Rover" ? 1 : 1 + clamp(windSpeedMps / 24, 0, 0.34) + clamp(Math.max(windGustMps - windSpeedMps, 0) / 26, 0, 0.26);
  const baseHoverPowerW =
    motors.length > 0 && totalMaxMotorPowerW > 0
      ? totalMaxMotorPowerW *
          Math.pow(clamp(hoverThrottle, 0.22, 1.15), 1.5) *
          1.12 *
          (settings.vehicle === "ArduCopter" ? 1 + clamp((windSpeedMps + windGustMps) / 70, 0, 0.22) : 1)
      : 0;
  const hoverPowerW = baseHoverPowerW > 0 ? baseHoverPowerW + companionPowerW : 0;

  const cruisePowerW =
    settings.vehicle === "ArduPlane"
      ? Math.max(80, totalMassKg * 65, totalMaxMotorPowerW * 0.28) * windPowerMultiplier + companionPowerW
      : settings.vehicle === "Rover"
        ? Math.max(24, totalMassKg * 16) + companionPowerW
        : baseHoverPowerW * 0.88 + companionPowerW;
  const hoverEnduranceMin = usableEnergyWh > 0 && hoverPowerW > 0 ? (usableEnergyWh / hoverPowerW) * 60 : 0;
  const missionEnduranceMin = usableEnergyWh > 0 && cruisePowerW > 0 ? (usableEnergyWh / cruisePowerW) * 60 : 0;
  const maxSpeedMps =
    settings.vehicle === "ArduPlane"
      ? clamp(16 + Math.max(thrustToWeight - 0.35, 0) * 14, 12, 34)
      : settings.vehicle === "Rover"
        ? clamp(3.5 + Math.max(thrustToWeight, 0) * 0.6, 2, 8)
        : clamp(8 + Math.max(thrustToWeight - 1, 0) * 7, 5, 22);
  const rangeKm = missionEnduranceMin > 0 ? (missionEnduranceMin / 60) * maxSpeedMps * 3.6 : 0;
  const payloadMarginG =
    settings.vehicle === "ArduPlane"
      ? Math.max(0, totalThrustG * 0.75 - totalMassG)
      : settings.vehicle === "Rover"
        ? Math.max(0, totalMassG * 0.35)
        : Math.max(0, totalThrustG / 2 - totalMassG);
  const missionDistanceKm = Math.max(0, finiteNumber(settings.missionDistanceKm, 0));
  const missionReservePercent = rangeKm > 0 ? ((rangeKm - missionDistanceKm) / rangeKm) * 100 : 0;
  const batteryContinuousCurrentA = batteries.reduce((sum, battery) => sum + battery.maxCurrentA, 0);
  const escContinuousCurrentA = escs.reduce((sum, esc) => sum + propertyNumber(esc, "maxAmps", 30), 0);
  const totalCapacityAh = batteries.reduce((sum, battery) => sum + battery.capacityAh, 0);
  const averageVoltage = totalCapacityAh > 0 ? batteryEnergyWh / totalCapacityAh : 0;
  const estimatedPeakCurrentA = averageVoltage > 0 ? totalMaxMotorPowerW / averageVoltage : 0;

  const warnings: string[] = [];
  if (nodes.length === 0) {
    warnings.push("Add components before estimating vehicle performance.");
  }
  if (batteries.length === 0) {
    warnings.push("Battery energy is missing, so endurance and range cannot be estimated.");
  }
  if (settings.vehicle !== "Rover" && motors.length === 0) {
    warnings.push("Motor thrust is missing, so propulsion margin cannot be estimated.");
  }
  if (settings.vehicle !== "Rover" && thrustToWeight > 0 && thrustToWeight < 1.35) {
    warnings.push("Thrust-to-weight is low for reliable takeoff and control authority.");
  }
  if (hoverThrottle > 0.75) {
    warnings.push("Estimated hover throttle is high; endurance and control margin will be limited.");
  }
  if (escs.length < motors.length) {
    warnings.push("There are fewer ESCs than motors, so propulsion hardware is incomplete.");
  }
  if (batteryContinuousCurrentA > 0 && estimatedPeakCurrentA > batteryContinuousCurrentA) {
    warnings.push("Estimated peak propulsion current exceeds the battery C-rating limit.");
  }
  if (escContinuousCurrentA > 0 && estimatedPeakCurrentA > escContinuousCurrentA) {
    warnings.push("Estimated peak propulsion current exceeds combined ESC current rating.");
  }
  if (windGustMps > 0 && maxSpeedMps > 0 && windGustMps > maxSpeedMps * 0.65 && settings.vehicle !== "Rover") {
    warnings.push("Configured gust speed is high relative to estimated vehicle speed.");
  }
  if (missionDistanceKm > 0 && rangeKm > 0 && missionReservePercent < 25) {
    warnings.push("Planned mission distance leaves less than 25% estimated range reserve.");
  }
  if (settings.batteryCriticalPercent >= settings.batteryLowPercent) {
    warnings.push("Critical battery reserve must be lower than low battery reserve.");
  }
  if (settings.testScenario === "gps-denied" && nodesByType(nodes, "optical-flow").length === 0) {
    warnings.push("GPS-denied scenario needs optical flow or another local-position source.");
  }

  const defaultMassCount = massItems.filter((item) => item.source === "estimated").length;
  const assumptions = [
    `Usable battery energy ends at the configured ${lowBatteryPercent}% low-battery reserve.`,
    "Product spec Unit mass overrides catalog and property mass estimates.",
    settings.vehicle === "ArduPlane"
      ? "Plane cruise power is estimated from mass and installed motor power."
      : settings.vehicle === "Rover"
        ? "Rover range is estimated from mass, battery energy, and a low-speed drive model."
        : "Multirotor endurance uses hover power; range uses an efficient forward-flight power estimate.",
    windSpeedMps > 0 || windGustMps > 0
      ? `Wind model applies a ${Math.round((windPowerMultiplier - 1) * 100)}% cruise power penalty.`
      : "Wind model is neutral until wind speed or gust is configured.",
    `Scenario: ${scenarioLabel(settings.testScenario)}.`,
    defaultMassCount > 0
      ? `${defaultMassCount} component mass value${defaultMassCount === 1 ? "" : "s"} used catalog estimates.`
      : "All component masses came from specs or component properties."
  ];

  const confidence =
    warnings.length === 0 && defaultMassCount <= Math.max(1, Math.round(nodes.length * 0.25))
      ? "High"
      : warnings.length <= 2 && defaultMassCount <= Math.max(2, Math.round(nodes.length * 0.5))
        ? "Medium"
        : "Low";
  const performanceScore = clamp(
    Math.round(
        (thrustToWeight ? clamp(thrustToWeight / 2.4, 0, 1) * 34 : 0) +
        (hoverEnduranceMin ? clamp(hoverEnduranceMin / 28, 0, 1) * 28 : 0) +
        (rangeKm ? clamp(rangeKm / 10, 0, 1) * 16 : 0) +
        (missionDistanceKm > 0 ? clamp((missionReservePercent + 15) / 85, 0, 1) * 8 : 4) +
        (payloadMarginG ? clamp(payloadMarginG / Math.max(totalMassG * 0.25, 1), 0, 1) * 14 : 0)
    ),
    0,
    100
  );

  const selectedMass = selectedNode ? massItems.find((item) => item.nodeId === selectedNode.id) : undefined;
  const selectedImpact = selectedNode
    ? {
        title: `${selectedNode.data.label} impact`,
        points: [
          selectedMass
            ? `${formatMetric(selectedMass.massG, 0)} g from ${selectedMass.source === "estimated" ? "AI mass estimate" : selectedMass.source}`
            : "Mass contribution unavailable",
          selectedNode.data.componentType === "battery"
            ? `${formatMetric(estimateBattery(selectedNode).energyWh * (1 - lowBatteryPercent / 100), 1)} Wh before low-battery reserve`
            : selectedNode.data.componentType === "motor"
              ? `${formatMetric(propertyNumber(selectedNode, "thrustGrams", 900), 0)} g max thrust per motor`
              : selectedNode.data.componentType === "companion-computer"
                ? `${formatMetric(propertyNumber(selectedNode, "powerWatts", 8), 1)} W avionics load`
                : selectedNode.data.componentType === "airspeed-sensor"
                  ? "Improves fixed-wing and wind-test confidence"
                  : selectedNode.data.componentType === "optical-flow"
                    ? "Supports GPS-denied local-position scenarios"
                    : selectedNode.data.componentType === "parachute"
                      ? "Adds recovery hardware for failsafe test coverage"
              : `${formatMetric(((selectedMass?.massG ?? 0) / Math.max(totalMassG, 1)) * 100, 1)}% of estimated takeoff mass`,
          selectedNode.data.componentType === "frame"
            ? `Layout input: ${airframeLabel(String(selectedNode.data.properties.layout ?? settings.frame))}`
            : `Spec model: ${String(selectedNode.data.properties.specModel || selectedNode.data.properties.model || "not set")}`
        ]
      }
    : undefined;

  return {
    totalMassG,
    batteryEnergyWh,
    usableEnergyWh,
    totalThrustG,
    thrustToWeight,
    hoverThrottle,
    hoverPowerW,
    cruisePowerW,
    hoverEnduranceMin,
    missionEnduranceMin,
    rangeKm,
    maxSpeedMps,
    payloadMarginG,
    missionDistanceKm,
    missionReservePercent,
    windPenaltyPercent: (windPowerMultiplier - 1) * 100,
    lowBatteryReserveWh,
    criticalBatteryReserveWh,
    performanceScore,
    confidence,
    warnings,
    assumptions,
    massItems,
    batteries,
    selectedImpact
  };
}

function motorSlotStyle(index: number, total: number) {
  const angle = -Math.PI / 2 + (index / Math.max(total, 1)) * Math.PI * 2;
  const radiusX = 41;
  const radiusY = 34;
  return {
    left: `${50 + Math.cos(angle) * radiusX}%`,
    top: `${50 + Math.sin(angle) * radiusY}%`
  };
}

function SimulationPreview({
  nodes,
  settings,
  score
}: {
  nodes: DesignNode[];
  settings: SimulationSettings;
  score: number;
}) {
  const motors = nodesByType(nodes, "motor");
  const escs = nodesByType(nodes, "esc");
  const frame = firstNodeByType(nodes, "frame");
  const battery = firstNodeByType(nodes, "battery");
  const gps = firstNodeByType(nodes, "gps");
  const compass = firstNodeByType(nodes, "compass");
  const rangefinder = firstNodeByType(nodes, "rangefinder");
  const airspeed = firstNodeByType(nodes, "airspeed-sensor");
  const opticalFlow = firstNodeByType(nodes, "optical-flow");
  const telemetry = firstNodeByType(nodes, "telemetry-radio");
  const companion = firstNodeByType(nodes, "companion-computer");
  const adsb = firstNodeByType(nodes, "adsb-remote-id");
  const parachute = firstNodeByType(nodes, "parachute");
  const buzzer = firstNodeByType(nodes, "buzzer");
  const camera = firstNodeByType(nodes, "camera");
  const gimbal = firstNodeByType(nodes, "gimbal");
  const expectedMotors = expectedMotorCount(settings);
  const slotCount = settings.vehicle === "Rover" ? Math.max(motors.length, 4) : Math.max(motors.length, expectedMotors, 1);
  const frameLayout = airframeLabel(String(frame?.data.properties.layout ?? settings.frame));
  const batteryCells = battery?.data.properties.cells;
  const payloads = [camera, gimbal].filter(Boolean);
  const windLabel =
    settings.windSpeedMps > 0 || settings.windGustMps > 0 ? `${settings.windSpeedMps}/${settings.windGustMps} m/s` : "Calm";

  return (
    <section className="sim-preview">
      <div className="sim-preview-title">
        <span>Vehicle Preview</span>
        <strong>{scenarioLabel(settings.testScenario)}</strong>
      </div>

      <div className={`vehicle-visual ${settings.vehicle.toLowerCase()}`}>
        <div className={`wind-visual ${settings.windSpeedMps > 0 || settings.windGustMps > 0 ? "active" : ""}`} title="Wind / gust">
          <Wind size={14} />
          <span>{windLabel}</span>
        </div>
        <div className="vehicle-axis horizontal" />
        <div className="vehicle-axis vertical" />
        <div className="vehicle-axis diagonal-a" />
        <div className="vehicle-axis diagonal-b" />

        {Array.from({ length: slotCount }).map((_, index) => {
          const motor = motors[index];
          return (
            <span
              className={`motor-visual ${motor ? "active" : "missing"}`}
              key={`motor-slot-${index}`}
              style={motorSlotStyle(index, slotCount)}
              title={motor?.data.label ?? `Motor ${index + 1} missing`}
            >
              {index + 1}
            </span>
          );
        })}

        <div className="fc-visual" title="Flight controller">
          <Cpu size={15} />
          <span>FC</span>
        </div>

        {battery ? (
          <div className="battery-visual" title={battery.data.label}>
            <Battery size={16} />
            <span>{batteryCells ? `${batteryCells}S` : "BAT"}</span>
          </div>
        ) : null}

        {gps ? <span className="sensor-visual gps">GPS</span> : null}
        {compass ? <span className="sensor-visual compass">MAG</span> : null}
        {rangefinder ? <span className="sensor-visual rangefinder">RNG</span> : null}
        {airspeed ? <span className="sensor-visual airspeed">AS</span> : null}
        {opticalFlow ? <span className="sensor-visual optical-flow">FLOW</span> : null}
        {telemetry ? <span className="sensor-visual telemetry">TEL</span> : null}
        {companion ? <span className="sensor-visual companion">CPU</span> : null}
        {adsb ? <span className="sensor-visual adsb">ID</span> : null}
        {parachute ? <span className="safety-visual parachute">CHUTE</span> : null}
        {buzzer ? <span className="safety-visual buzzer">ALERT</span> : null}
        {payloads.length > 0 ? <span className="payload-visual">PAY</span> : null}
      </div>

      <div className="sim-metrics">
        <div>
          <strong>{frameLayout}</strong>
          <span>Frame</span>
        </div>
        <div>
          <strong>
            {motors.length}/{expectedMotors || motors.length}
          </strong>
          <span>Motors</span>
        </div>
        <div>
          <strong>{escs.length}</strong>
          <span>ESCs</span>
        </div>
        <div>
          <strong>{score}</strong>
          <span>Score</span>
        </div>
        <div>
          <strong>{settings.vehicle}</strong>
          <span>Vehicle</span>
        </div>
        <div>
          <strong>{windLabel}</strong>
          <span>Wind/Gust</span>
        </div>
        <div>
          <strong>{formatMetric(settings.missionDistanceKm, 1, true)}</strong>
          <span>Mission km</span>
        </div>
      </div>
    </section>
  );
}

function PerformancePanel({ estimate }: { estimate: PerformanceEstimate }) {
  const metrics = [
    { label: "Takeoff Mass", value: formatMetric(estimate.totalMassG / 1000, 2), unit: "kg" },
    { label: "Hover Endurance", value: formatMetric(estimate.hoverEnduranceMin, 1), unit: "min" },
    { label: "Mission Range", value: formatMetric(estimate.rangeKm, 2), unit: "km" },
    { label: "Mission Reserve", value: Number.isFinite(estimate.missionReservePercent) ? `${Math.round(estimate.missionReservePercent)}` : "--", unit: "%" },
    { label: "Usable Energy", value: formatMetric(estimate.usableEnergyWh, 1), unit: "Wh" },
    { label: "Wind Penalty", value: formatMetric(estimate.windPenaltyPercent, 0, true), unit: "%" },
    { label: "Thrust / Weight", value: formatMetric(estimate.thrustToWeight, 2), unit: "x" },
    { label: "Hover Throttle", value: estimate.hoverThrottle > 0 ? `${Math.round(estimate.hoverThrottle * 100)}` : "--", unit: "%" },
    { label: "Max Speed", value: formatMetric(estimate.maxSpeedMps, 1), unit: "m/s" },
    { label: "Payload Margin", value: formatMetric(estimate.payloadMarginG, 0, true), unit: "g" }
  ];

  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>AI Performance</span>
        <span className={`status-pill ${estimate.confidence === "High" ? "good" : estimate.confidence === "Low" ? "bad" : "neutral"}`}>
          {estimate.confidence}
        </span>
      </div>

      <section className="ai-score-panel">
        <div>
          <small>Performance Score</small>
          <strong>{estimate.performanceScore}</strong>
        </div>
        <p>Calculated from the selected components, object properties, and product specs in this workspace.</p>
      </section>

      <div className="ai-metric-grid">
        {metrics.map((metric) => (
          <div className="ai-metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>
              {metric.value}
              <small>{metric.unit}</small>
            </strong>
          </div>
        ))}
      </div>

      {estimate.selectedImpact ? (
        <section className="selected-impact">
          <h2>Selected Object</h2>
          <strong>{estimate.selectedImpact.title}</strong>
          {estimate.selectedImpact.points.map((point) => (
            <p key={point}>{point}</p>
          ))}
        </section>
      ) : (
        <div className="empty-state">Select an object to see its AI impact.</div>
      )}

      <section className="ai-detail-list">
        <h2>Power Model</h2>
        <div className="ai-detail-row">
          <span>Battery packs</span>
          <strong>{estimate.batteries.length}</strong>
        </div>
        <div className="ai-detail-row">
          <span>Nominal energy</span>
          <strong>{formatMetric(estimate.batteryEnergyWh, 1)} Wh</strong>
        </div>
        <div className="ai-detail-row">
          <span>Low reserve</span>
          <strong>{formatMetric(estimate.lowBatteryReserveWh, 1, true)} Wh</strong>
        </div>
        <div className="ai-detail-row">
          <span>Critical reserve</span>
          <strong>{formatMetric(estimate.criticalBatteryReserveWh, 1, true)} Wh</strong>
        </div>
        <div className="ai-detail-row">
          <span>Hover power</span>
          <strong>{formatMetric(estimate.hoverPowerW, 0)} W</strong>
        </div>
        <div className="ai-detail-row">
          <span>Cruise power</span>
          <strong>{formatMetric(estimate.cruisePowerW, 0)} W</strong>
        </div>
        <div className="ai-detail-row">
          <span>Mission distance</span>
          <strong>{formatMetric(estimate.missionDistanceKm, 2, true)} km</strong>
        </div>
      </section>

      <section className="ai-detail-list">
        <h2>AI Notes</h2>
        {estimate.warnings.length > 0
          ? estimate.warnings.map((warning) => (
              <p className="ai-warning" key={warning}>
                {warning}
              </p>
            ))
          : null}
        {estimate.assumptions.map((assumption) => (
          <p key={assumption}>{assumption}</p>
        ))}
      </section>
    </div>
  );
}

const MAVLINK_MODES = [
  { label: "Guided", value: "guided" },
  { label: "Loiter", value: "loiter" },
  { label: "Auto", value: "auto" },
  { label: "RTL", value: "rtl" },
  { label: "Land", value: "land" },
  { label: "Alt Hold", value: "alt-hold" },
  { label: "Stabilize", value: "stabilize" }
];

function TelemetryPanel({
  status,
  port,
  onPortChange,
  onStart,
  onStop,
  onCommand
}: {
  status: TelemetryStatus | null;
  port: number;
  onPortChange: (port: number) => void;
  onStart: () => void;
  onStop: () => void;
  onCommand: (command: MavlinkCommandRequest) => Promise<void>;
}) {
  const listener = status?.listener;
  const vehicles = status?.vehicles ?? [];
  const [mode, setMode] = useState("guided");
  const [takeoffAltitudeM, setTakeoffAltitudeM] = useState(20);
  const [customCommandId, setCustomCommandId] = useState(176);
  const [customParams, setCustomParams] = useState([1, 4, 0, 0, 0, 0, 0]);
  const [busyCommand, setBusyCommand] = useState<string | null>(null);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);

  const updateCustomParam = (index: number, value: number) => {
    setCustomParams((current) => current.map((entry, entryIndex) => (entryIndex === index ? value : entry)));
  };

  const runVehicleCommand = async (
    vehicle: TelemetryStatus["vehicles"][number],
    request: Omit<MavlinkCommandRequest, "sysid" | "compid">,
    label: string
  ) => {
    const busyKey = `${vehicle.id}:${label}`;
    setBusyCommand(busyKey);
    setPanelMessage(null);
    try {
      await onCommand({ sysid: vehicle.sysid, compid: vehicle.compid, ...request });
      setPanelMessage(`${label} sent to SYS ${vehicle.sysid}`);
    } catch (error) {
      setPanelMessage(error instanceof Error ? error.message : "MAVLink command failed");
    } finally {
      setBusyCommand(null);
    }
  };

  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>MAVLink Telemetry</span>
        <span className={`status-pill ${listener?.active ? "good" : "neutral"}`}>{listener?.active ? "Listening" : "Stopped"}</span>
      </div>

      <section className="telemetry-listener">
        <h2>UDP Reader</h2>
        <div className="path-row">
          <input
            type="number"
            min={1024}
            max={65535}
            value={port}
            onChange={(event) => onPortChange(Number(event.target.value))}
            aria-label="MAVLink UDP port"
          />
          <button type="button" title={listener?.active ? "Stop telemetry reader" : "Start telemetry reader"} onClick={listener?.active ? onStop : onStart}>
            {listener?.active ? <Trash2 size={16} /> : <Play size={16} />}
          </button>
        </div>
        <div className="telemetry-stats">
          <div>
            <strong>{listener?.packetCount ?? 0}</strong>
            <span>Packets</span>
          </div>
          <div>
            <strong>{vehicles.length}</strong>
            <span>Vehicles</span>
          </div>
          <div>
            <strong>{listener?.lastPacketAt ? new Date(listener.lastPacketAt).toLocaleTimeString() : "--"}</strong>
            <span>Last packet</span>
          </div>
        </div>
        {listener?.error ? <p className="scenario-note">{listener.error}</p> : null}
        {panelMessage ? <p className="scenario-note">{panelMessage}</p> : null}
      </section>

      <TelemetryMap status={status} />

      <section className="telemetry-vehicles">
        <h2>Live Vehicles</h2>
        {vehicles.length === 0 ? (
          <div className="empty-state">No MAVLink packets yet</div>
        ) : (
          vehicles.map((vehicle) => {
            const gps = vehicle.position ?? vehicle.gps;
            const hasCommandLink = Boolean(listener?.active && vehicle.link);
            const commandDisabled = !hasCommandLink || Boolean(busyCommand);
            return (
              <div className="telemetry-card" key={vehicle.id}>
                <div className="telemetry-card-title">
                  <strong>SYS {vehicle.sysid}</strong>
                  <span className={`status-pill ${vehicle.heartbeat?.armed ? "bad" : "neutral"}`}>
                    {vehicle.heartbeat?.armed ? "Armed" : "Disarmed"}
                  </span>
                </div>
                <div className="ai-detail-row">
                  <span>Status</span>
                  <strong>{vehicle.heartbeat?.systemStatusName ?? "Receiving"}</strong>
                </div>
                <div className="ai-detail-row">
                  <span>Vehicle</span>
                  <strong>{vehicle.heartbeat?.typeName ?? `Component ${vehicle.compid}`}</strong>
                </div>
                <div className="telemetry-grid">
                  <div>
                    <span>Battery</span>
                    <strong>
                      {vehicle.battery?.voltageV ? formatMetric(vehicle.battery.voltageV, 1) : "--"}
                      <small>V</small>
                    </strong>
                  </div>
                  <div>
                    <span>Remain</span>
                    <strong>
                      {typeof vehicle.battery?.remainingPercent === "number" ? vehicle.battery.remainingPercent : "--"}
                      <small>%</small>
                    </strong>
                  </div>
                  <div>
                    <span>Alt</span>
                    <strong>
                      {typeof gps?.altM === "number" ? formatMetric(gps.altM, 1, true) : "--"}
                      <small>m</small>
                    </strong>
                  </div>
                  <div>
                    <span>Speed</span>
                    <strong>
                      {typeof vehicle.vfrHud?.groundspeedMps === "number"
                        ? formatMetric(vehicle.vfrHud.groundspeedMps, 1, true)
                        : typeof vehicle.gps?.groundSpeedMps === "number"
                          ? formatMetric(vehicle.gps.groundSpeedMps, 1, true)
                          : "--"}
                      <small>m/s</small>
                    </strong>
                  </div>
                </div>
                {gps?.lat && gps.lon ? (
                  <p>
                    {gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}
                  </p>
                ) : null}
                {vehicle.statusText?.text ? <p className="telemetry-status-text">{vehicle.statusText.text}</p> : null}
                {vehicle.commandAck ? (
                  <p className={`telemetry-command-ack ${vehicle.commandAck.result === 0 ? "ok" : "bad"}`}>
                    MAV_CMD {vehicle.commandAck.command ?? "--"}: {vehicle.commandAck.resultName}
                  </p>
                ) : null}
                <div className="mavlink-command-panel">
                  <div className="mavlink-command-title">
                    <strong>Command Link</strong>
                    <span>{vehicle.link ? `${vehicle.link.host}:${vehicle.link.port}` : "Waiting"}</span>
                  </div>
                  <div className="command-action-grid">
                    <button
                      type="button"
                      disabled={commandDisabled}
                      onClick={() => void runVehicleCommand(vehicle, { action: "arm" }, "Arm")}
                    >
                      <ShieldCheck size={15} />
                      <span>Arm</span>
                    </button>
                    <button
                      type="button"
                      disabled={commandDisabled}
                      onClick={() => void runVehicleCommand(vehicle, { action: "disarm" }, "Disarm")}
                    >
                      <Trash2 size={15} />
                      <span>Disarm</span>
                    </button>
                    <button
                      type="button"
                      disabled={commandDisabled}
                      onClick={() => void runVehicleCommand(vehicle, { action: "rtl" }, "RTL")}
                    >
                      <RotateCcw size={15} />
                      <span>RTL</span>
                    </button>
                    <button
                      type="button"
                      disabled={commandDisabled}
                      onClick={() => void runVehicleCommand(vehicle, { action: "land" }, "Land")}
                    >
                      <MapPin size={15} />
                      <span>Land</span>
                    </button>
                  </div>

                  <div className="mavlink-inline-command">
                    <label className="field">
                      <span>Mode</span>
                      <select value={mode} onChange={(event) => setMode(event.target.value)}>
                        {MAVLINK_MODES.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={commandDisabled}
                      onClick={() => void runVehicleCommand(vehicle, { action: "mode", mode }, `Mode ${mode}`)}
                    >
                      <Settings size={15} />
                      <span>Set</span>
                    </button>
                  </div>

                  <div className="mavlink-inline-command">
                    <label className="field">
                      <span>
                        Takeoff
                        <small>m</small>
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={takeoffAltitudeM}
                        onChange={(event) => setTakeoffAltitudeM(Number(event.target.value))}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={commandDisabled}
                      onClick={() => void runVehicleCommand(vehicle, { action: "takeoff", altitudeM: takeoffAltitudeM }, "Takeoff")}
                    >
                      <Play size={15} />
                      <span>Go</span>
                    </button>
                  </div>

                  <details className="custom-command">
                    <summary>Custom COMMAND_LONG</summary>
                    <label className="field">
                      <span>Command ID</span>
                      <input
                        type="number"
                        min={0}
                        max={65535}
                        value={customCommandId}
                        onChange={(event) => setCustomCommandId(Number(event.target.value))}
                      />
                    </label>
                    <div className="command-param-grid">
                      {customParams.map((value, index) => (
                        <label className="field" key={`param-${index + 1}`}>
                          <span>P{index + 1}</span>
                          <input type="number" value={value} onChange={(event) => updateCustomParam(index, Number(event.target.value))} />
                        </label>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={commandDisabled}
                      onClick={() =>
                        void runVehicleCommand(
                          vehicle,
                          { action: "custom", commandId: customCommandId, params: customParams },
                          `MAV_CMD ${customCommandId}`
                        )
                      }
                    >
                      <Radio size={15} />
                      <span>Send Command</span>
                    </button>
                  </details>
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function LogsPanel({
  logs,
  onRefresh,
  onClear
}: {
  logs: AppLogEntry[];
  onRefresh: () => void;
  onClear: () => void;
}) {
  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>Logs</span>
        <span className="panel-actions">
          <button className="icon-button" type="button" title="Refresh logs" onClick={onRefresh}>
            <RefreshCw size={16} />
          </button>
          <button className="icon-button danger" type="button" title="Clear logs" onClick={onClear}>
            <Trash2 size={16} />
          </button>
        </span>
      </div>

      <section className="log-list">
        {logs.length === 0 ? (
          <div className="empty-state">No logs</div>
        ) : (
          logs.map((entry) => (
            <article className={`log-entry ${entry.level}`} key={entry.id}>
              <div>
                <strong>{entry.source}</strong>
                <span>{new Date(entry.ts).toLocaleTimeString()}</span>
              </div>
              <p>{entry.message}</p>
              {entry.meta ? <code>{JSON.stringify(entry.meta)}</code> : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function TerminalPanel({
  command,
  history,
  running,
  onCommandChange,
  onRun
}: {
  command: string;
  history: TerminalResult[];
  running: boolean;
  onCommandChange: (command: string) => void;
  onRun: () => void;
}) {
  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>Terminal</span>
        <span className={`status-pill ${running ? "neutral" : "good"}`}>{running ? "Running" : "Ready"}</span>
      </div>

      <form
        className="terminal-runner"
        onSubmit={(event) => {
          event.preventDefault();
          onRun();
        }}
      >
        <label className="field">
          <span>Command</span>
          <input value={command} onChange={(event) => onCommandChange(event.target.value)} placeholder="npm run build" />
        </label>
        <button type="submit" disabled={running || !command.trim()}>
          <Terminal size={16} />
          <span>Run</span>
        </button>
      </form>

      <section className="terminal-history">
        {history.length === 0 ? (
          <div className="empty-state">No commands</div>
        ) : (
          history.map((result, index) => (
            <article className={`terminal-result ${result.exitCode === 0 ? "ok" : "bad"}`} key={`${result.command}-${index}`}>
              <div className="terminal-result-title">
                <strong>{result.command}</strong>
                <span>
                  exit {result.exitCode ?? "--"} / {Math.round(result.durationMs)} ms
                </span>
              </div>
              {result.stdout ? <pre>{result.stdout}</pre> : null}
              {result.stderr ? <pre className="stderr">{result.stderr}</pre> : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function TelemetryMap({ status }: { status: TelemetryStatus | null }) {
  const [tracks, setTracks] = useState<Record<string, Array<{ lat: number; lon: number }>>>({});
  const vehicles = status?.vehicles ?? [];

  useEffect(() => {
    setTracks((current) => {
      const next = { ...current };
      for (const vehicle of vehicles) {
        const position = vehicle.position ?? vehicle.gps;
        if (typeof position?.lat !== "number" || typeof position.lon !== "number") {
          continue;
        }
        const track = next[vehicle.id] ?? [];
        const last = track.at(-1);
        if (!last || Math.abs(last.lat - position.lat) > 0.000001 || Math.abs(last.lon - position.lon) > 0.000001) {
          next[vehicle.id] = [...track, { lat: position.lat, lon: position.lon }].slice(-80);
        }
      }
      return next;
    });
  }, [vehicles]);

  const points = Object.values(tracks).flat();
  const livePoints = vehicles
    .map((vehicle) => {
      const position = vehicle.position ?? vehicle.gps;
      return typeof position?.lat === "number" && typeof position.lon === "number"
        ? { id: vehicle.id, sysid: vehicle.sysid, lat: position.lat, lon: position.lon }
        : null;
    })
    .filter((point): point is { id: string; sysid: number; lat: number; lon: number } => Boolean(point));
  const allPoints = [...points, ...livePoints];
  const bounds = allPoints.length
    ? {
        minLat: Math.min(...allPoints.map((point) => point.lat)),
        maxLat: Math.max(...allPoints.map((point) => point.lat)),
        minLon: Math.min(...allPoints.map((point) => point.lon)),
        maxLon: Math.max(...allPoints.map((point) => point.lon))
      }
    : null;
  const project = (point: { lat: number; lon: number }) => {
    if (!bounds) {
      return { x: 50, y: 50 };
    }
    const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 0.0008);
    const latSpan = Math.max(bounds.maxLat - bounds.minLat, 0.0008);
    return {
      x: 8 + ((point.lon - bounds.minLon) / lonSpan) * 84,
      y: 92 - ((point.lat - bounds.minLat) / latSpan) * 84
    };
  };

  return (
    <section className="telemetry-map">
      <div className="mavlink-command-title">
        <strong>Flight Trace</strong>
        <span>{livePoints.length ? `${livePoints.length} live` : "Waiting"}</span>
      </div>
      <svg viewBox="0 0 100 100" role="img" aria-label="Live vehicle map">
        <path d="M10 20H90M10 40H90M10 60H90M10 80H90M20 10V90M40 10V90M60 10V90M80 10V90" />
        {Object.entries(tracks).map(([id, track]) => {
          const path = track
            .map((point, index) => {
              const projected = project(point);
              return `${index === 0 ? "M" : "L"}${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
            })
            .join(" ");
          return path ? <path className="trace" d={path} key={id} /> : null;
        })}
        {livePoints.map((point) => {
          const projected = project(point);
          return (
            <g className="vehicle-dot" key={point.id} transform={`translate(${projected.x} ${projected.y})`}>
              <circle r="3.4" />
              <text x="5" y="3">
                {point.sysid}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function MissionPanel({
  telemetry,
  mission,
  onUpload,
  onDownload,
  onSaveDownloaded
}: {
  telemetry: TelemetryStatus | null;
  mission: MissionSyncStatus | null;
  onUpload: (vehicle: TelemetryStatus["vehicles"][number]) => void;
  onDownload: (vehicle: TelemetryStatus["vehicles"][number]) => void;
  onSaveDownloaded: () => void;
}) {
  const vehicles = telemetry?.vehicles ?? [];
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? vehicles[0];

  useEffect(() => {
    if (!selectedVehicleId && vehicles[0]) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [selectedVehicleId, vehicles]);

  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>Mission Sync</span>
        <span className={`status-pill ${mission?.active ? "neutral" : "good"}`}>{mission?.active ? "Syncing" : "Ready"}</span>
      </div>

      <section className="mission-sync-panel">
        <h2>Vehicle</h2>
        {vehicles.length === 0 ? (
          <div className="empty-state">Start telemetry and wait for a vehicle before mission sync.</div>
        ) : (
          <label className="field">
            <span>Target</span>
            <select value={selectedVehicle?.id ?? ""} onChange={(event) => setSelectedVehicleId(event.target.value)}>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  SYS {vehicle.sysid} / COMP {vehicle.compid}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="action-grid">
          <button type="button" disabled={!selectedVehicle || mission?.active} onClick={() => selectedVehicle && onUpload(selectedVehicle)}>
            <Play size={16} />
            <span>Upload</span>
          </button>
          <button type="button" disabled={!selectedVehicle || mission?.active} onClick={() => selectedVehicle && onDownload(selectedVehicle)}>
            <Download size={16} />
            <span>Download</span>
          </button>
        </div>

        <div className="mission-status-card">
          <strong>{mission?.message ?? "Mission sync idle"}</strong>
          <span>
            {mission?.direction ?? "idle"} / {mission?.expectedCount ?? 0} item target
          </span>
          <small>
            Upload {mission?.uploadedCount ?? 0} / Download {mission?.downloadedCount ?? 0}
          </small>
        </div>

        {mission?.missionText ? (
          <button className="guide-action" type="button" onClick={onSaveDownloaded}>
            <Save size={15} />
            <span>Save Downloaded Mission</span>
          </button>
        ) : null}
      </section>
    </div>
  );
}

function BomPanel({
  rows,
  onExportCsv,
  onExportHtml
}: {
  rows: BomRow[];
  onExportCsv: () => void;
  onExportHtml: () => void;
}) {
  const totalMassG = rows.reduce((sum, row) => sum + row.massG, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.unitCostUsd, 0);

  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>Bill of Materials</span>
        <span className="status-pill neutral">{rows.length} items</span>
      </div>
      <div className="ai-metric-grid">
        <div className="ai-metric-card">
          <span>Total Mass</span>
          <strong>
            {formatMetric(totalMassG / 1000, 2, true)}
            <small>kg</small>
          </strong>
        </div>
        <div className="ai-metric-card">
          <span>Total Cost</span>
          <strong>
            {formatMetric(totalCost, 2, true)}
            <small>USD</small>
          </strong>
        </div>
      </div>
      <div className="artifact-grid">
        <button type="button" onClick={onExportCsv}>
          <Download size={16} />
          <span>CSV</span>
        </button>
        <button type="button" onClick={onExportHtml}>
          <FileJson size={16} />
          <span>PDF Page</span>
        </button>
      </div>
      <section className="bom-table">
        {rows.length === 0 ? (
          <div className="empty-state">Add components to build a bill of materials.</div>
        ) : (
          rows.map((row) => (
            <article key={row.id}>
              <div>
                <strong>{row.label}</strong>
                <span>{row.componentType}</span>
              </div>
              <p>
                {row.manufacturer || "--"} {row.model || ""}
              </p>
              <small>
                {row.massG.toFixed(1)} g / ${row.unitCostUsd.toFixed(2)}
              </small>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function ParamExplanationPanel({
  explanations,
  onRefresh,
  onExport
}: {
  explanations: ParamExplanation[];
  onRefresh: () => void;
  onExport: () => void;
}) {
  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>Param Explanation</span>
        <span className="panel-actions">
          <button className="icon-button" type="button" title="Refresh explanations" onClick={onRefresh}>
            <RefreshCw size={16} />
          </button>
          <button className="icon-button" type="button" title="Export params" onClick={onExport}>
            <Download size={16} />
          </button>
        </span>
      </div>
      <section className="param-explain-list">
        {explanations.length === 0 ? (
          <div className="empty-state">Refresh to explain the generated parameter file.</div>
        ) : (
          explanations.map((entry) => (
            <article key={entry.parameter}>
              <div>
                <strong>{entry.parameter}</strong>
                <code>{entry.value}</code>
              </div>
              <span>{entry.source}</span>
              <p>{entry.reason}</p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function ComparePanel({
  current,
  comparison,
  onLoadClick
}: {
  current: { validationScore: number; estimate: PerformanceEstimate; name: string };
  comparison: { validationScore: number; estimate: PerformanceEstimate; name: string } | null;
  onLoadClick: () => void;
}) {
  const rows = [
    {
      label: "Validation",
      current: current.validationScore,
      comparison: comparison?.validationScore,
      unit: "score"
    },
    {
      label: "Mass",
      current: current.estimate.totalMassG / 1000,
      comparison: comparison ? comparison.estimate.totalMassG / 1000 : undefined,
      unit: "kg"
    },
    {
      label: "Endurance",
      current: current.estimate.hoverEnduranceMin,
      comparison: comparison?.estimate.hoverEnduranceMin,
      unit: "min"
    },
    {
      label: "Range",
      current: current.estimate.rangeKm,
      comparison: comparison?.estimate.rangeKm,
      unit: "km"
    }
  ];

  return (
    <div className="detail-content">
      <div className="panel-title">
        <span>Design Compare</span>
        <button className="icon-button" type="button" title="Load comparison workspace" onClick={onLoadClick}>
          <FolderOpen size={16} />
        </button>
      </div>
      <section className="compare-panel">
        <div className="compare-header">
          <strong>{current.name}</strong>
          <span>{comparison?.name ?? "Load .saq"}</span>
        </div>
        {rows.map((row) => {
          const delta = typeof row.comparison === "number" ? row.current - row.comparison : undefined;
          return (
            <div className="compare-row" key={row.label}>
              <span>{row.label}</span>
              <strong>
                {formatMetric(row.current, row.label === "Validation" ? 0 : 2, true)} {row.unit}
              </strong>
              <strong>
                {typeof row.comparison === "number" ? `${formatMetric(row.comparison, row.label === "Validation" ? 0 : 2, true)} ${row.unit}` : "--"}
              </strong>
              <small>{typeof delta === "number" ? `${delta >= 0 ? "+" : ""}${formatMetric(delta, 2, true)}` : "--"}</small>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function App() {
  const { fitView } = useReactFlow<DesignNode, DesignEdge>();
  const starterDesign = useMemo(() => createStarterDesign(), []);
  const initialHistoryEntry = useMemo(
    () => createHistoryEntry(createWorkspaceSnapshot(starterDesign.id, starterDesign.name, starterDesign.nodes, starterDesign.edges, starterDesign.settings)),
    [starterDesign]
  );
  const [designId, setDesignId] = useState<string | undefined>(starterDesign.id);
  const [designName, setDesignName] = useState(starterDesign.name);
  const [nodes, setNodes] = useState<DesignNode[]>(starterDesign.nodes);
  const [edges, setEdges] = useState<DesignEdge[]>(starterDesign.edges);
  const [settings, setSettings] = useState<SimulationSettings>(starterDesign.settings);
  const [undoStack, setUndoStack] = useState<WorkspaceHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<WorkspaceHistoryEntry[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("fc-1");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoveredConnection, setHoveredConnection] = useState<HoveredConnection | null>(null);
  const [contextMenu, setContextMenu] = useState<ObjectContextMenu | null>(null);
  const [tab, setTab] = useState<AppTab>("inspector");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [sitlPlan, setSitlPlan] = useState<SitlPlan | null>(null);
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatus | null>(null);
  const [telemetryPort, setTelemetryPort] = useState(14552);
  const [customComponents, setCustomComponents] = useState<CustomComponentTemplate[]>([]);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [terminalCommand, setTerminalCommand] = useState("npm run build");
  const [terminalHistory, setTerminalHistory] = useState<TerminalResult[]>([]);
  const [terminalRunning, setTerminalRunning] = useState(false);
  const [softwareUpdating, setSoftwareUpdating] = useState(false);
  const [gazeboStatus, setGazeboStatus] = useState<GazeboStatus | null>(null);
  const [gazeboCompileResult, setGazeboCompileResult] = useState<GazeboCompileResult | null>(null);
  const [gazeboCompiling, setGazeboCompiling] = useState(false);
  const [setupDiagnostics, setSetupDiagnostics] = useState<SetupDiagnostics | null>(null);
  const [setupChecking, setSetupChecking] = useState(false);
  const [missionStatus, setMissionStatus] = useState<MissionSyncStatus | null>(null);
  const [paramExplanations, setParamExplanations] = useState<ParamExplanation[]>([]);
  const [scenarioRunResult, setScenarioRunResult] = useState<ScenarioRunResult | null>(null);
  const [comparisonDesign, setComparisonDesign] = useState<UavDesign | null>(null);
  const workspaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const missionFileInputRef = useRef<HTMLInputElement | null>(null);
  const comparisonFileInputRef = useRef<HTMLInputElement | null>(null);
  const historyCurrentRef = useRef<WorkspaceHistoryEntry>(initialHistoryEntry);
  const historyApplyingRef = useRef(false);
  const undoStackRef = useRef<WorkspaceHistoryEntry[]>([]);
  const redoStackRef = useRef<WorkspaceHistoryEntry[]>([]);

  const replaceUndoStack = useCallback((nextStack: WorkspaceHistoryEntry[]) => {
    undoStackRef.current = nextStack;
    setUndoStack(nextStack);
  }, []);

  const replaceRedoStack = useCallback((nextStack: WorkspaceHistoryEntry[]) => {
    redoStackRef.current = nextStack;
    setRedoStack(nextStack);
  }, []);

  const applyHistorySnapshot = useCallback(
    (snapshot: WorkspaceSnapshot, message: string) => {
      const cleanSnapshot = cloneWorkspaceSnapshot(snapshot);
      historyApplyingRef.current = true;
      setDesignId(cleanSnapshot.id);
      setDesignName(cleanSnapshot.name);
      setNodes(cleanSnapshot.nodes);
      setEdges(cleanSnapshot.edges);
      setSettings(cleanSnapshot.settings);
      setSelectedNodeId(cleanSnapshot.nodes[0]?.id ?? null);
      setSelectedEdgeId(null);
      setHoveredConnection(null);
      setContextMenu(null);
      setSitlPlan(null);
      setStatusMessage(message);

      if (cleanSnapshot.nodes.length > 0) {
        window.setTimeout(() => {
          void fitView({ duration: 350, padding: 0.22, maxZoom: 1.05 });
        }, 50);
      }
    },
    [fitView]
  );

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  useEffect(() => {
    getSystemStatus()
      .then(setSystemStatus)
      .catch((error: Error) => setStatusMessage(error.message));
  }, []);

  useEffect(() => {
    listCustomComponents()
      .then((result) => setCustomComponents(result.components))
      .catch((error: Error) => setStatusMessage(error.message));
  }, []);

  const refreshGazeboStatus = useCallback(() => {
    getGazeboStatus()
      .then(setGazeboStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshGazeboStatus();
  }, [refreshGazeboStatus]);

  const refreshLogs = useCallback(() => {
    getLogs(250)
      .then((result) => setLogs(result.logs))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshLogs();
    const interval = window.setInterval(refreshLogs, 3000);
    return () => window.clearInterval(interval);
  }, [refreshLogs]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      getTelemetryStatus()
        .then((status) => {
          if (!mounted) {
            return;
          }
          setTelemetryStatus(status);
          if (status.listener.active) {
            setTelemetryPort(status.listener.port);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      getMissionStatus()
        .then((result) => {
          if (mounted) {
            setMissionStatus(result.mission);
          }
        })
        .catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const historySnapshot = useMemo(
    () => createWorkspaceSnapshot(designId, designName, nodes, edges, settings),
    [designId, designName, edges, nodes, settings]
  );

  useEffect(() => {
    const nextEntry = createHistoryEntry(historySnapshot);

    if (historyApplyingRef.current) {
      historyCurrentRef.current = nextEntry;
      historyApplyingRef.current = false;
      return;
    }

    if (nextEntry.serialized === historyCurrentRef.current.serialized) {
      return;
    }

    replaceUndoStack([...undoStackRef.current, historyCurrentRef.current].slice(-HISTORY_LIMIT));
    replaceRedoStack([]);
    historyCurrentRef.current = nextEntry;
  }, [historySnapshot, replaceRedoStack, replaceUndoStack]);

  const handleUndo = useCallback(() => {
    const previousEntry = undoStackRef.current.at(-1);
    if (!previousEntry) {
      setStatusMessage("Nothing to undo");
      return;
    }

    replaceUndoStack(undoStackRef.current.slice(0, -1));
    replaceRedoStack([historyCurrentRef.current, ...redoStackRef.current].slice(0, HISTORY_LIMIT));
    applyHistorySnapshot(previousEntry.snapshot, "Undo applied");
  }, [applyHistorySnapshot, replaceRedoStack, replaceUndoStack]);

  const handleRedo = useCallback(() => {
    const nextEntry = redoStackRef.current[0];
    if (!nextEntry) {
      setStatusMessage("Nothing to redo");
      return;
    }

    replaceUndoStack([...undoStackRef.current, historyCurrentRef.current].slice(-HISTORY_LIMIT));
    replaceRedoStack(redoStackRef.current.slice(1));
    applyHistorySnapshot(nextEntry.snapshot, "Redo applied");
  }, [applyHistorySnapshot, replaceRedoStack, replaceUndoStack]);

  const validation = useMemo(() => validateDesign(nodes, edges, settings), [nodes, edges, settings]);

  const clearSelection = useCallback(() => {
    setNodes((currentNodes) => currentNodes.map((node): DesignNode => ({ ...node, selected: false })));
    setEdges((currentEdges) => currentEdges.map((edge): DesignEdge => ({ ...edge, selected: false })));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
  }, []);

  const selectNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      setNodes((currentNodes) => currentNodes.map((candidate): DesignNode => ({ ...candidate, selected: candidate.id === nodeId })));
      setEdges((currentEdges) => currentEdges.map((edge): DesignEdge => ({ ...edge, selected: false })));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setTab("inspector");
      setStatusMessage(node ? `${node.data.label} selected` : "Component selected");
    },
    [nodes]
  );

  const selectEdge = useCallback(
    (edgeId: string) => {
      const edge = edges.find((candidate) => candidate.id === edgeId);
      setEdges((currentEdges) => currentEdges.map((candidate): DesignEdge => ({ ...candidate, selected: candidate.id === edgeId })));
      setNodes((currentNodes) => currentNodes.map((node): DesignNode => ({ ...node, selected: false })));
      setSelectedEdgeId(edgeId);
      setSelectedNodeId(null);
      setTab("inspector");
      setStatusMessage(edge ? `${connectionDetails(edge, nodes).label} connection selected` : "Connection selected");
    },
    [edges, nodes]
  );

  const editNode = useCallback((nodeId: string) => selectNode(nodeId), [selectNode]);

  const nodeIssueMap = useMemo(() => {
    const map = new Map<string, "error" | "warning" | "ok">();
    for (const node of nodes) {
      map.set(node.id, "ok");
    }
    for (const issue of validation.issues) {
      for (const nodeId of issue.nodeIds ?? []) {
        const current = map.get(nodeId);
        if (issue.severity === "error") {
          map.set(nodeId, "error");
        } else if (issue.severity === "warning" && current !== "error") {
          map.set(nodeId, "warning");
        }
      }
    }
    return map;
  }, [nodes, validation.issues]);

  const visibleNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId || node.selected,
        data: {
          ...node.data,
          health: nodeIssueMap.get(node.id) ?? "ok",
          onEdit: () => editNode(node.id)
        }
      })),
    [editNode, nodeIssueMap, nodes, selectedNodeId]
  );

  const edgeIssueMap = useMemo(() => {
    const map = new Map<string, "error" | "warning">();
    for (const issue of validation.issues) {
      for (const edgeId of issue.edgeIds ?? []) {
        if (issue.severity === "error") {
          map.set(edgeId, "error");
        } else if (!map.has(edgeId)) {
          map.set(edgeId, "warning");
        }
      }
    }
    return map;
  }, [validation.issues]);

  const edgeIssueMessageMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of validation.issues) {
      for (const edgeId of issue.edgeIds ?? []) {
        const messages = map.get(edgeId) ?? [];
        messages.push(`${issue.title}: ${issue.message}`);
        map.set(edgeId, messages);
      }
    }
    return map;
  }, [validation.issues]);

  const visibleEdges = useMemo(
    () =>
      edges.map((edge) => {
        const signal = signalForEdge(edge, nodes);
        const issue = edgeIssueMap.get(edge.id);
        const issueMessages = edgeIssueMessageMap.get(edge.id) ?? [];
        const color = issue === "error" ? "#c83f3f" : issue === "warning" ? "#c56b21" : signal ? signalColors[signal] : "#8ca0a5";
        const displayEdge = { ...edge, data: { ...edge.data, signal, issues: issueMessages } };
        const details = connectionDetails(displayEdge, nodes);
        return {
          ...edge,
          ariaLabel: connectionTooltip(displayEdge, nodes),
          data: displayEdge.data,
          focusable: true,
          interactionWidth: 26,
          label: details.label,
          labelBgBorderRadius: 6,
          labelBgPadding: [5, 3] as [number, number],
          labelBgStyle: { fill: issue ? "#fff7ed" : "#ffffff", fillOpacity: 0.94 },
          labelShowBg: true,
          labelStyle: { fill: color, fontSize: 10, fontWeight: 900 },
          markerEnd: { type: MarkerType.ArrowClosed, color },
          reconnectable: true,
          selectable: true,
          selected: edge.id === selectedEdgeId || edge.selected,
          style: { ...edge.style, stroke: color },
          className: [signal ? `edge-signal-${signal}` : undefined, issue ? `edge-${issue}` : undefined].filter(Boolean).join(" ") || undefined
        };
      }),
    [edgeIssueMap, edgeIssueMessageMap, edges, nodes, selectedEdgeId]
  );

  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = selectedEdgeId ? edges.find((edge) => edge.id === selectedEdgeId) ?? null : null;
  const selectedEdgeDetails = selectedEdge
    ? connectionDetails(
        {
          ...selectedEdge,
          data: {
            ...selectedEdge.data,
            signal: signalForEdge(selectedEdge, nodes),
            issues: edgeIssueMessageMap.get(selectedEdge.id) ?? []
          }
        },
        nodes
      )
    : null;
  const hoveredEdge = hoveredConnection
    ? visibleEdges.find((edge) => edge.id === hoveredConnection.edgeId) ?? edges.find((edge) => edge.id === hoveredConnection.edgeId) ?? null
    : null;
  const hoveredEdgeDetails = hoveredEdge ? connectionDetails(hoveredEdge, nodes) : null;
  const hoveredTooltipPosition = hoveredConnection ? anchoredLayerPosition(hoveredConnection, 280, 142, 12) : null;
  const selectedDefinition = selectedNode ? getComponentDefinition(selectedNode.data.componentType) : null;
  const gcsTargets = useMemo(() => targetDefaults(settings), [settings]);
  const buildGuide = useMemo(() => buildGuideFor(nodes, settings), [nodes, settings]);
  const performanceEstimate = useMemo(() => analyzePerformance(nodes, settings, selectedNode), [nodes, selectedNode, settings]);
  const wireSuggestions = useMemo(() => autoWireSuggestions(nodes, edges, settings), [edges, nodes, settings]);
  const bomRows = useMemo(() => bomRowsFor(nodes), [nodes]);
  const comparisonSummary = useMemo(() => {
    if (!comparisonDesign) {
      return null;
    }
    return {
      name: comparisonDesign.name,
      validationScore: validateDesign(comparisonDesign.nodes, comparisonDesign.edges, comparisonDesign.settings).score,
      estimate: analyzePerformance(comparisonDesign.nodes, comparisonDesign.settings)
    };
  }, [comparisonDesign]);

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) {
      return componentCatalog;
    }
    return componentCatalog.filter(
      (component) =>
        component.name.toLowerCase().includes(query) ||
        component.category.toLowerCase().includes(query) ||
        component.summary.toLowerCase().includes(query)
    );
  }, [catalogQuery]);

  const filteredCustomComponents = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) {
      return customComponents;
    }
    return customComponents.filter(
      (component) =>
        component.name.toLowerCase().includes(query) ||
        component.baseType.toLowerCase().includes(query) ||
        String(component.summary ?? "").toLowerCase().includes(query)
    );
  }, [catalogQuery, customComponents]);

  const filteredProductTemplates = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) {
      return productTemplates;
    }
    return productTemplates.filter(
      (component) =>
        component.name.toLowerCase().includes(query) ||
        component.baseType.toLowerCase().includes(query) ||
        String(component.summary ?? "").toLowerCase().includes(query)
    );
  }, [catalogQuery]);

  const onNodesChange = useCallback(
    (changes: NodeChange<DesignNode>[]) => {
      const removedNodeIds: string[] = [];
      let selectedNodeChange: string | null = null;

      for (const change of changes) {
        if (change.type === "select" && change.selected) {
          selectedNodeChange = change.id;
        }
        if (change.type === "remove") {
          removedNodeIds.push(change.id);
        }
      }

      setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));

      if (selectedNodeChange) {
        setSelectedNodeId(selectedNodeChange);
        setSelectedEdgeId(null);
        setEdges((currentEdges) => currentEdges.map((edge): DesignEdge => ({ ...edge, selected: false })));
        setTab("inspector");
        setContextMenu(null);
      }

      if (removedNodeIds.length > 0) {
        const removed = new Set(removedNodeIds);
        setEdges((currentEdges) => currentEdges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)));
        setSelectedNodeId((currentSelectedId) => (currentSelectedId && removed.has(currentSelectedId) ? null : currentSelectedId));
        setSelectedEdgeId((currentSelectedId) => {
          const selectedEdgeWasRemoved = currentSelectedId
            ? edges.some((edge) => edge.id === currentSelectedId && (removed.has(edge.source) || removed.has(edge.target)))
            : false;
          return selectedEdgeWasRemoved ? null : currentSelectedId;
        });
      }
    },
    [edges, setEdges, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<DesignEdge>[]) => {
      const removedEdgeIds: string[] = [];
      let selectedEdgeChange: string | null = null;

      for (const change of changes) {
        if (change.type === "select" && change.selected) {
          selectedEdgeChange = change.id;
        }
        if (change.type === "remove") {
          removedEdgeIds.push(change.id);
        }
      }

      setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));

      if (selectedEdgeChange) {
        setSelectedEdgeId(selectedEdgeChange);
        setSelectedNodeId(null);
        setNodes((currentNodes) => currentNodes.map((node): DesignNode => ({ ...node, selected: false })));
        setTab("inspector");
        setContextMenu(null);
      }

      if (removedEdgeIds.length > 0) {
        const removed = new Set(removedEdgeIds);
        setSelectedEdgeId((currentSelectedId) => (currentSelectedId && removed.has(currentSelectedId) ? null : currentSelectedId));
      }
    },
    [setEdges, setNodes]
  );

  const isValidConnection = useCallback((connection: Connection | DesignEdge) => checkPortConnection(connection, nodes).valid, [nodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const portCheck = checkPortConnection(connection, nodes);
      if (!portCheck.valid) {
        setStatusMessage(portCheck.message);
        return;
      }

      if (edges.some((edge) => sameConnection(edge, connection))) {
        setStatusMessage("Connection already exists");
        return;
      }

      const candidate: DesignEdge = {
        ...connection,
        id: `edge-${crypto.randomUUID()}`,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        selected: true,
        data: {
          signal: signalForEdge(connection as DesignEdge, nodes)
        }
      };
      const nextValidation = validateDesign(nodes, [...edges, candidate], settings);
      const blocking = nextValidation.issues.find(
        (issue) => issue.severity === "error" && issue.edgeIds?.includes(candidate.id)
      );

      if (blocking) {
        setStatusMessage(blocking.message);
        return;
      }

      setEdges((currentEdges) => addEdge(candidate, currentEdges.map((edge): DesignEdge => ({ ...edge, selected: false }))));
      setNodes((currentNodes) => currentNodes.map((node): DesignNode => ({ ...node, selected: false })));
      setSelectedEdgeId(candidate.id);
      setSelectedNodeId(null);
      setTab("inspector");
      setStatusMessage("Connection added");
    },
    [edges, nodes, settings]
  );

  const onReconnect = useCallback(
    (oldEdge: DesignEdge, connection: Connection) => {
      const portCheck = checkPortConnection(connection, nodes);
      if (!portCheck.valid) {
        setStatusMessage(portCheck.message);
        return;
      }

      if (edges.some((edge) => edge.id !== oldEdge.id && sameConnection(edge, connection))) {
        setStatusMessage("Connection already exists");
        return;
      }

      const candidate: DesignEdge = {
        ...oldEdge,
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        target: connection.target,
        targetHandle: connection.targetHandle,
        data: {
          ...oldEdge.data,
          signal: signalForEdge({ ...oldEdge, ...connection } as DesignEdge, nodes)
        }
      };
      const nextEdges = edges.map((edge) => (edge.id === oldEdge.id ? candidate : edge));
      const nextValidation = validateDesign(nodes, nextEdges, settings);
      const blocking = nextValidation.issues.find((issue) => issue.severity === "error" && issue.edgeIds?.includes(oldEdge.id));

      if (blocking) {
        setStatusMessage(blocking.message);
        return;
      }

      setEdges((currentEdges) =>
        reconnectEdge(oldEdge, connection, currentEdges, { shouldReplaceId: false }).map((edge): DesignEdge =>
          edge.id === oldEdge.id
            ? {
                ...edge,
                selected: true,
                data: {
                  ...edge.data,
                  signal: signalForEdge(edge, nodes)
                }
              }
            : { ...edge, selected: false }
        )
      );
      setNodes((currentNodes) => currentNodes.map((node): DesignNode => ({ ...node, selected: false })));
      setSelectedEdgeId(oldEdge.id);
      setSelectedNodeId(null);
      setTab("inspector");
      setStatusMessage("Connection reconnected");
    },
    [edges, nodes, settings]
  );

  const addComponent = (definition: ComponentDefinition) => {
    const limit = componentLimitStatus(definition.type, nodes, settings);
    if (!limit.allowed) {
      setStatusMessage(limit.message ?? `${definition.name} limit reached`);
      return;
    }

    const node: DesignNode = {
      ...createComponentNode(definition.type, nodes.length),
      position: findOpenNodePosition(nodes, definition.type),
      selected: true
    };
    setNodes((currentNodes) => [...currentNodes.map((currentNode): DesignNode => ({ ...currentNode, selected: false })), node]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setContextMenu(null);
    setTab("inspector");
    setStatusMessage(`${definition.name} added`);
    window.setTimeout(() => {
      void fitView({ nodes: [{ id: node.id }], duration: 450, padding: 0.75, maxZoom: 1.05 });
    }, 50);
  };

  const addCustomComponent = (template: CustomComponentTemplate) => {
    let definition: ComponentDefinition;
    try {
      definition = getComponentDefinition(template.baseType);
    } catch {
      setStatusMessage(`${template.name} uses a component type that is no longer available`);
      return;
    }

    const limit = componentLimitStatus(definition.type, nodes, settings);
    if (!limit.allowed) {
      setStatusMessage(limit.message ?? `${definition.name} limit reached`);
      return;
    }

    const node: DesignNode = {
      ...createComponentNode(definition.type, nodes.length),
      position: findOpenNodePosition(nodes, definition.type),
      selected: true,
      data: {
        componentType: definition.type,
        label: template.name,
        properties: {
          ...defaultPropertiesForComponent(definition.type),
          ...template.properties
        }
      }
    };

    setNodes((currentNodes) => [...currentNodes.map((currentNode): DesignNode => ({ ...currentNode, selected: false })), node]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setContextMenu(null);
    setTab("inspector");
    setStatusMessage(`${template.name} added`);
    window.setTimeout(() => {
      void fitView({ nodes: [{ id: node.id }], duration: 450, padding: 0.75, maxZoom: 1.05 });
    }, 50);
  };

  const handleSaveSelectedAsCustom = async () => {
    if (!selectedNode || !selectedDefinition) {
      setStatusMessage("Select a component before saving to the library");
      return;
    }

    try {
      const result = await saveCustomComponent({
        name: selectedNode.data.label,
        baseType: selectedNode.data.componentType,
        category: selectedDefinition.category,
        summary: `Saved ${selectedDefinition.name} template`,
        properties: selectedNode.data.properties
      });
      setCustomComponents((current) => [result.component, ...current.filter((component) => component.id !== result.component.id)]);
      setStatusMessage(`${result.component.name} saved to custom library`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save custom component");
    }
  };

  const handleDeleteCustomComponent = async (component: CustomComponentTemplate) => {
    if (!component.id) {
      return;
    }

    try {
      await deleteCustomComponent(component.id);
      setCustomComponents((current) => current.filter((entry) => entry.id !== component.id));
      setStatusMessage(`${component.name} removed from custom library`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not remove custom component");
    }
  };

  const addGuideComponent = () => {
    if (!buildGuide.next) {
      setStatusMessage("Guided sequence complete");
      return;
    }
    addComponent(buildGuide.next.definition);
  };

  const applyAutoWireSuggestions = (suggestions = wireSuggestions) => {
    if (suggestions.length === 0) {
      setStatusMessage("No safe auto-wire suggestions available");
      return;
    }

    const nextEdges = suggestions.map((suggestion): DesignEdge => ({
      id: `edge-${crypto.randomUUID()}`,
      source: suggestion.sourceId,
      sourceHandle: suggestion.sourceHandle,
      target: suggestion.targetId,
      targetHandle: suggestion.targetHandle,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { signal: suggestion.signal }
    }));

    setEdges((currentEdges) => [...currentEdges.map((edge): DesignEdge => ({ ...edge, selected: false })), ...nextEdges]);
    setSelectedEdgeId(nextEdges.at(-1)?.id ?? null);
    setSelectedNodeId(null);
    setTab("validation");
    setStatusMessage(`${nextEdges.length} connection${nextEdges.length === 1 ? "" : "s"} added by Auto-Wire`);
  };

  const updateFrameSetting = (frame: string) => {
    const normalizedFrame = normalizeAirframeValue(frame);
    const nextSettings = { ...settings, frame: normalizedFrame };
    const frameUpdatedNodes = nodes.map((node) =>
      node.data.componentType === "frame"
        ? {
            ...node,
            data: {
              ...node.data,
              properties: {
                ...node.data.properties,
                layout: normalizedFrame
              }
            }
          }
        : node
    );
    const trimmed = trimPropulsionForAirframe(frameUpdatedNodes, nextSettings);
    const removed = new Set(trimmed.removedIds);
    const removedNodes = frameUpdatedNodes.filter((node) => removed.has(node.id));

    setSettings(nextSettings);
    setNodes(trimmed.nodes);
    setEdges((currentEdges) => currentEdges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)));
    setSelectedNodeId((currentSelectedId) => (currentSelectedId && removed.has(currentSelectedId) ? null : currentSelectedId));
    setSelectedEdgeId((currentSelectedId) => {
      if (!currentSelectedId) {
        return null;
      }
      const selectedEdgeWasRemoved = edges.some((edge) => edge.id === currentSelectedId && (removed.has(edge.source) || removed.has(edge.target)));
      return selectedEdgeWasRemoved ? null : currentSelectedId;
    });
    setStatusMessage(propulsionTrimMessage(removedNodes, normalizedFrame));
  };

  const updateSelectedProperty = (key: string, value: string | number | boolean) => {
    if (!selectedNode) {
      return;
    }

    if (selectedNode.data.componentType === "frame" && key === "layout" && typeof value === "string") {
      updateFrameSetting(value);
      return;
    }

    const normalizedValue =
      selectedNode.data.componentType === "frame" && key === "layout" && typeof value === "string" ? normalizeAirframeValue(value) : value;

    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                properties: {
                  ...node.data.properties,
                  [key]: normalizedValue
                }
              }
            }
          : node
      )
    );
  };

  const updateSelectedLabel = (label: string) => {
    if (!selectedNode) {
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                label
              }
            }
          : node
      )
    );
  };

  const updateSelectedPosition = (axis: "x" | "y", value: number) => {
    if (!selectedNode || Number.isNaN(value)) {
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              position: {
                ...node.position,
                [axis]: value
              }
            }
          : node
      )
    );
  };

  const focusSelectedNode = () => {
    if (!selectedNode) {
      return;
    }

    void fitView({ nodes: [{ id: selectedNode.id }], duration: 350, padding: 0.75, maxZoom: 1.05 });
    setStatusMessage(`${selectedNode.data.label} centered`);
  };

  const duplicateSelectedNode = () => {
    if (!selectedNode) {
      return;
    }

    const limit = componentLimitStatus(selectedNode.data.componentType, nodes, settings);
    if (!limit.allowed) {
      setStatusMessage(limit.message ?? "Component limit reached");
      return;
    }

    const duplicate: DesignNode = {
      id: `${selectedNode.data.componentType}-${crypto.randomUUID()}`,
      type: "componentNode",
      position: findOpenNodePosition(nodes, selectedNode.data.componentType, {
        x: selectedNode.position.x + NODE_CARD_WIDTH + NODE_PLACEMENT_GAP,
        y: selectedNode.position.y
      }),
      data: {
        componentType: selectedNode.data.componentType,
        label: `${selectedNode.data.label} copy`,
        properties: { ...selectedNode.data.properties }
      },
      selected: true
    };

    setNodes((currentNodes) => [...currentNodes.map((node): DesignNode => ({ ...node, selected: false })), duplicate]);
    setSelectedNodeId(duplicate.id);
    setSelectedEdgeId(null);
    setContextMenu(null);
    setTab("inspector");
    setStatusMessage("Component duplicated");
    window.setTimeout(() => {
      void fitView({ nodes: [{ id: duplicate.id }], duration: 350, padding: 0.75, maxZoom: 1.05 });
    }, 50);
  };

  const removeSelectedNode = () => {
    if (!selectedNode) {
      return;
    }
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNode.id));
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContextMenu(null);
    setStatusMessage("Component removed");
  };

  const removeSelectedEdge = () => {
    if (!selectedEdge) {
      return;
    }

    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdge.id));
    setSelectedEdgeId(null);
    setContextMenu(null);
    setStatusMessage("Connection removed");
  };

  const focusNodeById = (nodeId: string) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) {
      return;
    }

    void fitView({ nodes: [{ id: node.id }], duration: 350, padding: 0.75, maxZoom: 1.05 });
    setStatusMessage(`${node.data.label} centered`);
    setContextMenu(null);
  };

  const currentDesign = () => designFromState(designName, nodes, edges, settings, designId);

  const refreshSetupDiagnostics = async () => {
    setSetupChecking(true);
    setStatusMessage("Checking local setup...");
    try {
      const diagnostics = await getSetupDiagnostics();
      setSetupDiagnostics(diagnostics);
      setStatusMessage(diagnostics.ready ? "Setup diagnostics ready" : "Setup diagnostics found missing optional or required tools");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Setup diagnostics failed");
    } finally {
      setSetupChecking(false);
    }
  };

  const refreshParamExplanations = async () => {
    try {
      const result = await explainParamFile(currentDesign());
      setParamExplanations(result.explanations);
      setStatusMessage("Parameter explanation refreshed");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not explain parameter file");
    }
  };

  const handleBomCsvDownload = async () => {
    await handleArtifactDownload(buildBomCsvFile, "Bill of materials CSV exported");
  };

  const handleBomHtmlDownload = async () => {
    await handleArtifactDownload(buildBomHtmlFile, "Printable BOM report exported");
  };

  const handleRunScenario = () => {
    const result = scenarioRunFor(nodes, edges, settings, performanceEstimate);
    setScenarioRunResult(result);
    setStatusMessage(result.passed ? `${scenarioLabel(settings.testScenario)} scenario checks passed` : `${scenarioLabel(settings.testScenario)} scenario needs attention`);
  };

  const handleMissionUpload = async (vehicle: TelemetryStatus["vehicles"][number]) => {
    try {
      const mission = await buildMissionFile(currentDesign());
      const result = await uploadMission(vehicle.sysid, vehicle.compid, mission.content);
      setMissionStatus(result.mission);
      setStatusMessage(result.mission.message);
      refreshLogs();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Mission upload failed");
    }
  };

  const handleMissionDownload = async (vehicle: TelemetryStatus["vehicles"][number]) => {
    try {
      const result = await downloadMission(vehicle.sysid, vehicle.compid);
      setMissionStatus(result.mission);
      setStatusMessage(result.mission.message);
      refreshLogs();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Mission download failed");
    }
  };

  const handleSaveDownloadedMission = () => {
    if (!missionStatus?.missionText) {
      setStatusMessage("No downloaded mission is available yet");
      return;
    }
    downloadText(`${safeFileName(designName)}-downloaded.waypoints`, missionStatus.missionText, "text/plain");
    setStatusMessage("Downloaded mission saved");
  };

  const handleComparisonLoadClick = () => {
    comparisonFileInputRef.current?.click();
  };

  const handleComparisonFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const payload = JSON.parse(await file.text());
      const loadedDesign = normalizeDesignPayload(payload, file.name.replace(/\.saq$/i, ""));
      setComparisonDesign(loadedDesign);
      setStatusMessage(`${file.name} loaded for comparison`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not load comparison workspace");
    }
  };

  const applyWorkspaceDesign = (design: UavDesign, message: string) => {
    const normalized = normalizeDesignPayload(design, design.name);
    setDesignId(normalized.id);
    setDesignName(normalized.name);
    setNodes(normalized.nodes.map((node): DesignNode => ({ ...node, selected: false })));
    setEdges(normalized.edges.map((edge): DesignEdge => ({ ...edge, selected: false })));
    setSettings(settingsWithDefaults(normalized.settings));
    setSelectedNodeId(normalized.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setHoveredConnection(null);
    setContextMenu(null);
    setTab("inspector");
    setSitlPlan(null);
    setStatusMessage(message);
    if (normalized.nodes.length > 0) {
      window.setTimeout(() => {
        void fitView({ duration: 450, padding: 0.22, maxZoom: 1.05 });
      }, 50);
    }
  };

  const handleNewSpace = () => {
    applyWorkspaceDesign(
      {
        name: "Untitled Space",
        nodes: [],
        edges: [],
        settings: settingsWithDefaults()
      },
      "New empty workspace created"
    );
  };

  const handleResetWorkspace = () => {
    applyWorkspaceDesign(createStarterDesign(), "Workspace reset to starter design");
  };

  const handleSaveWorkspaceFile = async (design = currentDesign()) => {
    try {
      const workspaceFile = saqWorkspaceFor(design);
      const result = await saveTextToUserFile(
        `${safeFileName(design.name)}.saq`,
        JSON.stringify(workspaceFile, null, 2),
        "application/vnd.ardupilot-uav-lab.saq+json",
        "ArduPilot UAV Lab workspace"
      );

      if (result === "cancelled") {
        setStatusMessage("Save cancelled");
        return result;
      }

      setStatusMessage(result === "saved" ? "Workspace saved to selected location" : "Workspace downloaded");
      return result;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Workspace save failed");
      return "cancelled";
    }
  };

  const handleLoadWorkspaceClick = () => {
    workspaceFileInputRef.current?.click();
  };

  const handleWorkspaceFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const payload = JSON.parse(await file.text());
      const loadedDesign = normalizeDesignPayload(payload, file.name.replace(/\.saq$/i, ""));
      applyWorkspaceDesign(loadedDesign, `${file.name} loaded`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not load the selected workspace file");
    }
  };

  const handleSave = async () => {
    const design = currentDesign();

    try {
      const fileResult = await handleSaveWorkspaceFile(design);
      if (fileResult === "cancelled") {
        return;
      }

      try {
        const result = await saveDesign(design);
        setDesignId(result.design.id);
      } catch (error) {
        console.warn("Local design catalog save failed", error);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Workspace save failed");
    }
  };

  const handleJsonDownload = async () => {
    try {
      const result = await saveTextToUserFile(
        `${safeFileName(designName)}.uav.json`,
        JSON.stringify(currentDesign(), null, 2),
        "application/json",
        "UAV design JSON"
      );
      setStatusMessage(result === "saved" ? "Design JSON saved to selected location" : result === "downloaded" ? "Design JSON downloaded" : "Export cancelled");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Design JSON export failed");
    }
  };

  const handleParamsDownload = async () => {
    try {
      const design = currentDesign();
      const result = await saveGeneratedTextToUserFile(`${safeFileName(design.name)}.param`, "text/plain", "ArduPilot parameter file", async () => {
        const artifact = await buildParamFile(design);
        return artifact.content;
      });
      setStatusMessage(
        result === "saved" ? "ArduPilot parameter file saved to selected location" : result === "downloaded" ? "ArduPilot parameter file downloaded" : "Export cancelled"
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Parameter export failed");
    }
  };

  const handleArtifactDownload = async (builder: (design: UavDesign) => Promise<ArtifactResult>, message: string) => {
    try {
      downloadArtifact(await builder(currentDesign()));
      setStatusMessage(message);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Export failed");
    }
  };

  const handleBundleDownload = async () => {
    try {
      const bundle = await buildSimulatorBundle(currentDesign());
      downloadBlob(bundle.fileName, bundle.blob);
      setStatusMessage("Simulator export bundle downloaded");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Bundle export failed");
    }
  };

  const handleCompileGazeboPlugins = async () => {
    setGazeboCompiling(true);
    setStatusMessage("Preparing Gazebo plugin build...");
    try {
      const result = await compileGazeboPlugins(currentDesign());
      setGazeboCompileResult(result);
      setGazeboStatus(result.status);
      setStatusMessage(result.message);
      refreshLogs();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Gazebo plugin compilation failed");
    } finally {
      setGazeboCompiling(false);
    }
  };

  const handleMavlinkCommand = async (command: MavlinkCommandRequest) => {
    const result = await sendMavlinkCommand(command);
    setStatusMessage(result.message);
    refreshLogs();
  };

  const handleMissionImportClick = () => {
    missionFileInputRef.current?.click();
  };

  const handleMissionFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const distanceKm = missionDistanceFromText(content);
      if (distanceKm <= 0) {
        throw new Error("No QGC waypoint distance could be read from the selected mission.");
      }
      setSettings((currentSettings) => ({
        ...currentSettings,
        missionDistanceKm: Math.round(distanceKm * 100) / 100
      }));
      setStatusMessage(`${file.name} imported, mission distance set to ${distanceKm.toFixed(2)} km`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not import mission");
    }
  };

  const handleStartTelemetry = async () => {
    try {
      const status = await startTelemetryListener(telemetryPort);
      setTelemetryStatus(status);
      setTelemetryPort(status.listener.port);
      setStatusMessage(`MAVLink telemetry reader listening on UDP ${status.listener.port}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not start telemetry reader");
    }
  };

  const handleStopTelemetry = async () => {
    try {
      const status = await stopTelemetryListener();
      setTelemetryStatus(status);
      setStatusMessage("MAVLink telemetry reader stopped");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not stop telemetry reader");
    }
  };

  const handleClearLogs = async () => {
    try {
      await clearLogs();
      setLogs([]);
      setStatusMessage("Logs cleared");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not clear logs");
    }
  };

  const handleRunTerminalCommand = async () => {
    const command = terminalCommand.trim();
    if (!command) {
      return;
    }

    setTerminalRunning(true);
    setStatusMessage(`Running ${command}`);
    try {
      const result = await runTerminalCommand(command);
      setTerminalHistory((current) => [result, ...current].slice(0, 20));
      setStatusMessage(result.exitCode === 0 ? "Command completed" : `Command exited with ${result.exitCode}`);
      refreshLogs();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Command failed");
    } finally {
      setTerminalRunning(false);
    }
  };

  const handleSoftwareUpdate = async () => {
    setSoftwareUpdating(true);
    setStatusMessage("Updating software from Git and compiling...");
    try {
      const result = await updateSoftware();
      setStatusMessage(result.message);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Software update failed");
    } finally {
      setSoftwareUpdating(false);
    }
  };

  const handleLocateSimVehicle = async () => {
    const result = await locateSimVehicle(settings.simVehiclePath);
    setSystemStatus(result);
    setStatusMessage(result.sitl.available ? `Found sim_vehicle.py at ${result.sitl.path}` : result.sitl.notes[0] ?? "sim_vehicle.py not found");
  };

  const handlePlan = async () => {
    const result = await buildSitlPlan(currentDesign());
    setSitlPlan(result.plan);
    setStatusMessage("SITL plan ready");
  };

  const handleLaunch = async () => {
    const result = await launchSitl(currentDesign());
    setSitlPlan(result.plan);
    setStatusMessage(`SITL launched as PID ${result.pid}`);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const commandKey = event.ctrlKey || event.metaKey;

      if (key === "escape") {
        event.preventDefault();
        clearSelection();
        setStatusMessage("Selection cleared");
        return;
      }

      if (isTextEditingTarget(event.target)) {
        return;
      }

      if (commandKey && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (commandKey && key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (commandKey && key === "n") {
        event.preventDefault();
        handleNewSpace();
        return;
      }

      if (commandKey && event.shiftKey && key === "r") {
        event.preventDefault();
        handleResetWorkspace();
        return;
      }

      if (commandKey && event.shiftKey && key === "s") {
        event.preventDefault();
        void handleSaveWorkspaceFile();
        return;
      }

      if (commandKey && key === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }

      if (commandKey && key === "o") {
        event.preventDefault();
        handleLoadWorkspaceClick();
        return;
      }

      if (commandKey && key === "e") {
        event.preventDefault();
        void handleJsonDownload();
        return;
      }

      if (commandKey && key === "p") {
        event.preventDefault();
        void handleParamsDownload();
        return;
      }

      if (commandKey && key === "d" && selectedNode) {
        event.preventDefault();
        duplicateSelectedNode();
        return;
      }

      if ((key === "delete" || key === "backspace") && (selectedNode || selectedEdge)) {
        event.preventDefault();
        if (selectedEdge) {
          removeSelectedEdge();
        } else {
          removeSelectedNode();
        }
        return;
      }

      if (key === "f" && selectedNode) {
        event.preventDefault();
        focusSelectedNode();
        return;
      }

      if (selectedNode && ["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        event.preventDefault();
        const step = event.shiftKey ? 50 : 10;
        const delta = {
          x: key === "arrowleft" ? -step : key === "arrowright" ? step : 0,
          y: key === "arrowup" ? -step : key === "arrowdown" ? step : 0
        };
        setNodes((currentNodes) =>
          currentNodes.map((node) =>
            node.id === selectedNode.id
              ? {
                  ...node,
                  position: {
                    x: node.position.x + delta.x,
                    y: node.position.y + delta.y
                  }
                }
              : node
          )
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    clearSelection,
    duplicateSelectedNode,
    focusSelectedNode,
    handleJsonDownload,
    handleLoadWorkspaceClick,
    handleNewSpace,
    handleParamsDownload,
    handleRedo,
    handleResetWorkspace,
    handleSave,
    handleSaveWorkspaceFile,
    handleUndo,
    removeSelectedEdge,
    removeSelectedNode,
    selectedEdge,
    selectedNode
  ]);

  const groupedCatalog = useMemo(() => {
    return filteredCatalog.reduce<Record<string, ComponentDefinition[]>>((groups, component) => {
      groups[component.category] ??= [];
      groups[component.category].push(component);
      return groups;
    }, {});
  }, [filteredCatalog]);

  const updateGcsTarget = <K extends keyof GcsTargetSettings>(id: GcsTargetSettings["id"], key: K, value: GcsTargetSettings[K]) => {
    setSettings((currentSettings) => {
      const targets = targetDefaults(currentSettings).map((target) => (target.id === id ? { ...target, [key]: value } : target));
      const qgc = targets.find((target) => target.id === "qgc");
      return {
        ...currentSettings,
        gcsTargets: targets,
        gcsHost: qgc?.host ?? currentSettings.gcsHost,
        gcsPort: qgc?.port ?? currentSettings.gcsPort
      };
    });
  };

  const contextMenuNode = contextMenu?.kind === "node" ? nodes.find((node) => node.id === contextMenu.nodeId) ?? null : null;
  const contextMenuEdge = contextMenu?.kind === "edge" ? edges.find((edge) => edge.id === contextMenu.edgeId) ?? null : null;
  const contextMenuEdgeDetails = contextMenuEdge
    ? connectionDetails(
        {
          ...contextMenuEdge,
          data: {
            ...contextMenuEdge.data,
            signal: signalForEdge(contextMenuEdge, nodes),
            issues: edgeIssueMessageMap.get(contextMenuEdge.id) ?? []
          }
        },
        nodes
      )
    : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/uas-doctoral-tech-logo.svg" alt="UAS Doctoral Tech logo" />
          <div>
            <h1>ArduPilot UAV Lab</h1>
            <input value={designName} onChange={(event) => setDesignName(event.target.value)} aria-label="Design name" />
            <small className="brand-credit">Design by UAS Doctoral Tech</small>
            <small className="brand-email">shahzaib.abbas@hotmail.com</small>
            <span className="brand-links">
              <a href="https://www.youtube.com/@uasdoctoraltech" target="_blank" rel="noreferrer" title="UAS Doctoral Tech YouTube">
                <ExternalLink size={10} />
                YouTube
              </a>
              <a
                href="https://www.udemy.com/course/basic-mission-planner-development-uav-simulation-setup/"
                target="_blank"
                rel="noreferrer"
                title="Mission Planner UAV simulation course"
              >
                <ExternalLink size={10} />
                Udemy
              </a>
            </span>
          </div>
        </div>

        <div className="health-strip">
          <div className="health-score">
            <span>{validation.score}</span>
            <small>Score</small>
          </div>
          <div className="health-count error">{validation.counts.error} Errors</div>
          <div className="health-count warning">{validation.counts.warning} Warnings</div>
          <div className="health-count info">{validation.counts.info} Notes</div>
        </div>

        <div className="top-actions">
          <button type="button" title="Save workspace file (Ctrl+S)" aria-keyshortcuts="Control+S" onClick={() => void handleSave()}>
            <Save size={17} />
            <span>Save</span>
          </button>
          <button type="button" title="Export JSON (Ctrl+E)" aria-keyshortcuts="Control+E" onClick={() => void handleJsonDownload()}>
            <FileJson size={17} />
            <span>JSON</span>
          </button>
          <button type="button" title="Export parameters (Ctrl+P)" aria-keyshortcuts="Control+P" onClick={handleParamsDownload}>
            <Download size={17} />
            <span>Params</span>
          </button>
          <button type="button" title="Update software from Git and compile" onClick={handleSoftwareUpdate} disabled={softwareUpdating}>
            <RefreshCw size={17} />
            <span>{softwareUpdating ? "Updating" : "Update"}</span>
          </button>
          <button type="button" title="Undo last workspace change (Ctrl+Z)" aria-keyshortcuts="Control+Z" onClick={handleUndo} disabled={!canUndo}>
            <Undo2 size={17} />
            <span>Undo</span>
          </button>
          <button type="button" title="Redo workspace change (Ctrl+Y)" aria-keyshortcuts="Control+Y" onClick={handleRedo} disabled={!canRedo}>
            <Redo2 size={17} />
            <span>Redo</span>
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="catalog-panel">
          <div className="panel-title">
            <Boxes size={18} />
            <span>Catalog</span>
          </div>
          <label className="search-box">
            <Search size={16} />
            <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search" />
          </label>

          <section className="build-guide" aria-label="Build guide">
            <div className="build-guide-header">
              <span>Build Guide</span>
              <strong>
                {buildGuide.completedRequired}/{buildGuide.requiredTotal}
              </strong>
            </div>
            <div className="guide-start">
              <small>Start</small>
              <strong>{buildGuide.start.definition.name}</strong>
              <span>{buildGuide.start.placement}</span>
            </div>
            <div className={`guide-next ${buildGuide.next ? "" : "complete"}`}>
              <small>Next</small>
              <strong>{buildGuide.next ? buildGuide.next.definition.name : "Guided sequence complete"}</strong>
              <span>{buildGuide.next ? buildGuide.next.placement : "Add optional payloads manually or tune product specs."}</span>
            </div>
            <button className="guide-action" type="button" onClick={addGuideComponent} disabled={!buildGuide.next}>
              {buildGuide.next ? <Plus size={15} /> : <CheckCircle2 size={15} />}
              <span>{buildGuide.next ? `Add ${buildGuide.next.definition.name}` : "Complete"}</span>
            </button>
            <div className="guide-step-list">
              {buildGuide.items.map((item) => (
                <div
                  className={`guide-step ${item.complete ? "done" : ""} ${buildGuide.next?.componentType === item.componentType ? "active" : ""}`}
                  key={item.componentType}
                >
                  <span>{item.definition.name}</span>
                  <small>
                    {item.targetCount === 0 ? "Skip" : `${item.count}/${item.targetCount}`}
                    {item.optional ? " optional" : ""}
                  </small>
                </div>
              ))}
            </div>
          </section>

          <section className="custom-library">
            <div className="build-guide-header">
              <span>Custom Library</span>
              <strong>{customComponents.length}</strong>
            </div>
            <button className="guide-action" type="button" onClick={handleSaveSelectedAsCustom} disabled={!selectedNode}>
              <Save size={15} />
              <span>Save Selected</span>
            </button>
            {filteredCustomComponents.length > 0 ? (
              <div className="custom-library-list">
                {filteredCustomComponents.map((component) => (
                  (() => {
                    const limit = componentLimitStatus(component.baseType, nodes, settings);
                    return (
                      <div className="custom-library-item" key={component.id ?? component.name}>
                        <button type="button" onClick={() => addCustomComponent(component)} disabled={!limit.allowed} title={limit.message}>
                          <Plus size={15} />
                          <span>
                            <strong>{component.name}</strong>
                            <small>{customComponentSummary(component)}</small>
                          </span>
                        </button>
                        <button
                          className="icon-button danger"
                          type="button"
                          title="Remove custom component"
                          onClick={() => void handleDeleteCustomComponent(component)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })()
                ))}
              </div>
            ) : (
              <div className="library-empty">No saved components</div>
            )}
          </section>

          <section className="custom-library product-library">
            <div className="build-guide-header">
              <span>Product Presets</span>
              <strong>{filteredProductTemplates.length}</strong>
            </div>
            <div className="custom-library-list">
              {filteredProductTemplates.slice(0, 8).map((component) => (
                (() => {
                  const limit = componentLimitStatus(component.baseType, nodes, settings);
                  return (
                    <div className="custom-library-item" key={component.id ?? component.name}>
                      <button type="button" onClick={() => addCustomComponent(component)} disabled={!limit.allowed} title={limit.message}>
                        <Plus size={15} />
                        <span>
                          <strong>{component.name}</strong>
                          <small>{customComponentSummary(component)}</small>
                        </span>
                      </button>
                    </div>
                  );
                })()
              ))}
            </div>
          </section>

          <div className="catalog-list">
            {Object.entries(groupedCatalog).map(([category, components]) => (
              <section key={category} className="catalog-group">
                <h2>{category}</h2>
                {components.map((component) => {
                  const Icon = iconMap[component.icon as keyof typeof iconMap] ?? Boxes;
                  const limit = componentLimitStatus(component.type, nodes, settings);
                  return (
                    <button
                      className="catalog-item"
                      type="button"
                      key={component.type}
                      onClick={() => addComponent(component)}
                      disabled={!limit.allowed}
                      title={limit.message}
                    >
                      <Icon size={18} />
                      <span>
                        <strong>{component.name}</strong>
                        <small>{component.summary}</small>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </aside>

        <section className="canvas-panel">
          <ReactFlow
            nodes={visibleNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => {
              selectNode(node.id);
            }}
            onEdgeClick={(event, edge) => {
              event.stopPropagation();
              selectEdge(edge.id);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              event.stopPropagation();
              selectNode(node.id);
              setContextMenu({
                kind: "node",
                nodeId: node.id,
                ...anchoredLayerPosition(event, 224, 178, 4)
              });
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault();
              event.stopPropagation();
              selectEdge(edge.id);
              setContextMenu({
                kind: "edge",
                edgeId: edge.id,
                ...anchoredLayerPosition(event, 224, 170, 4)
              });
            }}
            onEdgeMouseEnter={(event, edge) => {
              setHoveredConnection({ edgeId: edge.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeMouseMove={(event, edge) => {
              setHoveredConnection({ edgeId: edge.id, x: event.clientX, y: event.clientY });
            }}
            onEdgeMouseLeave={() => {
              setHoveredConnection(null);
            }}
            onPaneClick={() => {
              clearSelection();
            }}
            onPaneContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{ stroke: "#138a83", strokeWidth: 2.4 }}
            deleteKeyCode={null}
            edgesFocusable
            edgesReconnectable
            reconnectRadius={14}
            fitView
            minZoom={0.25}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
            <Panel position="top-left" className="flow-panel">
              <GitBranch size={16} />
              <span>{nodes.length} components</span>
              <span>{edges.length} links</span>
            </Panel>
            <Panel position="top-right" className="workspace-panel">
              <button type="button" title="Create new empty space (Ctrl+N)" aria-keyshortcuts="Control+N" onClick={handleNewSpace}>
                <FilePlus size={15} />
                <span>New</span>
              </button>
              <button
                type="button"
                title="Reset workspace to starter design (Ctrl+Shift+R)"
                aria-keyshortcuts="Control+Shift+R"
                onClick={handleResetWorkspace}
              >
                <RotateCcw size={15} />
                <span>Reset</span>
              </button>
              <button
                type="button"
                title="Save current space as .saq (Ctrl+Shift+S)"
                aria-keyshortcuts="Control+Shift+S"
                onClick={() => void handleSaveWorkspaceFile()}
              >
                <Save size={15} />
                <span>Save .saq</span>
              </button>
              <button type="button" title="Load a .saq workspace (Ctrl+O)" aria-keyshortcuts="Control+O" onClick={handleLoadWorkspaceClick}>
                <FolderOpen size={15} />
                <span>Load</span>
              </button>
              <input
                ref={workspaceFileInputRef}
                className="workspace-file-input"
                type="file"
                accept=".saq,application/json"
                onChange={handleWorkspaceFileSelected}
              />
            </Panel>
          </ReactFlow>

          {hoveredEdgeDetails && hoveredTooltipPosition ? (
            <div className="connection-tooltip" style={{ left: hoveredTooltipPosition.x, top: hoveredTooltipPosition.y }}>
              <strong>{hoveredEdgeDetails.title}</strong>
              <span>{hoveredEdgeDetails.route}</span>
              <small>
                {hoveredEdgeDetails.sourceDetail}
                {" -> "}
                {hoveredEdgeDetails.targetDetail}
              </small>
              {hoveredEdgeDetails.issues.length > 0 ? <em>{hoveredEdgeDetails.issues[0]}</em> : null}
            </div>
          ) : null}

          {contextMenu && (contextMenuNode || contextMenuEdgeDetails) ? (
            <div
              className="object-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {contextMenu.kind === "node" && contextMenuNode ? (
                <>
                  <div className="context-menu-title">
                    <strong>{contextMenuNode.data.label}</strong>
                    <small>{getComponentDefinition(contextMenuNode.data.componentType).name}</small>
                  </div>
                  <button type="button" onClick={() => focusNodeById(contextMenuNode.id)}>
                    <Search size={15} />
                    <span>Center</span>
                  </button>
                  <button type="button" onClick={duplicateSelectedNode}>
                    <Copy size={15} />
                    <span>Duplicate</span>
                  </button>
                  <button className="danger" type="button" onClick={removeSelectedNode}>
                    <Trash2 size={15} />
                    <span>Remove</span>
                  </button>
                </>
              ) : null}

              {contextMenu.kind === "edge" && contextMenuEdge && contextMenuEdgeDetails ? (
                <>
                  <div className="context-menu-title">
                    <strong>{contextMenuEdgeDetails.label} connection</strong>
                    <small>{contextMenuEdgeDetails.title}</small>
                  </div>
                  <button type="button" onClick={() => focusNodeById(contextMenuEdge.source)}>
                    <Search size={15} />
                    <span>Source</span>
                  </button>
                  <button type="button" onClick={() => focusNodeById(contextMenuEdge.target)}>
                    <Link2 size={15} />
                    <span>Target</span>
                  </button>
                  <button className="danger" type="button" onClick={removeSelectedEdge}>
                    <Trash2 size={15} />
                    <span>Remove</span>
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </section>

        <aside className="detail-panel">
          <div className="tabbar">
            <button className={tab === "inspector" ? "active" : ""} type="button" onClick={() => setTab("inspector")}>
              <Settings size={16} />
              <span>Inspect</span>
            </button>
            <button className={tab === "validation" ? "active" : ""} type="button" onClick={() => setTab("validation")}>
              <AlertTriangle size={16} />
              <span>Validate</span>
            </button>
            <button className={tab === "simulation" ? "active" : ""} type="button" onClick={() => setTab("simulation")}>
              <Play size={16} />
              <span>SITL</span>
            </button>
            <button className={tab === "mission" ? "active" : ""} type="button" onClick={() => setTab("mission")}>
              <MapPin size={16} />
              <span>Mission</span>
            </button>
            <button className={tab === "telemetry" ? "active" : ""} type="button" onClick={() => setTab("telemetry")}>
              <Radio size={16} />
              <span>Live</span>
            </button>
            <button className={tab === "logs" ? "active" : ""} type="button" onClick={() => setTab("logs")}>
              <ScrollText size={16} />
              <span>Logs</span>
            </button>
            <button className={tab === "terminal" ? "active" : ""} type="button" onClick={() => setTab("terminal")}>
              <Terminal size={16} />
              <span>Term</span>
            </button>
            <button className={tab === "performance" ? "active" : ""} type="button" onClick={() => setTab("performance")}>
              <Sparkles size={16} />
              <span>AI</span>
            </button>
            <button className={tab === "bom" ? "active" : ""} type="button" onClick={() => setTab("bom")}>
              <FileJson size={16} />
              <span>BOM</span>
            </button>
            <button className={tab === "params" ? "active" : ""} type="button" onClick={() => setTab("params")}>
              <ScrollText size={16} />
              <span>Params</span>
            </button>
            <button className={tab === "compare" ? "active" : ""} type="button" onClick={() => setTab("compare")}>
              <GitBranch size={16} />
              <span>Compare</span>
            </button>
          </div>

          <section className="connection-legend">
            <h2>Connections</h2>
            <div>
              {SIGNAL_KINDS.map((signal) => (
                <span className="legend-item" key={signal}>
                  <span className={`legend-swatch ${signal}`} />
                  {signalLabel(signal)}
                </span>
              ))}
            </div>
          </section>

          {tab === "inspector" && (
            <div className="detail-content">
              {selectedEdge && selectedEdgeDetails ? (
                <>
                  <div className="panel-title">
                    <span>{selectedEdgeDetails.label} Connection</span>
                    <button className="icon-button danger" type="button" title="Remove connection (Del)" aria-keyshortcuts="Delete" onClick={removeSelectedEdge}>
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <section className="connection-editor">
                    <h2>Route</h2>
                    <div className="connection-route-card">
                      <strong>{selectedEdgeDetails.title}</strong>
                      <span>{selectedEdgeDetails.route}</span>
                      <small>
                        {selectedEdgeDetails.sourceDetail}
                        {" -> "}
                        {selectedEdgeDetails.targetDetail}
                      </small>
                    </div>
                    <div className="object-action-row">
                      <button className="icon-button" type="button" title="Center source" onClick={() => focusNodeById(selectedEdge.source)}>
                        <Search size={16} />
                      </button>
                      <button className="icon-button" type="button" title="Center target" onClick={() => focusNodeById(selectedEdge.target)}>
                        <Link2 size={16} />
                      </button>
                    </div>
                  </section>

                  <section className="ports-list">
                    <h2>Endpoints</h2>
                    <div className="port-row">
                      <span className={`port-dot ${selectedEdgeDetails.signal ?? "mount"}`} />
                      <span>{selectedEdgeDetails.sourceName}</span>
                      <small>{selectedEdgeDetails.sourcePortName}</small>
                    </div>
                    <div className="port-row">
                      <span className={`port-dot ${selectedEdgeDetails.signal ?? "mount"}`} />
                      <span>{selectedEdgeDetails.targetName}</span>
                      <small>{selectedEdgeDetails.targetPortName}</small>
                    </div>
                  </section>

                  {selectedEdgeDetails.issues.length > 0 ? (
                    <section className="connection-issues">
                      <h2>Issues</h2>
                      {selectedEdgeDetails.issues.map((issue) => (
                        <p key={issue}>{issue}</p>
                      ))}
                    </section>
                  ) : null}
                </>
              ) : selectedNode && selectedDefinition ? (
                <>
                  <div className="panel-title">
                    <span>{selectedDefinition.name}</span>
                    <button className="icon-button danger" type="button" title="Remove component (Del)" aria-keyshortcuts="Delete" onClick={removeSelectedNode}>
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <label className="field">
                    <span>Name</span>
                    <input value={selectedNode.data.label} onChange={(event) => updateSelectedLabel(event.target.value)} />
                  </label>

                  <section className="object-editor">
                    <h2>Object</h2>
                    <div className="position-grid">
                      <label className="field">
                        <span>X</span>
                        <input
                          type="number"
                          step={10}
                          value={Math.round(selectedNode.position.x)}
                          onChange={(event) => updateSelectedPosition("x", Number(event.target.value))}
                        />
                      </label>
                      <label className="field">
                        <span>Y</span>
                        <input
                          type="number"
                          step={10}
                          value={Math.round(selectedNode.position.y)}
                          onChange={(event) => updateSelectedPosition("y", Number(event.target.value))}
                        />
                      </label>
                    </div>
                    <div className="object-action-row">
                      <button className="icon-button" type="button" title="Center object (F)" aria-keyshortcuts="F" onClick={focusSelectedNode}>
                        <Search size={16} />
                      </button>
                      <button className="icon-button" type="button" title="Duplicate object (Ctrl+D)" aria-keyshortcuts="Control+D" onClick={duplicateSelectedNode}>
                        <Copy size={16} />
                      </button>
                    </div>
                  </section>

                  <section className="product-spec-editor">
                    <h2>Product Spec</h2>
                    {productSpecProperties.map((property) => (
                      <label className="field" key={property.key}>
                        <span>
                          {property.label}
                          {property.unit ? <small>{property.unit}</small> : null}
                        </span>
                        {propertyInput(property, selectedNode.data.properties[property.key] ?? property.defaultValue, (value) =>
                          updateSelectedProperty(property.key, value)
                        )}
                      </label>
                    ))}
                  </section>

                  {selectedDefinition.properties.map((property) => (
                    <label className="field" key={property.key}>
                      <span>
                        {property.label}
                        {property.unit ? <small>{property.unit}</small> : null}
                      </span>
                      {propertyInput(property, selectedNode.data.properties[property.key] ?? property.defaultValue, (value) =>
                        updateSelectedProperty(property.key, value)
                      )}
                    </label>
                  ))}

                  <section className="ports-list">
                    <h2>Ports</h2>
                    {selectedDefinition.ports.map((port) => (
                      <div className="port-row" key={port.id}>
                        <span className={`port-dot ${port.kind}`} />
                        <span>{port.label}</span>
                        <small>{port.direction}</small>
                      </div>
                    ))}
                  </section>
                </>
              ) : (
                <div className="empty-state">Select a component or connection</div>
              )}
            </div>
          )}

          {tab === "validation" && (
            <div className="detail-content">
              <div className="panel-title">
                <span>Validation</span>
                <span className={`status-pill ${validation.counts.error ? "bad" : "good"}`}>
                  {validation.counts.error ? "Blocked" : "Ready"}
                </span>
              </div>
              <section className="auto-wire-panel">
                <div className="mavlink-command-title">
                  <strong>Auto-Wire Assistant</strong>
                  <span>{wireSuggestions.length} suggestions</span>
                </div>
                <button className="guide-action" type="button" onClick={() => applyAutoWireSuggestions()} disabled={wireSuggestions.length === 0}>
                  <Link2 size={15} />
                  <span>Apply Safe Wires</span>
                </button>
                {wireSuggestions.length > 0 ? (
                  <div className="wire-suggestion-list">
                    {wireSuggestions.slice(0, 8).map((suggestion) => (
                      <button type="button" key={suggestion.id} onClick={() => applyAutoWireSuggestions([suggestion])}>
                        <span className={`legend-swatch ${suggestion.signal}`} />
                        <span>{suggestion.title}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="scenario-note">All recognized safe connections are already present.</p>
                )}
              </section>
              <div className="issue-list">
                {validation.issues.length === 0 ? (
                  <div className="empty-state">No issues</div>
                ) : (
                  validation.issues.map((issue) => (
                    <button
                      type="button"
                      className={`issue ${issue.severity}`}
                      key={issue.id}
                      onClick={() => {
                        if (issue.nodeIds?.[0]) {
                          selectNode(issue.nodeIds[0]);
                        } else if (issue.edgeIds?.[0]) {
                          selectEdge(issue.edgeIds[0]);
                        }
                      }}
                    >
                      <strong>{issue.title}</strong>
                      <span>{issue.message}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "simulation" && (
            <div className="detail-content">
              <div className="panel-title">
                <span>Simulation</span>
                <span className={`status-pill ${systemStatus?.sitl.available ? "good" : "neutral"}`}>
                  {systemStatus?.sitl.available ? "SITL found" : "SITL not found"}
                </span>
              </div>

              <SimulationPreview nodes={nodes} settings={settings} score={validation.score} />

              <label className="field">
                <span>Vehicle</span>
                <select value={settings.vehicle} onChange={(event) => setSettings({ ...settings, vehicle: event.target.value as SimulationSettings["vehicle"] })}>
                  <option value="ArduCopter">ArduCopter</option>
                  <option value="ArduPlane">ArduPlane</option>
                  <option value="Rover">Rover</option>
                </select>
              </label>

              <label className="field">
                <span>Frame</span>
                <select value={settings.frame} onChange={(event) => updateFrameSetting(event.target.value)}>
                  {airframeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Physics</span>
                <select
                  value={settings.physicsBackend}
                  onChange={(event) => setSettings({ ...settings, physicsBackend: event.target.value as SimulationSettings["physicsBackend"] })}
                >
                  <option value="sitl">SITL frame</option>
                  <option value="json">JSON backend</option>
                </select>
              </label>

              {settings.physicsBackend === "json" ? (
                <label className="field">
                  <span>JSON host</span>
                  <input value={settings.jsonHost} onChange={(event) => setSettings({ ...settings, jsonHost: event.target.value })} />
                </label>
              ) : null}

              <section className="sitl-locator">
                <h2>sim_vehicle.py</h2>
                <div className="path-row">
                  <input
                    value={settings.simVehiclePath}
                    onChange={(event) => setSettings({ ...settings, simVehiclePath: event.target.value })}
                    placeholder="File path or ArduPilot checkout folder"
                  />
                  <button type="button" title="Check path" onClick={handleLocateSimVehicle}>
                    <Search size={16} />
                  </button>
                </div>
                <p>{systemStatus?.sitl.path ?? systemStatus?.sitl.notes[0] ?? "Enter a path or use ARDUPILOT_HOME/PATH detection."}</p>
              </section>

              <section className="setup-diagnostics">
                <div className="mavlink-command-title">
                  <strong>SITL Setup Wizard</strong>
                  <span>{setupDiagnostics?.ready ? "Ready" : "Check"}</span>
                </div>
                <button className="guide-action" type="button" onClick={() => void refreshSetupDiagnostics()} disabled={setupChecking}>
                  <RefreshCw size={15} />
                  <span>{setupChecking ? "Checking" : "Run Diagnostics"}</span>
                </button>
                {setupDiagnostics ? (
                  <div className="setup-check-list">
                    {setupDiagnostics.checks.map((check) => (
                      <article className={check.ok ? "ok" : "bad"} key={check.id}>
                        <div>
                          <strong>{check.label}</strong>
                          <span>{check.ok ? "OK" : "Missing"}</span>
                        </div>
                        <p>{check.detail}</p>
                        {check.fix ? <small>{check.fix}</small> : null}
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>

              <label className="field">
                <span>Location</span>
                <input value={settings.locationName} onChange={(event) => setSettings({ ...settings, locationName: event.target.value })} />
              </label>

              <label className="field">
                <span>Speedup</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={settings.speedup}
                  onChange={(event) => setSettings({ ...settings, speedup: Number(event.target.value) })}
                />
              </label>

              <section className="swarm-layout">
                <h2>Swarm</h2>
                <div className="environment-grid">
                  <label className="field">
                    <span>Vehicles</span>
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={settings.swarmCount}
                      onChange={(event) => setSettings({ ...settings, swarmCount: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Spacing
                      <small>m</small>
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={settings.swarmSpacingM}
                      onChange={(event) => setSettings({ ...settings, swarmSpacingM: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>Layout</span>
                  <select
                    value={settings.swarmLayout}
                    onChange={(event) => setSettings({ ...settings, swarmLayout: event.target.value as SimulationSettings["swarmLayout"] })}
                  >
                    <option value="line">Line</option>
                    <option value="grid">Grid</option>
                    <option value="circle">Circle</option>
                  </select>
                </label>
                {sitlPlan?.swarm && sitlPlan.swarm.count > 1 ? (
                  <div className="swarm-map">
                    {sitlPlan.swarm.vehicles.map((vehicle) => (
                      <span key={vehicle.sysid}>
                        #{vehicle.sysid} {vehicle.x},{vehicle.y} m
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="mission-test">
                <h2>Mission Test</h2>
                <label className="field">
                  <span>Scenario</span>
                  <select
                    value={settings.testScenario}
                    onChange={(event) =>
                      setSettings({ ...settings, testScenario: event.target.value as SimulationSettings["testScenario"] })
                    }
                  >
                    <option value="nominal">Nominal</option>
                    <option value="wind-gust">Wind gust</option>
                    <option value="low-battery">Low battery</option>
                    <option value="gps-denied">GPS denied</option>
                    <option value="payload-endurance">Payload endurance</option>
                    <option value="sensor-failure">Sensor failure</option>
                  </select>
                </label>

                <label className="field">
                  <span>
                    Mission distance
                    <small>km</small>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={0.1}
                    value={settings.missionDistanceKm}
                    onChange={(event) => setSettings({ ...settings, missionDistanceKm: Number(event.target.value) })}
                  />
                </label>

                <div className="environment-grid">
                  <label className="field">
                    <span>
                      Wind
                      <small>m/s</small>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      value={settings.windSpeedMps}
                      onChange={(event) => setSettings({ ...settings, windSpeedMps: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Gust
                      <small>m/s</small>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={80}
                      step={0.5}
                      value={settings.windGustMps}
                      onChange={(event) => setSettings({ ...settings, windGustMps: Number(event.target.value) })}
                    />
                  </label>
                </div>

                <div className="failsafe-grid">
                  <label className="field">
                    <span>
                      Low reserve
                      <small>%</small>
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={80}
                      value={settings.batteryLowPercent}
                      onChange={(event) => setSettings({ ...settings, batteryLowPercent: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>
                      Critical reserve
                      <small>%</small>
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={79}
                      value={settings.batteryCriticalPercent}
                      onChange={(event) => setSettings({ ...settings, batteryCriticalPercent: Number(event.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Low action</span>
                    <select
                      value={settings.batteryFailsafeAction}
                      onChange={(event) =>
                        setSettings({ ...settings, batteryFailsafeAction: event.target.value as SimulationSettings["batteryFailsafeAction"] })
                      }
                    >
                      <option value="Warn">Warn</option>
                      <option value="Land">Land</option>
                      <option value="RTL">RTL</option>
                      <option value="SmartRTL">SmartRTL</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Critical action</span>
                    <select
                      value={settings.batteryCriticalAction}
                      onChange={(event) =>
                        setSettings({ ...settings, batteryCriticalAction: event.target.value as SimulationSettings["batteryCriticalAction"] })
                      }
                    >
                      <option value="Land">Land</option>
                      <option value="RTL">RTL</option>
                      <option value="SmartRTL">SmartRTL</option>
                      <option value="Terminate">Terminate</option>
                    </select>
                  </label>
                </div>

                <p className="scenario-note">{scenarioHint(settings)}</p>
                <button className="guide-action" type="button" onClick={handleRunScenario}>
                  <CheckCircle2 size={15} />
                  <span>Run Scenario Checks</span>
                </button>
                {scenarioRunResult ? (
                  <div className={`scenario-run-card ${scenarioRunResult.passed ? "ok" : "bad"}`}>
                    <strong>
                      {scenarioLabel(scenarioRunResult.scenario)} {scenarioRunResult.passed ? "passed" : "needs attention"}
                    </strong>
                    {scenarioRunResult.checks.map((check) => (
                      <p key={check.label}>
                        <span>{check.passed ? "PASS" : "CHECK"}</span>
                        {check.label}: {check.detail}
                      </p>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="artifact-panel">
                <h2>Scenario Files</h2>
                <div className="artifact-grid">
                  <button type="button" onClick={() => void handleArtifactDownload(buildMissionFile, "Mission waypoints exported")}>
                    <Download size={16} />
                    <span>Mission</span>
                  </button>
                  <button type="button" onClick={handleMissionImportClick}>
                    <FolderOpen size={16} />
                    <span>Import</span>
                  </button>
                  <button type="button" onClick={() => void handleArtifactDownload(buildPrearmFile, "Pre-arm scenario exported")}>
                    <ShieldCheck size={16} />
                    <span>Pre-arm</span>
                  </button>
                  <button type="button" onClick={() => void handleArtifactDownload(buildJsonBridgeFile, "JSON bridge template exported")}>
                    <FileJson size={16} />
                    <span>Bridge</span>
                  </button>
                  <button type="button" onClick={() => void handleArtifactDownload(buildGazeboWorldFile, "Gazebo world exported")}>
                    <Wind size={16} />
                    <span>Gazebo</span>
                  </button>
                  <button type="button" onClick={() => void handleBundleDownload()}>
                    <FilePlus size={16} />
                    <span>Bundle</span>
                  </button>
                </div>
                <input
                  ref={missionFileInputRef}
                  className="workspace-file-input"
                  type="file"
                  accept=".waypoints,.txt,text/plain"
                  onChange={handleMissionFileSelected}
                />
              </section>

              <section className="gazebo-helper">
                <h2>Gazebo Plugins</h2>
                <div className="ai-detail-row">
                  <span>Install</span>
                  <strong>
                    {gazeboStatus?.selected
                      ? `${gazeboStatus.selected.label}${gazeboStatus.selected.version ? ` ${gazeboStatus.selected.version}` : ""}`
                      : "Not detected"}
                  </strong>
                </div>
                {gazeboStatus?.notes[0] ? <p className="scenario-note">{gazeboStatus.notes[0]}</p> : null}
                <div className="action-grid gazebo-actions">
                  <button type="button" onClick={refreshGazeboStatus}>
                    <RefreshCw size={16} />
                    <span>Check</span>
                  </button>
                  <button type="button" onClick={() => void handleCompileGazeboPlugins()} disabled={gazeboCompiling}>
                    <Settings size={16} />
                    <span>{gazeboCompiling ? "Building" : "Compile"}</span>
                  </button>
                </div>
                {gazeboCompileResult ? (
                  <div className="gazebo-build-output">
                    <p>{gazeboCompileResult.message}</p>
                    <code>{gazeboCompileResult.projectDir}</code>
                    {gazeboCompileResult.steps.at(-1)?.stderr ? <pre>{gazeboCompileResult.steps.at(-1)?.stderr}</pre> : null}
                  </div>
                ) : null}
              </section>

              <section className="gcs-targets">
                <h2>Ground Stations</h2>
                {gcsTargets.map((target) => (
                  <div className="gcs-target-card" key={target.id}>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        onChange={(event) => updateGcsTarget(target.id, "enabled", event.target.checked)}
                      />
                      <span>{target.name}</span>
                    </label>
                    <div className="gcs-target-grid">
                      <label className="field">
                        <span>Host</span>
                        <input value={target.host} onChange={(event) => updateGcsTarget(target.id, "host", event.target.value)} />
                      </label>
                      <label className="field">
                        <span>Port</span>
                        <input type="number" value={target.port} onChange={(event) => updateGcsTarget(target.id, "port", Number(event.target.value))} />
                      </label>
                    </div>
                  </div>
                ))}
              </section>

              <div className="action-grid">
                <button type="button" onClick={handlePlan}>
                  <GitBranch size={16} />
                  <span>Plan</span>
                </button>
                <button type="button" onClick={handleLaunch} disabled={!systemStatus?.sitl.available || validation.counts.error > 0}>
                  <Play size={16} />
                  <span>Launch</span>
                </button>
              </div>

              {sitlPlan ? (
                <section className="command-box">
                  <h2>Command</h2>
                  <code>{sitlPlan.commandLine}</code>
                  {sitlPlan.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </section>
              ) : null}
            </div>
          )}

          {tab === "mission" && (
            <MissionPanel
              telemetry={telemetryStatus}
              mission={missionStatus}
              onUpload={(vehicle) => void handleMissionUpload(vehicle)}
              onDownload={(vehicle) => void handleMissionDownload(vehicle)}
              onSaveDownloaded={handleSaveDownloadedMission}
            />
          )}

          {tab === "telemetry" && (
            <TelemetryPanel
              status={telemetryStatus}
              port={telemetryPort}
              onPortChange={setTelemetryPort}
              onStart={() => void handleStartTelemetry()}
              onStop={() => void handleStopTelemetry()}
              onCommand={handleMavlinkCommand}
            />
          )}

          {tab === "logs" && <LogsPanel logs={logs} onRefresh={refreshLogs} onClear={() => void handleClearLogs()} />}

          {tab === "terminal" && (
            <TerminalPanel
              command={terminalCommand}
              history={terminalHistory}
              running={terminalRunning}
              onCommandChange={setTerminalCommand}
              onRun={() => void handleRunTerminalCommand()}
            />
          )}

          {tab === "performance" && <PerformancePanel estimate={performanceEstimate} />}

          {tab === "bom" && (
            <BomPanel rows={bomRows} onExportCsv={() => void handleBomCsvDownload()} onExportHtml={() => void handleBomHtmlDownload()} />
          )}

          {tab === "params" && (
            <ParamExplanationPanel
              explanations={paramExplanations}
              onRefresh={() => void refreshParamExplanations()}
              onExport={() => void handleParamsDownload()}
            />
          )}

          {tab === "compare" && (
            <ComparePanel
              current={{ name: designName, validationScore: validation.score, estimate: performanceEstimate }}
              comparison={comparisonSummary}
              onLoadClick={handleComparisonLoadClick}
            />
          )}
        </aside>
      </main>

      <input
        ref={comparisonFileInputRef}
        className="workspace-file-input"
        type="file"
        accept=".saq,application/json"
        onChange={handleComparisonFileSelected}
      />

      <footer className="statusbar">
        <span>{statusMessage}</span>
        <span>{systemStatus?.sitl.notes[0] ?? "SITL detection pending"}</span>
      </footer>
    </div>
  );
}

export default App;
