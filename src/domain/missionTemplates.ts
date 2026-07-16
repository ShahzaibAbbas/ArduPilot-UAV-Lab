import { MarkerType } from "@xyflow/react";
import { airframeLabel, rotorCountForFrame } from "./airframes";
import { defaultPropertiesForComponent } from "./componentCatalog";
import { defaultSettings, type DesignEdge, type DesignNode, type SimulationSettings, type UavDesign } from "./design";

export type MissionProfileId = SimulationSettings["missionProfile"];
export type MissionSystemId = "camera" | "companion-computer" | "rangefinder" | "optical-flow" | "rc-receiver" | "parachute";

export interface MissionProfileOption {
  id: MissionProfileId;
  label: string;
  summary: string;
  objective: string;
  distanceKm: number;
  altitudeM: number;
  systems: MissionSystemId[];
}

export interface NewMissionDraft {
  projectName: string;
  profile: MissionProfileId;
  objective: string;
  environment: SimulationSettings["missionEnvironment"];
  distanceKm: number;
  altitudeM: number;
  vehicle: SimulationSettings["vehicle"];
  frame: string;
  systems: MissionSystemId[];
}

export const missionProfiles: MissionProfileOption[] = [
  {
    id: "mapping",
    label: "Mapping & survey",
    summary: "Repeatable area coverage with a stabilized imaging payload.",
    objective: "Capture georeferenced imagery over a defined survey area with repeatable overlap and safe return margins.",
    distanceKm: 8,
    altitudeM: 80,
    systems: ["camera", "companion-computer", "rangefinder"]
  },
  {
    id: "inspection",
    label: "Inspection",
    summary: "Close-range infrastructure or asset inspection.",
    objective: "Inspect a target asset at controlled stand-off distance while maintaining stable imagery and obstacle awareness.",
    distanceKm: 3,
    altitudeM: 35,
    systems: ["camera", "rangefinder", "rc-receiver"]
  },
  {
    id: "delivery",
    label: "Payload delivery",
    summary: "Carry a payload between defined launch and delivery points.",
    objective: "Deliver a mission payload to the target point while preserving power reserve and a verified recovery path.",
    distanceKm: 5,
    altitudeM: 50,
    systems: ["rc-receiver", "parachute"]
  },
  {
    id: "research",
    label: "Research platform",
    summary: "Flexible sensing, autonomy, and experiment integration.",
    objective: "Provide a repeatable flight platform for onboard sensing, autonomy experiments, and synchronized data collection.",
    distanceKm: 4,
    altitudeM: 45,
    systems: ["camera", "companion-computer", "rangefinder", "optical-flow"]
  },
  {
    id: "training",
    label: "Training & SITL",
    summary: "Learn configuration, wiring, validation, and simulated flight.",
    objective: "Validate a complete ArduPilot vehicle design in simulation before hardware integration.",
    distanceKm: 2,
    altitudeM: 30,
    systems: ["rc-receiver"]
  },
  {
    id: "custom",
    label: "Custom mission",
    summary: "Start with the essential systems and define your own objective.",
    objective: "Define the mission outcome, operating constraints, payload, and acceptance criteria.",
    distanceKm: 2,
    altitudeM: 30,
    systems: []
  }
];

export function missionProfile(id: MissionProfileId) {
  return missionProfiles.find((profile) => profile.id === id) ?? missionProfiles.at(-1)!;
}

export function defaultFrameForVehicle(vehicle: SimulationSettings["vehicle"]) {
  if (vehicle === "ArduPlane") return "fixed-wing";
  if (vehicle === "Rover") return "rover";
  return "quad-x";
}

export function defaultNewMissionDraft(): NewMissionDraft {
  const profile = missionProfile("training");
  return {
    projectName: "New UAV Mission",
    profile: profile.id,
    objective: profile.objective,
    environment: "outdoor",
    distanceKm: profile.distanceKm,
    altitudeM: profile.altitudeM,
    vehicle: "ArduCopter",
    frame: "quad-x",
    systems: [...profile.systems]
  };
}

function componentNode(
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
      properties: { ...defaultPropertiesForComponent(componentType), ...overrides }
    }
  };
}

function connection(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): DesignEdge {
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

function payloadLabel(systems: MissionSystemId[]) {
  if (systems.includes("camera") && systems.includes("companion-computer")) return "Imaging + onboard compute";
  if (systems.includes("camera")) return "Imaging payload";
  if (systems.includes("companion-computer")) return "Onboard compute";
  return "None";
}

export function createMissionDesign(draft: NewMissionDraft): UavDesign {
  const profile = missionProfile(draft.profile);
  const frame = draft.vehicle === "ArduCopter" ? draft.frame : defaultFrameForVehicle(draft.vehicle);
  const propulsionCount = draft.vehicle === "Rover" ? 0 : Math.max(1, rotorCountForFrame(frame));
  const nodes: DesignNode[] = [
    componentNode("frame-1", "frame", airframeLabel(frame), 520, 150, { layout: frame }),
    componentNode("landing-gear-1", "landing-gear", draft.vehicle === "Rover" ? "Wheel Set" : "Landing Gear", 520, 10, {
      style: draft.vehicle === "Rover" ? "Wheels" : draft.vehicle === "ArduPlane" ? "Fixed legs" : "Skids"
    }),
    componentNode("fc-1", "flight-controller", "ArduPilot Flight Controller", 520, 345, { firmware: draft.vehicle }),
    componentNode("battery-1", "battery", "Main Battery", 20, 250),
    componentNode("fuse-1", "fuse", "Main Protection", 145, 250),
    componentNode("pdb-1", "power-distribution-board", "Protected Power Distribution", 275, 195, {
      branchCount: Math.max(6, propulsionCount + 4)
    }),
    componentNode("pm-1", "power-module", "Power Module", 275, 335),
    componentNode("harness-1", "wiring-harness", "Documented Wiring Harness", 520, 535),
    componentNode("gps-1", "gps", "Primary GNSS", 770, 220),
    componentNode("compass-1", "compass", "External Compass", 770, 370),
    componentNode("radio-1", "telemetry-radio", "MAVLink Telemetry", 1010, 370),
    componentNode("buzzer-1", "buzzer", "Status & Failsafe Alert", 1010, 520)
  ];
  const edges: DesignEdge[] = [
    connection("e-battery-fuse", "battery-1", "power-out", "fuse-1", "power-in"),
    connection("e-fuse-pdb", "fuse-1", "power-out", "pdb-1", "power-in"),
    connection("e-pdb-pm", "pdb-1", "power-out", "pm-1", "power-in"),
    connection("e-pm-fc-power", "pm-1", "power-out", "fc-1", "power-in"),
    connection("e-pm-fc-adc", "pm-1", "analog-out", "fc-1", "analog-in"),
    connection("e-pdb-harness", "pdb-1", "power-out", "harness-1", "power-in"),
    connection("e-frame-gear", "frame-1", "mount-out", "landing-gear-1", "mount-in"),
    connection("e-gps-fc", "gps-1", "uart-out", "fc-1", "uart-in"),
    connection("e-compass-fc", "compass-1", "i2c-out", "fc-1", "i2c-in"),
    connection("e-fc-radio", "fc-1", "uart-out", "radio-1", "uart-in"),
    connection("e-harness-radio", "harness-1", "power-out", "radio-1", "power-in"),
    connection("e-harness-buzzer", "harness-1", "power-out", "buzzer-1", "power-in"),
    connection("e-fc-buzzer", "fc-1", "pwm-out", "buzzer-1", "pwm-in")
  ];

  for (let index = 0; index < propulsionCount; index += 1) {
    const angle = -Math.PI / 2 + (index / Math.max(propulsionCount, 1)) * Math.PI * 2;
    const motorX = 520 + Math.cos(angle) * 460;
    const motorY = 310 + Math.sin(angle) * 310;
    const escX = 520 + Math.cos(angle) * 300;
    const escY = 300 + Math.sin(angle) * 205;
    const number = index + 1;
    nodes.push(componentNode(`esc-${number}`, "esc", `ESC ${number}`, escX, escY));
    nodes.push(componentNode(`motor-${number}`, "motor", draft.vehicle === "ArduPlane" ? "Propulsion Motor" : `Motor ${number}`, motorX, motorY));
    edges.push(
      connection(`e-frame-motor-${number}`, "frame-1", "mount-out", `motor-${number}`, "mount-in"),
      connection(`e-pdb-esc-${number}`, "pdb-1", "power-out", `esc-${number}`, "power-in"),
      connection(`e-fc-esc-${number}`, "fc-1", "pwm-out", `esc-${number}`, "pwm-in"),
      connection(`e-esc-motor-${number}`, `esc-${number}`, "power-out", `motor-${number}`, "power-in")
    );
  }

  let optionalY = 680;
  const addOptional = (type: string, label: string, overrides: Record<string, string | number | boolean> = {}) => {
    const id = `${type}-mission`;
    nodes.push(componentNode(id, type, label, 780 + ((nodes.length % 2) * 230), optionalY, overrides));
    optionalY += 125;
    return id;
  };

  let companionId: string | undefined;
  if (draft.systems.includes("companion-computer")) {
    companionId = addOptional("companion-computer", "Mission Computer");
    edges.push(
      connection("e-harness-companion", "harness-1", "power-out", companionId, "power-in"),
      connection("e-fc-companion", "fc-1", "uart-out", companionId, "uart-in")
    );
  }
  if (draft.systems.includes("camera")) {
    const mountId = addOptional("payload-mount", "Mission Payload Mount");
    const gimbalId = addOptional("gimbal", "Stabilized Gimbal");
    const cameraId = addOptional("camera", "Mission Camera");
    edges.push(
      connection("e-frame-payload", "frame-1", "mount-out", mountId, "mount-in"),
      connection("e-mount-gimbal", mountId, "mount-out", gimbalId, "mount-in"),
      connection("e-gimbal-camera", gimbalId, "mount-out", cameraId, "mount-in"),
      connection("e-harness-gimbal", "harness-1", "power-out", gimbalId, "power-in"),
      connection("e-harness-camera", "harness-1", "power-out", cameraId, "power-in")
    );
    if (companionId) edges.push(connection("e-camera-companion", cameraId, "video-out", companionId, "video-in"));
  }
  if (draft.systems.includes("rangefinder")) {
    const id = addOptional("rangefinder", "Mission Rangefinder");
    edges.push(
      connection("e-harness-rangefinder", "harness-1", "power-out", id, "power-in"),
      connection("e-rangefinder-fc", id, "uart-out", "fc-1", "uart-in"),
      connection("e-frame-rangefinder", "frame-1", "mount-out", id, "mount-in")
    );
  }
  if (draft.systems.includes("optical-flow")) {
    const id = addOptional("optical-flow", "Optical Flow");
    edges.push(
      connection("e-harness-flow", "harness-1", "power-out", id, "power-in"),
      connection("e-flow-fc", id, "i2c-out", "fc-1", "i2c-in"),
      connection("e-frame-flow", "frame-1", "mount-out", id, "mount-in")
    );
  }
  if (draft.systems.includes("rc-receiver")) {
    const id = addOptional("rc-receiver", "Pilot Control Receiver");
    edges.push(
      connection("e-harness-rc", "harness-1", "power-out", id, "power-in"),
      connection("e-rc-fc", id, "uart-out", "fc-1", "uart-in")
    );
  }
  if (draft.systems.includes("parachute")) {
    const id = addOptional("parachute", "Recovery Parachute");
    edges.push(
      connection("e-harness-parachute", "harness-1", "power-out", id, "power-in"),
      connection("e-frame-parachute", "frame-1", "mount-out", id, "mount-in"),
      connection("e-fc-parachute", "fc-1", "pwm-out", id, "pwm-in")
    );
  }

  return {
    name: draft.projectName.trim() || "New UAV Mission",
    nodes,
    edges,
    settings: {
      ...defaultSettings,
      gcsTargets: defaultSettings.gcsTargets.map((target) => ({ ...target })),
      missionProfile: draft.profile,
      missionObjective: draft.objective.trim() || profile.objective,
      missionEnvironment: draft.environment,
      missionPayload: payloadLabel(draft.systems),
      missionAltitudeM: Math.max(0, draft.altitudeM),
      missionDistanceKm: Math.max(0, draft.distanceKm),
      vehicle: draft.vehicle,
      frame,
      testScenario: draft.systems.includes("optical-flow") ? "gps-denied" : "nominal"
    }
  };
}
