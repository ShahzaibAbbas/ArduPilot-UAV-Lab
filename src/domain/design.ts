import type { Edge, Node } from "@xyflow/react";

export type SignalKind =
  | "power"
  | "pwm"
  | "uart"
  | "i2c"
  | "can"
  | "analog"
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
}

export type DesignNode = Node<ComponentNodeData, "componentNode">;
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
  speedup: number;
  locationName: string;
  testScenario: "nominal" | "wind-gust" | "low-battery" | "gps-denied" | "payload-endurance" | "sensor-failure";
  missionDistanceKm: number;
  windSpeedMps: number;
  windGustMps: number;
  batteryLowPercent: number;
  batteryCriticalPercent: number;
  batteryFailsafeAction: "Warn" | "Land" | "RTL" | "SmartRTL";
  batteryCriticalAction: "Land" | "RTL" | "SmartRTL" | "Terminate";
  swarmCount: number;
  swarmLayout: "line" | "grid" | "circle";
  swarmSpacingM: number;
  gcsHost: string;
  gcsPort: number;
  gcsTargets: GcsTargetSettings[];
}

export interface UavDesign {
  id?: string;
  name: string;
  nodes: DesignNode[];
  edges: DesignEdge[];
  settings: SimulationSettings;
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
