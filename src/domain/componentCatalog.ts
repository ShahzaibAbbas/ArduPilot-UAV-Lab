import type { ComponentDefinition, ComponentPort, ComponentPropertyDefinition, DesignNode } from "./design";

const powerIn: ComponentPort = { id: "power-in", label: "PWR", kind: "power", direction: "input", required: true };
const powerOut: ComponentPort = { id: "power-out", label: "PWR", kind: "power", direction: "output" };
const mountIn: ComponentPort = { id: "mount-in", label: "MNT", kind: "mount", direction: "input" };
const mountOut: ComponentPort = { id: "mount-out", label: "MNT", kind: "mount", direction: "output" };

export const productSpecProperties: ComponentPropertyDefinition[] = [
  { key: "specManufacturer", label: "Manufacturer", type: "text", defaultValue: "" },
  { key: "specModel", label: "Model / SKU", type: "text", defaultValue: "" },
  { key: "specPartNumber", label: "Part number", type: "text", defaultValue: "" },
  { key: "specDatasheetUrl", label: "Datasheet URL", type: "text", defaultValue: "" },
  { key: "specMassG", label: "Unit mass", type: "number", defaultValue: 0, min: 0, max: 100000, unit: "g" },
  { key: "specUnitCostUsd", label: "Unit cost", type: "number", defaultValue: 0, min: 0, max: 1000000, unit: "USD" },
  { key: "specNotes", label: "Spec notes", type: "text", defaultValue: "" }
];

export const componentCatalog: ComponentDefinition[] = [
  {
    type: "frame",
    name: "Airframe",
    category: "Core",
    summary: "Physical frame and motor layout.",
    icon: "Frame",
    ports: [mountOut],
    properties: [
      { key: "layout", label: "Layout", type: "select", defaultValue: "quad-x", options: ["quad-x", "hexa-x", "octa-x", "plane", "rover"] },
      { key: "wheelbaseMm", label: "Wheelbase", type: "number", defaultValue: 450, min: 120, max: 3000, unit: "mm" },
      { key: "massKg", label: "Dry mass", type: "number", defaultValue: 1.35, min: 0.1, max: 100, unit: "kg" }
    ]
  },
  {
    type: "flight-controller",
    name: "ArduPilot FC",
    category: "Core",
    summary: "Autopilot board running ArduPilot firmware.",
    icon: "Cpu",
    ports: [
      powerIn,
      { id: "analog-in", label: "ADC", kind: "analog", direction: "input" },
      { id: "uart-in", label: "UART", kind: "uart", direction: "input" },
      { id: "i2c-in", label: "I2C", kind: "i2c", direction: "input" },
      { id: "can-in", label: "CAN", kind: "can", direction: "input" },
      { id: "pwm-out", label: "PWM", kind: "pwm", direction: "output" },
      { id: "uart-out", label: "UART", kind: "uart", direction: "output" },
      { id: "i2c-out", label: "I2C", kind: "i2c", direction: "output" },
      { id: "can-out", label: "CAN", kind: "can", direction: "output" }
    ],
    properties: [
      { key: "board", label: "Board", type: "select", defaultValue: "Cube Orange+", options: ["Cube Orange+", "Pixhawk 6C", "Pixhawk 4", "SITL-only"] },
      { key: "firmware", label: "Firmware", type: "select", defaultValue: "ArduCopter", options: ["ArduCopter", "ArduPlane", "Rover"] },
      { key: "imuRateHz", label: "IMU rate", type: "number", defaultValue: 400, min: 50, max: 1000, unit: "Hz" }
    ]
  },
  {
    type: "battery",
    name: "Battery",
    category: "Power",
    summary: "Main energy source.",
    icon: "Battery",
    ports: [powerOut],
    properties: [
      { key: "cells", label: "Cells", type: "number", defaultValue: 4, min: 1, max: 14, unit: "S" },
      { key: "capacityMah", label: "Capacity", type: "number", defaultValue: 5200, min: 300, max: 50000, unit: "mAh" },
      { key: "cRating", label: "C rating", type: "number", defaultValue: 35, min: 5, max: 200 }
    ]
  },
  {
    type: "power-module",
    name: "Power Module",
    category: "Power",
    summary: "Voltage/current sensing and regulated FC power.",
    icon: "Gauge",
    ports: [
      powerIn,
      powerOut,
      { id: "analog-out", label: "ADC", kind: "analog", direction: "output" }
    ],
    properties: [
      { key: "maxAmps", label: "Max current", type: "number", defaultValue: 90, min: 5, max: 300, unit: "A" },
      { key: "regulatedVoltage", label: "Regulator", type: "number", defaultValue: 5.3, min: 4.8, max: 12, unit: "V" }
    ]
  },
  {
    type: "esc",
    name: "ESC",
    category: "Propulsion",
    summary: "Electronic speed controller.",
    icon: "Zap",
    ports: [
      powerIn,
      { id: "pwm-in", label: "PWM", kind: "pwm", direction: "input", required: true },
      powerOut
    ],
    properties: [
      { key: "protocol", label: "Protocol", type: "select", defaultValue: "PWM", options: ["PWM", "OneShot", "DShot150", "DShot300", "DShot600"] },
      { key: "maxAmps", label: "Max current", type: "number", defaultValue: 35, min: 5, max: 200, unit: "A" }
    ]
  },
  {
    type: "motor",
    name: "Motor",
    category: "Propulsion",
    summary: "Brushless propulsion motor.",
    icon: "CircleDot",
    ports: [
      powerIn,
      mountIn
    ],
    properties: [
      { key: "kv", label: "KV", type: "number", defaultValue: 920, min: 100, max: 4000 },
      { key: "propSize", label: "Prop size", type: "text", defaultValue: "10x4.5" },
      { key: "thrustGrams", label: "Thrust", type: "number", defaultValue: 950, min: 50, max: 20000, unit: "g" }
    ]
  },
  {
    type: "gps",
    name: "GPS",
    category: "Sensors",
    summary: "Position and velocity source.",
    icon: "MapPin",
    ports: [
      powerIn,
      { id: "uart-out", label: "UART", kind: "uart", direction: "output" }
    ],
    properties: [
      { key: "model", label: "Model", type: "select", defaultValue: "u-blox M10", options: ["u-blox M10", "u-blox F9P RTK", "SITL GPS"] },
      { key: "rateHz", label: "Rate", type: "number", defaultValue: 5, min: 1, max: 25, unit: "Hz" }
    ]
  },
  {
    type: "compass",
    name: "Compass",
    category: "Sensors",
    summary: "Magnetometer.",
    icon: "Compass",
    ports: [
      powerIn,
      { id: "i2c-out", label: "I2C", kind: "i2c", direction: "output" }
    ],
    properties: [
      { key: "model", label: "Model", type: "select", defaultValue: "RM3100", options: ["RM3100", "IST8310", "HMC5883", "SITL Compass"] },
      { key: "external", label: "External", type: "boolean", defaultValue: true }
    ]
  },
  {
    type: "rangefinder",
    name: "Rangefinder",
    category: "Sensors",
    summary: "Altitude or obstacle range sensor.",
    icon: "ScanLine",
    ports: [
      powerIn,
      { id: "i2c-out", label: "I2C", kind: "i2c", direction: "output" },
      { id: "uart-out", label: "UART", kind: "uart", direction: "output" }
    ],
    properties: [
      { key: "model", label: "Model", type: "select", defaultValue: "Benewake TFmini", options: ["Benewake TFmini", "LightWare SF11", "SITL Rangefinder"] },
      { key: "rangeMeters", label: "Range", type: "number", defaultValue: 12, min: 1, max: 120, unit: "m" }
    ]
  },
  {
    type: "telemetry-radio",
    name: "Telemetry Radio",
    category: "Comms",
    summary: "MAVLink radio link.",
    icon: "Radio",
    ports: [
      powerIn,
      { id: "uart-in", label: "UART", kind: "uart", direction: "input" }
    ],
    properties: [
      { key: "band", label: "Band", type: "select", defaultValue: "915 MHz", options: ["433 MHz", "868 MHz", "915 MHz", "Wi-Fi UDP"] },
      { key: "baud", label: "Baud", type: "number", defaultValue: 57600, min: 9600, max: 921600 }
    ]
  },
  {
    type: "camera",
    name: "Camera",
    category: "Payload",
    summary: "Video or perception payload.",
    icon: "Camera",
    ports: [
      powerIn,
      mountIn,
      { id: "video-out", label: "VID", kind: "video", direction: "output" }
    ],
    properties: [
      { key: "model", label: "Model", type: "text", defaultValue: "Global shutter cam" },
      { key: "resolution", label: "Resolution", type: "select", defaultValue: "1080p", options: ["720p", "1080p", "4K"] },
      { key: "massG", label: "Mass", type: "number", defaultValue: 45, min: 5, max: 5000, unit: "g" }
    ]
  },
  {
    type: "gimbal",
    name: "Gimbal",
    category: "Payload",
    summary: "Stabilized payload mount.",
    icon: "Rotate3D",
    ports: [
      powerIn,
      mountIn,
      { id: "pwm-in", label: "PWM", kind: "pwm", direction: "input" },
      mountOut
    ],
    properties: [
      { key: "axes", label: "Axes", type: "select", defaultValue: "3-axis", options: ["1-axis", "2-axis", "3-axis"] },
      { key: "maxPayloadG", label: "Payload", type: "number", defaultValue: 250, min: 20, max: 10000, unit: "g" }
    ]
  }
];

export function getComponentDefinition(type: string): ComponentDefinition {
  const definition = componentCatalog.find((component) => component.type === type);
  if (!definition) {
    throw new Error(`Unknown component type: ${type}`);
  }
  return definition;
}

export function getPort(componentType: string, handleId?: string | null): ComponentPort | undefined {
  if (!handleId) {
    return undefined;
  }
  return getComponentDefinition(componentType).ports.find((port) => port.id === handleId);
}

export function defaultPropertiesForComponent(componentType: string) {
  const definition = getComponentDefinition(componentType);
  return Object.fromEntries(
    [...definition.properties, ...productSpecProperties].map((property) => [property.key, property.defaultValue])
  ) as Record<string, string | number | boolean>;
}

export function createComponentNode(componentType: string, index: number): DesignNode {
  const definition = getComponentDefinition(componentType);

  return {
    id: `${componentType}-${crypto.randomUUID()}`,
    type: "componentNode",
    position: {
      x: 220 + (index % 4) * 110,
      y: 120 + Math.floor(index / 4) * 120
    },
    data: {
      componentType,
      label: definition.name,
      properties: defaultPropertiesForComponent(componentType)
    }
  };
}
