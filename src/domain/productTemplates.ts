import type { ComponentDefinition } from "./design";
import type { CustomComponentTemplate } from "../lib/api";

export const productTemplates: CustomComponentTemplate[] = [
  {
    id: "preset-cube-orange-plus",
    name: "Cube Orange+",
    baseType: "flight-controller",
    category: "Core" satisfies ComponentDefinition["category"],
    summary: "ArduPilot flight-controller preset with common Cube-class defaults.",
    properties: {
      board: "Cube Orange+",
      firmware: "ArduCopter",
      imuRateHz: 400,
      specManufacturer: "CubePilot",
      specModel: "Cube Orange+",
      specNotes: "Starter preset; verify exact board revision and carrier wiring before purchase."
    }
  },
  {
    id: "preset-pixhawk-6c",
    name: "Pixhawk 6C",
    baseType: "flight-controller",
    category: "Core" satisfies ComponentDefinition["category"],
    summary: "Pixhawk-class ArduPilot controller preset.",
    properties: {
      board: "Pixhawk 6C",
      firmware: "ArduCopter",
      imuRateHz: 400,
      specManufacturer: "Holybro",
      specModel: "Pixhawk 6C",
      specNotes: "Starter preset; confirm connector pinout and power-module compatibility."
    }
  },
  {
    id: "preset-4s-5200-lipo",
    name: "4S 5200 mAh LiPo",
    baseType: "battery",
    category: "Power" satisfies ComponentDefinition["category"],
    summary: "Common 4S multirotor battery starting point.",
    properties: {
      cells: 4,
      capacityMah: 5200,
      cRating: 35,
      specModel: "4S 5200 mAh LiPo",
      specMassG: 520,
      specNotes: "Generic starter pack; verify discharge rating, connector, and measured mass."
    }
  },
  {
    id: "preset-holybro-pm07",
    name: "Holybro PM07",
    baseType: "power-module",
    category: "Power" satisfies ComponentDefinition["category"],
    summary: "Power module preset for voltage/current sensing.",
    properties: {
      maxAmps: 90,
      regulatedVoltage: 5.3,
      specManufacturer: "Holybro",
      specModel: "PM07",
      specNotes: "Starter wiring preset; confirm current sensor scale before flight."
    }
  },
  {
    id: "preset-hobbywing-xrotor-40a",
    name: "Hobbywing X-Rotor 40A",
    baseType: "esc",
    category: "Propulsion" satisfies ComponentDefinition["category"],
    summary: "Common multirotor ESC preset.",
    properties: {
      protocol: "DShot300",
      maxAmps: 40,
      specManufacturer: "Hobbywing",
      specModel: "X-Rotor 40A",
      specNotes: "Starter ESC preset; verify firmware protocol and continuous current."
    }
  },
  {
    id: "preset-tmotor-920kv",
    name: "920 KV Motor",
    baseType: "motor",
    category: "Propulsion" satisfies ComponentDefinition["category"],
    summary: "10-inch quad motor starting point.",
    properties: {
      kv: 920,
      propSize: "10x4.5",
      thrustGrams: 950,
      specModel: "920 KV class motor",
      specNotes: "Generic product-class preset; replace with datasheet thrust table."
    }
  },
  {
    id: "preset-here3-gps",
    name: "Here3 GPS",
    baseType: "gps",
    category: "Sensors" satisfies ComponentDefinition["category"],
    summary: "GNSS module preset for ArduPilot designs.",
    properties: {
      model: "u-blox M10",
      rateHz: 5,
      specManufacturer: "CubePilot",
      specModel: "Here3 GPS",
      specNotes: "Starter GNSS preset; verify protocol, compass presence, and CAN/UART wiring."
    }
  },
  {
    id: "preset-px4flow",
    name: "PX4Flow",
    baseType: "optical-flow",
    category: "Sensors" satisfies ComponentDefinition["category"],
    summary: "Optical-flow preset for GPS-denied hover tests.",
    properties: {
      model: "PX4Flow",
      interface: "I2C",
      fovDeg: 42,
      requiresRangefinder: true,
      specModel: "PX4Flow",
      specNotes: "Pair with a rangefinder for reliable height-above-ground estimates."
    }
  },
  {
    id: "preset-rfd900x",
    name: "RFD900x Telemetry",
    baseType: "telemetry-radio",
    category: "Comms" satisfies ComponentDefinition["category"],
    summary: "Long-range MAVLink telemetry radio preset.",
    properties: {
      band: "915 MHz",
      baud: 57600,
      specManufacturer: "RFDesign",
      specModel: "RFD900x",
      specNotes: "Check regional frequency rules and antenna placement."
    }
  },
  {
    id: "preset-jetson-orin-nano",
    name: "Jetson Orin Nano",
    baseType: "companion-computer",
    category: "Comms" satisfies ComponentDefinition["category"],
    summary: "Companion-computer preset for perception/autonomy workloads.",
    properties: {
      model: "Jetson Orin Nano",
      powerWatts: 15,
      mavlinkBaud: 921600,
      specManufacturer: "NVIDIA",
      specModel: "Jetson Orin Nano",
      specNotes: "Budget power and cooling separately from flight-critical avionics."
    }
  }
];
