import type { ComponentDefinition } from "./design";
import type { CustomComponentTemplate } from "../lib/api";

const batteryPresetDefaults = {
  burstCRating: 0,
  continuousCurrentA: 0,
  connectorCurrentA: 0,
  nominalCellVoltageV: 0,
  maxCellVoltageV: 0,
  lowCellVoltageV: 0,
  criticalCellVoltageV: 0,
  chargeRateC: 0,
  dischargeConnector: "",
  balanceConnector: ""
};

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
    id: "preset-holybro-pm07-14s",
    name: "Holybro PM07 14S",
    baseType: "power-module",
    category: "Power" satisfies ComponentDefinition["category"],
    summary: "Analog 2–14S power module with 90 A continuous and 140 A burst PCB ratings.",
    properties: {
      maxAmps: 90,
      peakAmps: 140,
      inputCellsMax: 14,
      regulatedVoltage: 5.2,
      specManufacturer: "Holybro",
      specModel: "PM07 14S",
      specMassG: 43.8,
      specDatasheetUrl: "https://holybro.com/collections/power-modules-pdbs/products/pixhawk-4-power-module-pm07",
      specNotes: "2–14S input; PCB 90 A continuous / 140 A burst under the manufacturer's conditions. Pre-fitted XT60 and 12 AWG wiring are separately limited to 30 A continuous / 60 A burst unless changed. Analog voltage/current telemetry; verify Pixhawk compatibility."
    }
  },
  {
    id: "preset-4s-5200-lipo",
    name: "Tattu 4S 5200 mAh LiPo",
    baseType: "battery",
    category: "Power" satisfies ComponentDefinition["category"],
    summary: "Manufacturer-specified 14.8 V, 35C pack with XT60 connector.",
    properties: {
      ...batteryPresetDefaults,
      chemistry: "LiPo",
      cells: 4,
      parallelCells: 1,
      capacityMah: 5200,
      cRating: 35,
      burstCRating: 70,
      dischargeConnector: "XT60",
      balanceConnector: "JST-XHR",
      packLengthMm: 133,
      packWidthMm: 45,
      packHeightMm: 33.5,
      specManufacturer: "Tattu / Grepow",
      specModel: "G-Tech 5200 mAh 4S1P 35C",
      specPartNumber: "TA-35C-5200-4S1P-XT60",
      specMassG: 436.5,
      specDatasheetUrl: "https://www.genstattu.com/tattu-5200mah-14-8v-35c-4s1p-lipo-battery-pack-with-xt60-plug.html",
      specNotes: "Manufacturer page checked 2026-10-09. Pack capacity is 5200 mAh; published mass tolerance is ±20 g. Burst rating is separate from continuous capability. Connector/wiring current limit is unspecified."
    }
  },
  {
    id: "preset-tattu-6s-22000-lipo",
    name: "Tattu 6S 22000 mAh LiPo",
    baseType: "battery",
    category: "Power" satisfies ComponentDefinition["category"],
    summary: "Manufacturer-specified 22.2 V, 30C large UAV pack.",
    properties: {
      ...batteryPresetDefaults,
      chemistry: "LiPo",
      cells: 6,
      parallelCells: 1,
      capacityMah: 22000,
      cRating: 30,
      dischargeConnector: "XT90-S",
      balanceConnector: "JST-XHR-7P",
      packLengthMm: 206,
      packWidthMm: 91,
      packHeightMm: 61,
      specManufacturer: "Tattu / Grepow",
      specModel: "G-Tech 22000 mAh 6S1P 30C",
      specPartNumber: "TA-30C-22000-6S1P-XT90",
      specMassG: 2460,
      specDatasheetUrl: "https://genstattu.com/tattu-22-2v-30c-6s-22000mah-lipo-battery-with-xt90-s-plug-for-uav.html",
      specNotes: "Manufacturer page checked 2026-10-09. Published mass tolerance is ±20 g. Connector follows the XT90-S product title; its specifications table abbreviates XT90. Burst and connector/wiring current limits remain unspecified."
    }
  },
  {
    id: "preset-tattu-6s-17000-lihv",
    name: "Tattu 6S 17000 mAh LiHV",
    baseType: "battery",
    category: "Power" satisfies ComponentDefinition["category"],
    summary: "High-voltage UAV pack: 22.8 V nominal, 15C continuous.",
    properties: {
      ...batteryPresetDefaults,
      chemistry: "LiHV",
      cells: 6,
      parallelCells: 1,
      capacityMah: 17000,
      cRating: 15,
      burstCRating: 30,
      dischargeConnector: "XT90-S",
      balanceConnector: "JST-XHR-7P",
      packLengthMm: 192,
      packWidthMm: 76,
      packHeightMm: 62,
      specManufacturer: "Tattu / Grepow",
      specModel: "G-Tech 17000 mAh 6S1P HV 15C",
      specPartNumber: "TA-15C-17000-6S1P-HV-XT90",
      specMassG: 1874,
      specDatasheetUrl: "https://genstattu.com/tattu-22-8v-15c-6s-17000mah-lipo-battery-with-xt90-plug-for-uav.html",
      specNotes: "Manufacturer page checked 2026-10-09. Uses LiHV chemistry defaults of 3.8 V nominal and 4.35 V full per cell. Mass/dimensions follow this product page; other manufacturer listings vary. Connector title is XT90-S; table abbreviates XT90."
    }
  },
  {
    id: "preset-maxamps-6s2p-9000-li-ion",
    name: "MaxAmps 6S2P 9000 mAh Li-ion",
    baseType: "battery",
    category: "Power" satisfies ComponentDefinition["category"],
    summary: "Ready-made 21.6 V Li-ion UAV pack rated for 90 A continuous.",
    properties: {
      ...batteryPresetDefaults,
      chemistry: "Li-ion",
      cells: 6,
      parallelCells: 2,
      capacityMah: 9000,
      cRating: 10,
      continuousCurrentA: 90,
      packLengthMm: 129,
      packWidthMm: 44,
      packHeightMm: 78,
      specManufacturer: "MaxAmps",
      specModel: "Li-ion 9000 mAh 6S2P 21.6 V",
      specPartNumber: "MA-9000-6s2p-Li-ion-Pack",
      specMassG: 874,
      specDatasheetUrl: "https://maxamps.com/products/li-ion-9000-6s2p-21-6v-battery-pack",
      specNotes: "Manufacturer page checked 2026-10-09. 9000 mAh is total pack capacity, including 2P. 10C is calculated from the published 90 A / 9 Ah rating. Connectors are customer-selected. Current page mass/dimensions differ from its older linked PDF; see BATTERY_RESEARCH.md."
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
    id: "preset-hobbywing-xrotor-40a-6s",
    name: "Hobbywing XRotor 40A 6S BLDC",
    baseType: "esc",
    category: "Propulsion" satisfies ComponentDefinition["category"],
    summary: "40 A continuous / 60 A peak, 2–6S multirotor ESC without BEC.",
    properties: {
      protocol: "PWM",
      maxAmps: 40,
      peakAmps: 60,
      maxCells: 6,
      specManufacturer: "Hobbywing",
      specModel: "XRotor 40A 6S BLDC",
      specMassG: 18.5,
      specDatasheetUrl: "https://a.hobbywing.com/en/products/xrotor-40a122",
      specNotes: "Manufacturer lists 40 A continuous / 60 A peak, 2–6S LiPo, no BEC, and throttle signals up to 621 Hz. Confirm the exact international/Asian variant and protocol before wiring."
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
    id: "preset-holybro-f9p-dronecan",
    name: "Holybro H-RTK F9P DroneCAN",
    baseType: "gps",
    category: "Sensors" satisfies ComponentDefinition["category"],
    summary: "ZED-F9P dual-band RTK rover with DroneCAN and integrated compass.",
    properties: {
      model: "H-RTK F9P RTK",
      rateHz: 8,
      specManufacturer: "Holybro",
      specModel: "H-RTK F9P DroneCAN Rover",
      specMassG: 123,
      specDatasheetUrl: "https://docs.holybro.com/gps-and-rtk-system/f9p-h-rtk-series/dronecan-f9p/specification",
      specNotes: "ZED-F9P, DroneCAN 1 Mbit/s, RTK up to 8 Hz, 4.75–5.25 V, approximately 250 mA. The listed 123 g is the Rover configuration; confirm antenna and enclosure variant."
    }
  },
  {
    id: "preset-holybro-rm3100-compass",
    name: "Holybro DroneCAN RM3100 Compass",
    baseType: "compass",
    category: "Sensors" satisfies ComponentDefinition["category"],
    summary: "External DroneCAN industrial-grade RM3100 compass.",
    properties: {
      model: "DroneCAN RM3100",
      external: true,
      specManufacturer: "Holybro",
      specModel: "H-RTK NEO-F9P RM3100",
      specDatasheetUrl: "https://docs.holybro.com/gps-and-rtk-system/h-rtk-neo-f9p-series-rm3100-compass/specification",
      specNotes: "Use as an external compass away from high-current wiring. The manufacturer documents DroneCAN and UART variants; select the interface and port wiring that match the installed unit."
    }
  },
  {
    id: "preset-benewake-tfmini-s",
    name: "Benewake TFmini-S",
    baseType: "rangefinder",
    category: "Sensors" satisfies ComponentDefinition["category"],
    summary: "5 g, 0.1–12 m single-point LiDAR with UART/I2C/I/O.",
    properties: {
      model: "Benewake TFmini-S",
      rangeMeters: 12,
      specManufacturer: "Benewake",
      specModel: "TFmini-S",
      specMassG: 5,
      specDatasheetUrl: "https://ai.benewake.com/en/products/tfmini-s/",
      specNotes: "5 V supply, up to 1000 Hz, 42 × 15 × 16 mm, 2° field of view. Manufacturer states accuracy and reflectivity limits; do not treat a short-range rangefinder as a redundant safety system."
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
    id: "preset-rfd900x-documented",
    name: "RFDesign RFD900x 915 MHz",
    baseType: "telemetry-radio",
    category: "Comms" satisfies ComponentDefinition["category"],
    summary: "Diversity MAVLink modem for 902–928 MHz regional operation.",
    properties: {
      band: "915 MHz",
      baud: 57600,
      specManufacturer: "RFDesign",
      specModel: "RFD900x",
      specMassG: 14,
      specDatasheetUrl: "https://files.rfdesign.com.au/Files/documents/RFD900x%20DataSheet%20V1.1.pdf",
      specNotes: "902–928 MHz, two diversity antennas, up to 500 kbps air data rate, 5 V nominal supply, approximately 1 A peak transmit current. Frequency and transmit power must comply with the operating region."
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
