import { MarkerType } from "@xyflow/react";
import { defaultSettings, type DesignEdge, type DesignNode, type UavDesign } from "./design";
import { defaultPropertiesForComponent } from "./componentCatalog";

function propertiesFor(componentType: string, overrides: Record<string, string | number | boolean> = {}) {
  return {
    ...defaultPropertiesForComponent(componentType),
    ...overrides
  };
}

function node(
  id: string,
  componentType: string,
  label: string,
  x: number,
  y: number,
  overrides: Record<string, string | number | boolean> = {}
): DesignNode {
  return {
    id,
    type: "componentNode",
    position: { x, y },
    data: {
      componentType,
      label,
      properties: propertiesFor(componentType, overrides)
    }
  };
}

function edge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string
): DesignEdge {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed }
  };
}

export function createStarterDesign(): UavDesign {
  const nodes: DesignNode[] = [
    node("frame-1", "frame", "Quad X Frame", 500, 190),
    node("fc-1", "flight-controller", "ArduPilot FC", 500, 360),
    node("battery-1", "battery", "4S Battery", 40, 250),
    node("pm-1", "power-module", "Power Module", 270, 315),
    node("gps-1", "gps", "GPS", 730, 220),
    node("compass-1", "compass", "Compass", 730, 390),
    node("radio-1", "telemetry-radio", "Telemetry", 960, 390),
    node("esc-1", "esc", "ESC 1", 270, 40),
    node("esc-2", "esc", "ESC 2", 730, 40),
    node("esc-3", "esc", "ESC 3", 270, 625),
    node("esc-4", "esc", "ESC 4", 730, 625),
    node("motor-1", "motor", "Motor 1", 40, 40),
    node("motor-2", "motor", "Motor 2", 960, 40),
    node("motor-3", "motor", "Motor 3", 40, 625),
    node("motor-4", "motor", "Motor 4", 960, 625)
  ];

  const edges: DesignEdge[] = [
    edge("e-bat-pm", "battery-1", "power-out", "pm-1", "power-in"),
    edge("e-pm-fc-power", "pm-1", "power-out", "fc-1", "power-in"),
    edge("e-pm-fc-adc", "pm-1", "analog-out", "fc-1", "analog-in"),
    edge("e-gps-fc", "gps-1", "uart-out", "fc-1", "uart-in"),
    edge("e-compass-fc", "compass-1", "i2c-out", "fc-1", "i2c-in"),
    edge("e-fc-radio", "fc-1", "uart-out", "radio-1", "uart-in"),
    edge("e-frame-m1", "frame-1", "mount-out", "motor-1", "mount-in"),
    edge("e-frame-m2", "frame-1", "mount-out", "motor-2", "mount-in"),
    edge("e-frame-m3", "frame-1", "mount-out", "motor-3", "mount-in"),
    edge("e-frame-m4", "frame-1", "mount-out", "motor-4", "mount-in"),
    edge("e-pm-esc1", "pm-1", "power-out", "esc-1", "power-in"),
    edge("e-pm-esc2", "pm-1", "power-out", "esc-2", "power-in"),
    edge("e-pm-esc3", "pm-1", "power-out", "esc-3", "power-in"),
    edge("e-pm-esc4", "pm-1", "power-out", "esc-4", "power-in"),
    edge("e-fc-esc1", "fc-1", "pwm-out", "esc-1", "pwm-in"),
    edge("e-fc-esc2", "fc-1", "pwm-out", "esc-2", "pwm-in"),
    edge("e-fc-esc3", "fc-1", "pwm-out", "esc-3", "pwm-in"),
    edge("e-fc-esc4", "fc-1", "pwm-out", "esc-4", "pwm-in"),
    edge("e-esc1-m1", "esc-1", "power-out", "motor-1", "power-in"),
    edge("e-esc2-m2", "esc-2", "power-out", "motor-2", "power-in"),
    edge("e-esc3-m3", "esc-3", "power-out", "motor-3", "power-in"),
    edge("e-esc4-m4", "esc-4", "power-out", "motor-4", "power-in")
  ];

  return {
    name: "Quad X SITL Prototype",
    nodes,
    edges,
    settings: defaultSettings
  };
}
