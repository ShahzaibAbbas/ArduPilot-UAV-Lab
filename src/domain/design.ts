import type { Edge, Node } from "@xyflow/react";

export type SignalKind =
  | "power"
  | "pwm"
  | "uart"
  | "i2c"
  | "can"
  | "analog"
  | "gpio"
  | "video"
  | "mount"
  | "telemetry";

export type PortDirection = "input" | "output";

export type GcsTargetId = "qgc" | "mission-planner";

export type EngineeringDomainId =
  | "electrical-power"
  | "wiring-buses"
  | "mechanical-mounting"
  | "propulsion"
  | "avionics-sensors"
  | "communications"
  | "safety";

export type EngineeringWorkStatus = "open" | "in-progress" | "blocked" | "verified";
export type EngineeringPriority = "low" | "medium" | "high" | "critical";
export type PowerRailId = "battery-bus" | "regulated-5v" | "regulated-12v";
export type PowerLoadCriticality = "essential" | "mission" | "support";

export interface PowerRailLimit {
  continuousCurrentA: number;
  peakCurrentA: number;
}

export interface PowerLoadOverride {
  nodeId: string;
  rail: PowerRailId;
  enabled: boolean;
  nominalCurrentA: number;
  peakCurrentA: number;
  dutyCyclePercent: number;
  criticality: PowerLoadCriticality;
  shedPriority: number;
  notes: string;
}

export interface EngineeringWorkItem {
  id: string;
  title: string;
  domainId: EngineeringDomainId;
  sourceCheckId?: string;
  manual?: boolean;
  owner: string;
  status: EngineeringWorkStatus;
  priority: EngineeringPriority;
  dueDate: string;
  effortHours: number;
  likelihood: number;
  impact: number;
  mitigation: string;
  evidence: string;
}

export interface EngineeringManagementState {
  version: 1;
  projectPhase: "Concept" | "Preliminary design" | "Critical design" | "Integration" | "Flight test";
  technicalLead: string;
  nextReviewDate: string;
  powerReservePercent: number;
  railLimits: Record<PowerRailId, PowerRailLimit>;
  loadOverrides: Record<string, PowerLoadOverride>;
  workItems: EngineeringWorkItem[];
}

export interface ComponentPort {
  id: string;
  label: string;
  kind: SignalKind;
  direction: PortDirection;
  required?: boolean;
}

export interface ComponentPropertyDefinition {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  defaultValue: string | number | boolean;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface ComponentDefinition {
  type: string;
  name: string;
  category: "Core" | "Power" | "Propulsion" | "Sensors" | "Comms" | "Payload" | "Safety";
  summary: string;
  icon: string;
  ports: ComponentPort[];
  properties: ComponentPropertyDefinition[];
}

export interface ComponentNodeData extends Record<string, unknown> {
  componentType: string;
  label: string;
  properties: Record<string, string | number | boolean>;
  health?: "ok" | "warning" | "error";
  firmware?: FirmwareAttachmentReference;
}

export interface ThreeVector3 {
  x: number;
  y: number;
  z: number;
}

export interface ThreeTransform {
  position: ThreeVector3;
  rotation: ThreeVector3;
  scale: ThreeVector3;
}

export interface FirmwareAttachmentReference {
  id: string;
  originalName: string;
  sha256: string;
  byteSize: number;
  uploadedAt: string;
  compatibilityStatus: "compatible" | "review" | "incompatible" | "unknown";
}

export type DesignNode = Node<ComponentNodeData, "componentNode"> & {
  presentation3d?: ThreeTransform;
};
export type DesignEdge = Edge<{ signal?: SignalKind; issues?: string[] }>;

export interface GcsTargetSettings {
  id: GcsTargetId;
  name: string;
  enabled: boolean;
  host: string;
  port: number;
}

export interface SimulationSettings {
  missionProfile: "mapping" | "inspection" | "delivery" | "research" | "training" | "custom";
  missionObjective: string;
  missionEnvironment: "outdoor" | "indoor" | "mixed";
  missionPayload: string;
  missionAltitudeM: number;
  vehicle: "ArduCopter" | "ArduPlane" | "Rover";
  frame: string;
  physicsBackend: "sitl" | "json";
  jsonHost: string;
  simVehiclePath: string;
  sitlHeadless?: boolean;
  sitlRebuild?: boolean;
  /** Pass sim_vehicle.py's wipe EEPROM option on the next launch only. */
  sitlWipeOnLaunch?: boolean;
  labTelemetryPort?: number;
  speedup: number;
  locationName: string;
  testScenario: "nominal" | "wind-gust" | "low-battery" | "gps-denied" | "payload-endurance" | "sensor-failure";
  missionDistanceKm: number;
  windSpeedMps: number;
  windGustMps: number;
  batteryLowPercent: number;
  batteryCriticalPercent: number;
  batteryFailsafeAction: "Warn" | "Land" | "RTL" | "SmartRTL" | "Hold";
  batteryCriticalAction: "Land" | "RTL" | "SmartRTL" | "Hold" | "Terminate";
  swarmCount: number;
  swarmLayout: "line" | "grid" | "circle";
  swarmSpacingM: number;
  gcsHost: string;
  gcsPort: number;
  gcsTargets: GcsTargetSettings[];
  gcsTcpPort?: number;
}

export interface ThreeWorkspaceSettings {
  showLabels: boolean;
  showWires: boolean;
  isolateSelection: boolean;
  reducedMotion: boolean;
}

export interface TraceWorkspaceSettings {
  direction: "all" | "rx" | "tx";
  protocol: "all" | "MAVLink1" | "MAVLink2";
  systemId: string;
  componentId: string;
  messageId: string;
  text: string;
}

export interface LabWorkspaceSettings {
  viewMode: "2d" | "3d";
  three: ThreeWorkspaceSettings;
  trace: TraceWorkspaceSettings;
}

export interface UavDesign {
  id?: string;
  name: string;
  nodes: DesignNode[];
  edges: DesignEdge[];
  settings: SimulationSettings;
  lab?: LabWorkspaceSettings;
  management?: EngineeringManagementState;
  updatedAt?: string;
}

export const defaultSettings: SimulationSettings = {
  missionProfile: "training",
  missionObjective: "Validate a complete ArduPilot vehicle design in simulation before hardware integration.",
  missionEnvironment: "outdoor",
  missionPayload: "None",
  missionAltitudeM: 30,
  vehicle: "ArduCopter",
  frame: "quad-x",
  physicsBackend: "sitl",
  jsonHost: "127.0.0.1",
  simVehiclePath: "",
  sitlHeadless: true,
  sitlRebuild: true,
  sitlWipeOnLaunch: false,
  labTelemetryPort: 14552,
  speedup: 1,
  locationName: "CMAC",
  testScenario: "nominal",
  missionDistanceKm: 2,
  windSpeedMps: 0,
  windGustMps: 0,
  batteryLowPercent: 20,
  batteryCriticalPercent: 10,
  batteryFailsafeAction: "RTL",
  batteryCriticalAction: "Land",
  swarmCount: 1,
  swarmLayout: "line",
  swarmSpacingM: 20,
  gcsHost: "127.0.0.1",
  gcsPort: 14550,
  gcsTargets: [
    { id: "qgc", name: "QGroundControl", enabled: true, host: "127.0.0.1", port: 14550 },
    { id: "mission-planner", name: "Mission Planner", enabled: true, host: "127.0.0.1", port: 14551 }
  ]
};

export const defaultLabSettings: LabWorkspaceSettings = {
  viewMode: "2d",
  three: {
    showLabels: true,
    showWires: true,
    isolateSelection: false,
    reducedMotion: false
  },
  trace: {
    direction: "all",
    protocol: "all",
    systemId: "",
    componentId: "",
    messageId: "",
    text: ""
  }
};
