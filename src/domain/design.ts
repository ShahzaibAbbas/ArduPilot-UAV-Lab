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
  updatedAt?: string;
}

export const defaultSettings: SimulationSettings = {
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
