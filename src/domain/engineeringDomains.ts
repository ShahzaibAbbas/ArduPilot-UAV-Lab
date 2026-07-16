import type { DesignEdge, DesignNode, SimulationSettings } from "./design";
import { componentCatalog } from "./componentCatalog";
import { expectedMotorCount } from "./validators";

export type EngineeringDomainId =
  | "electrical-power"
  | "wiring-buses"
  | "mechanical-mounting"
  | "propulsion"
  | "avionics-sensors"
  | "communications"
  | "safety";

export type EngineeringCheckSeverity = "error" | "warning" | "info";
export type EngineeringDomainStatus = "not-started" | "in-progress" | "needs-attention" | "complete";

export interface EngineeringAcceptanceDefinition {
  id: string;
  label: string;
  description: string;
  severity: EngineeringCheckSeverity;
}

export interface EngineeringDomainDefinition {
  id: EngineeringDomainId;
  label: string;
  description: string;
  componentTypes: readonly string[];
  acceptanceChecks: readonly EngineeringAcceptanceDefinition[];
}

export interface EngineeringAcceptanceCheck extends EngineeringAcceptanceDefinition {
  passed: boolean;
  detail: string;
  nodeIds: string[];
}

export interface EngineeringDomainAssessment extends EngineeringDomainDefinition {
  completed: number;
  total: number;
  progress: number;
  status: EngineeringDomainStatus;
  checks: EngineeringAcceptanceCheck[];
}

export interface EngineeringAssessmentSummary {
  completed: number;
  total: number;
  progress: number;
  status: EngineeringDomainStatus;
  domainsNeedingAttention: EngineeringDomainId[];
}

/** Maps catalog component types to every discipline that owns or reviews them. */
export const componentDomainMap: Readonly<Record<string, readonly EngineeringDomainId[]>> = {
  frame: ["mechanical-mounting"],
  "flight-controller": ["electrical-power", "wiring-buses", "avionics-sensors", "safety"],
  battery: ["electrical-power", "wiring-buses", "safety"],
  "power-module": ["electrical-power", "wiring-buses", "avionics-sensors", "safety"],
  fuse: ["electrical-power", "wiring-buses", "safety"],
  "power-distribution-board": ["electrical-power", "wiring-buses", "safety"],
  "wiring-harness": ["electrical-power", "wiring-buses", "mechanical-mounting"],
  esc: ["electrical-power", "wiring-buses", "propulsion", "safety"],
  motor: ["electrical-power", "mechanical-mounting", "propulsion"],
  gps: ["wiring-buses", "avionics-sensors"],
  compass: ["wiring-buses", "avionics-sensors"],
  rangefinder: ["wiring-buses", "mechanical-mounting", "avionics-sensors"],
  "airspeed-sensor": ["wiring-buses", "mechanical-mounting", "avionics-sensors"],
  "optical-flow": ["wiring-buses", "mechanical-mounting", "avionics-sensors"],
  "telemetry-radio": ["electrical-power", "wiring-buses", "communications"],
  "rc-receiver": ["electrical-power", "wiring-buses", "communications", "safety"],
  "companion-computer": ["electrical-power", "wiring-buses", "avionics-sensors", "communications"],
  "adsb-remote-id": ["electrical-power", "wiring-buses", "communications", "safety"],
  parachute: ["electrical-power", "wiring-buses", "mechanical-mounting", "safety"],
  buzzer: ["electrical-power", "wiring-buses", "safety"],
  camera: ["electrical-power", "wiring-buses", "mechanical-mounting", "avionics-sensors"],
  gimbal: ["electrical-power", "wiring-buses", "mechanical-mounting"],
  "payload-mount": ["mechanical-mounting"],
  "landing-gear": ["mechanical-mounting", "safety"]
};

const acceptance: Record<EngineeringDomainId, readonly EngineeringAcceptanceDefinition[]> = {
  "electrical-power": [
    { id: "energy-source", label: "Energy source defined", description: "A rated battery supplies the aircraft.", severity: "error" },
    { id: "power-path", label: "Power path distributed", description: "A power module or distribution board feeds the loads.", severity: "error" },
    { id: "controller-power", label: "Controller power connected", description: "The flight controller has an explicit power feed.", severity: "error" },
    { id: "ratings", label: "Electrical ratings recorded", description: "Battery and installed protection ratings are valid.", severity: "warning" },
    { id: "overcurrent-protection", label: "Overcurrent protection installed", description: "A fuse or protected distribution board is present in the battery power path.", severity: "warning" },
    { id: "wire-rating", label: "Power wiring rated", description: "A documented harness records positive wire gauge and current ratings.", severity: "warning" }
  ],
  "wiring-buses": [
    { id: "compatible-edges", label: "Connections are compatible", description: "Explicit connections use matching signal types and directions.", severity: "error" },
    { id: "required-ports", label: "Required ports connected", description: "Every required input and output is wired.", severity: "error" },
    { id: "essential-buses", label: "Essential buses connected", description: "Installed navigation sensors have a data path to the controller.", severity: "warning" },
    { id: "harness-defined", label: "Harness is documented", description: "Wiring is explicit or a harness component records build data.", severity: "info" }
  ],
  "mechanical-mounting": [
    { id: "airframe", label: "Airframe defined", description: "A dimensioned airframe anchors the assembly.", severity: "error" },
    { id: "propulsion-mounts", label: "Propulsion mounted", description: "Every motor has an airframe mounting path.", severity: "error" },
    { id: "payload-mounts", label: "Payloads retained", description: "Installed payloads and gimbals have mounting paths.", severity: "warning" },
    { id: "landing-provision", label: "Landing provision defined", description: "A frame-integrated or discrete landing arrangement is identified.", severity: "info" }
  ],
  propulsion: [
    { id: "propulsor-count", label: "Propulsor count matches", description: "Motor and ESC counts match the selected vehicle frame.", severity: "error" },
    { id: "motor-drive", label: "Motors have drives", description: "Every motor is fed by an ESC.", severity: "error" },
    { id: "esc-command", label: "ESC commands connected", description: "Every ESC receives a controller command.", severity: "error" },
    { id: "propulsion-ratings", label: "Propulsion ratings defined", description: "Motor thrust and ESC current ratings are positive.", severity: "warning" }
  ],
  "avionics-sensors": [
    { id: "flight-controller", label: "Flight controller installed", description: "An ArduPilot-capable controller is present.", severity: "error" },
    { id: "navigation-source", label: "Navigation source installed", description: "A GPS or local-position sensor is available.", severity: "warning" },
    { id: "sensor-links", label: "Sensor links connected", description: "Installed navigation sensors connect to the controller.", severity: "error" },
    { id: "scenario-sensors", label: "Scenario sensors covered", description: "The selected test scenario has the sensors it depends on.", severity: "warning" }
  ],
  communications: [
    { id: "control-link", label: "Control link installed", description: "Telemetry or an RC receiver provides an operator link.", severity: "warning" },
    { id: "control-link-wired", label: "Control link wired", description: "Installed operator links connect to the flight controller.", severity: "error" },
    { id: "traffic-link", label: "Traffic equipment integrated", description: "Installed ADS-B or Remote ID equipment has a data connection.", severity: "warning" }
  ],
  safety: [
    { id: "battery-failsafe", label: "Battery failsafe configured", description: "Low and critical thresholds are ordered and actionable.", severity: "error" },
    { id: "overcurrent-protection", label: "Overcurrent protection defined", description: "A fuse or protected distribution device limits fault current.", severity: "warning" },
    { id: "local-alert", label: "Local alert available", description: "A buzzer or status indicator supports arming and fault awareness.", severity: "warning" },
    { id: "recovery-output", label: "Safety outputs connected", description: "Installed alert and recovery devices have controller triggers.", severity: "error" }
  ]
};

const domainMetadata: Array<Omit<EngineeringDomainDefinition, "componentTypes" | "acceptanceChecks">> = [
  { id: "electrical-power", label: "Electrical & Power", description: "Energy storage, conversion, protection, sensing, and load distribution." },
  { id: "wiring-buses", label: "Wiring & Buses", description: "Power harnesses, signal integrity, connectors, and digital/analog buses." },
  { id: "mechanical-mounting", label: "Mechanical & Mounting", description: "Structure, retention, landing interfaces, clearance, and payload mounting." },
  { id: "propulsion", label: "Propulsion", description: "Motors, ESCs, propulsors, commands, and thrust-producing hardware." },
  { id: "avionics-sensors", label: "Avionics & Sensors", description: "Flight computing, navigation, environment sensing, and onboard perception." },
  { id: "communications", label: "Communications", description: "RC, telemetry, MAVLink, traffic awareness, and regulatory broadcast links." },
  { id: "safety", label: "Safety", description: "Fault protection, failsafes, alerts, containment, and emergency recovery." }
];

export const engineeringDomains: readonly EngineeringDomainDefinition[] = domainMetadata.map((domain) => ({
  ...domain,
  componentTypes: Object.entries(componentDomainMap)
    .filter(([, domainIds]) => domainIds.includes(domain.id))
    .map(([componentType]) => componentType),
  acceptanceChecks: acceptance[domain.id]
}));

export const engineeringDomainById: Readonly<Record<EngineeringDomainId, EngineeringDomainDefinition>> =
  Object.fromEntries(engineeringDomains.map((domain) => [domain.id, domain])) as Record<
    EngineeringDomainId,
    EngineeringDomainDefinition
  >;

export function getEngineeringDomain(id: EngineeringDomainId): EngineeringDomainDefinition {
  return engineeringDomainById[id];
}

export function getEngineeringDomainsForComponent(componentType: string): readonly EngineeringDomainDefinition[] {
  return (componentDomainMap[componentType] ?? []).map(getEngineeringDomain);
}

export function progressForEngineeringChecks(checks: readonly Pick<EngineeringAcceptanceCheck, "passed">[]): number {
  return checks.length === 0 ? 0 : Math.round((checks.filter((check) => check.passed).length / checks.length) * 100);
}

export function statusForEngineeringChecks(
  checks: readonly Pick<EngineeringAcceptanceCheck, "passed" | "severity">[]
): EngineeringDomainStatus {
  if (checks.length === 0 || checks.every((check) => !check.passed)) return "not-started";
  if (checks.every((check) => check.passed)) return "complete";
  if (checks.some((check) => !check.passed && check.severity === "error")) return "needs-attention";
  return "in-progress";
}

function nodesOf(nodes: readonly DesignNode[], componentType: string) {
  return nodes.filter((node) => node.data.componentType === componentType);
}

function propertyNumber(node: DesignNode, key: string, fallback = 0) {
  const value = Number(node.data.properties[key]);
  return Number.isFinite(value) ? value : fallback;
}

function reachableSignalNodes(
  startNodeIds: readonly string[],
  edges: readonly DesignEdge[],
  nodesById: ReadonlyMap<string, DesignNode>,
  signal: "power" | "mount"
) {
  const definitions = new Map(componentCatalog.map((definition) => [definition.type, definition]));
  const signalEdges = edges.filter((edge) => {
    const sourceType = nodesById.get(edge.source)?.data.componentType ?? "";
    const targetType = nodesById.get(edge.target)?.data.componentType ?? "";
    const sourcePort = definitions.get(sourceType)?.ports.find((port) => port.id === edge.sourceHandle);
    const targetPort = definitions.get(targetType)?.ports.find((port) => port.id === edge.targetHandle);
    return sourcePort?.kind === signal && targetPort?.kind === signal;
  });
  const reached = new Set(startNodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of signalEdges) {
      if (reached.has(edge.source) && !reached.has(edge.target)) {
        reached.add(edge.target);
        changed = true;
      }
    }
  }
  return reached;
}

function connectedToController(edge: DesignEdge, nodesById: ReadonlyMap<string, DesignNode>, componentType: string) {
  const sourceType = nodesById.get(edge.source)?.data.componentType;
  const targetType = nodesById.get(edge.target)?.data.componentType;
  return (
    (sourceType === componentType && targetType === "flight-controller") ||
    (sourceType === "flight-controller" && targetType === componentType)
  );
}

function makeCheck(
  domainId: EngineeringDomainId,
  id: string,
  passed: boolean,
  detail: string,
  nodeIds: readonly string[] = []
): EngineeringAcceptanceCheck {
  const definition = acceptance[domainId].find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Unknown ${domainId} acceptance check: ${id}`);
  return { ...definition, passed, detail, nodeIds: [...nodeIds] };
}

function electricalChecks(nodes: readonly DesignNode[], edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>) {
  const batteries = nodesOf(nodes, "battery");
  const controllers = nodesOf(nodes, "flight-controller");
  const distributors = [...nodesOf(nodes, "power-module"), ...nodesOf(nodes, "power-distribution-board")];
  const fuses = nodesOf(nodes, "fuse");
  const protectedDistributors = nodesOf(nodes, "power-distribution-board").filter(
    (distributor) => distributor.data.properties.protectedOutputs === true
  );
  const harnesses = nodesOf(nodes, "wiring-harness");
  const poweredNodes = reachableSignalNodes(batteries.map(({ id }) => id), edges, nodesById, "power");
  const powerPathValid = distributors.some((distributor) => poweredNodes.has(distributor.id));
  const controllerPowered = controllers.every((controller) => poweredNodes.has(controller.id));
  const poweredProtection = [...fuses, ...protectedDistributors].filter((device) => poweredNodes.has(device.id));
  const harnessRatingsValid =
    harnesses.length > 0 &&
    harnesses.every(
      (harness) => propertyNumber(harness, "powerWireAwg") > 0 && propertyNumber(harness, "maxCurrentA") > 0
    );
  const ratingsValid =
    batteries.length > 0 &&
    batteries.every((battery) =>
      propertyNumber(battery, "cells") > 0 && propertyNumber(battery, "capacityMah") > 0 && propertyNumber(battery, "cRating") > 0
    ) &&
    fuses.every((fuse) => propertyNumber(fuse, "ratingAmps") > 0 && propertyNumber(fuse, "voltageRating") > 0);

  return [
    makeCheck("electrical-power", "energy-source", batteries.length > 0, batteries.length ? `${batteries.length} battery source(s) defined.` : "Add a rated battery.", batteries.map(({ id }) => id)),
    makeCheck("electrical-power", "power-path", powerPathValid, powerPathValid ? `${distributors.length} distribution/sensing device(s) are downstream of the battery.` : distributors.length ? "Connect the battery through the installed power distribution path." : "Add a power module or distribution board.", distributors.map(({ id }) => id)),
    makeCheck("electrical-power", "controller-power", controllers.length > 0 && controllerPowered, controllers.length === 0 ? "Add a flight controller." : controllerPowered ? "Every flight controller has a power feed." : "Connect power to each flight controller.", controllers.map(({ id }) => id)),
    makeCheck("electrical-power", "ratings", ratingsValid, ratingsValid ? "Battery and protection ratings are positive." : "Complete battery cell, capacity, C-rating, and installed fuse ratings.", [...batteries, ...fuses].map(({ id }) => id)),
    makeCheck("electrical-power", "overcurrent-protection", poweredProtection.length > 0, poweredProtection.length ? `${poweredProtection.length} overcurrent protection device(s) are present in the battery power path.` : "Add a fuse or protected distribution board downstream of the battery.", [...fuses, ...protectedDistributors].map(({ id }) => id)),
    makeCheck("electrical-power", "wire-rating", harnessRatingsValid, harnessRatingsValid ? `${harnesses.length} harness(es) document positive power-wire gauge and current ratings.` : harnesses.length ? "Complete the power-wire gauge and maximum-current rating for every harness." : "Add a wiring harness with its power-wire gauge and maximum-current rating.", harnesses.map(({ id }) => id))
  ];
}

function wiringChecks(nodes: readonly DesignNode[], edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>) {
  const definitions = new Map(componentCatalog.map((definition) => [definition.type, definition]));
  const incompatibleEdgeIds = edges.flatMap((edge) => {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    const sourcePort = definitions.get(source?.data.componentType ?? "")?.ports.find((port) => port.id === edge.sourceHandle);
    const targetPort = definitions.get(target?.data.componentType ?? "")?.ports.find((port) => port.id === edge.targetHandle);
    if (!sourcePort || !targetPort) return [];
    return sourcePort.direction === "output" && targetPort.direction === "input" && sourcePort.kind === targetPort.kind ? [] : [edge.id];
  });

  const unconnectedRequired = nodes.flatMap((node) => {
    const definition = definitions.get(node.data.componentType);
    return (definition?.ports ?? []).filter((port) => {
      if (!port.required) return false;
      return port.direction === "input"
        ? !edges.some((edge) => edge.target === node.id && edge.targetHandle === port.id)
        : !edges.some((edge) => edge.source === node.id && edge.sourceHandle === port.id);
    }).map((port) => `${node.id}:${port.id}`);
  });

  const sensors = ["gps", "compass", "rangefinder", "airspeed-sensor", "optical-flow"]
    .flatMap((type) => nodesOf(nodes, type));
  const unlinkedSensors = sensors.filter((sensor) => !edges.some((edge) => connectedToController(edge, nodesById, sensor.data.componentType)));
  const harnesses = nodesOf(nodes, "wiring-harness");
  const wiringDocumented = edges.length > 0 || harnesses.length > 0;

  return [
    makeCheck("wiring-buses", "compatible-edges", incompatibleEdgeIds.length === 0, incompatibleEdgeIds.length ? `${incompatibleEdgeIds.length} connection(s) have incompatible endpoints.` : "All explicit endpoints are directionally and electrically compatible."),
    makeCheck("wiring-buses", "required-ports", nodes.length > 0 && unconnectedRequired.length === 0, unconnectedRequired.length ? `${unconnectedRequired.length} required port(s) are open.` : nodes.length ? "All required ports are connected." : "Add components before assessing required ports."),
    makeCheck("wiring-buses", "essential-buses", sensors.length > 0 && unlinkedSensors.length === 0, sensors.length === 0 ? "Add a navigation sensor." : unlinkedSensors.length ? `${unlinkedSensors.length} navigation sensor(s) lack a controller data path.` : "Every installed navigation sensor has a controller data path.", sensors.map(({ id }) => id)),
    makeCheck("wiring-buses", "harness-defined", wiringDocumented, wiringDocumented ? `${edges.length} explicit connection(s)${harnesses.length ? " plus harness data" : ""} document the wiring.` : "Draw connections or add a wiring harness.", harnesses.map(({ id }) => id))
  ];
}

function mechanicalChecks(nodes: readonly DesignNode[], edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>, settings: SimulationSettings) {
  const frames = nodesOf(nodes, "frame");
  const motors = nodesOf(nodes, "motor");
  const unmountedMotors = motors.filter((motor) => !edges.some((edge) => edge.target === motor.id && edge.targetHandle === "mount-in" && nodesById.get(edge.source)?.data.componentType === "frame"));
  const payloads = ["camera", "gimbal", "payload-mount", "parachute"].flatMap((type) => nodesOf(nodes, type));
  const unmountedPayloads = payloads.filter((payload) => {
    if (payload.data.componentType === "payload-mount") return edges.some((edge) => edge.target === payload.id && edge.targetHandle === "mount-in") === false;
    return !edges.some((edge) => edge.target === payload.id && edge.targetHandle === "mount-in");
  });
  const landingGear = nodesOf(nodes, "landing-gear");
  const hasLandingProvision = settings.vehicle === "Rover" || landingGear.length > 0 || frames.some((frame) => propertyNumber(frame, "wheelbaseMm") > 0);

  return [
    makeCheck("mechanical-mounting", "airframe", frames.length > 0 && frames.every((frame) => propertyNumber(frame, "wheelbaseMm") > 0 && propertyNumber(frame, "massKg") > 0), frames.length ? "Airframe dimensions and dry mass are defined." : "Add an airframe.", frames.map(({ id }) => id)),
    makeCheck("mechanical-mounting", "propulsion-mounts", motors.length === 0 ? settings.vehicle === "Rover" : unmountedMotors.length === 0, unmountedMotors.length ? `${unmountedMotors.length} motor(s) lack an airframe mount.` : "All installed motors have airframe mounts.", motors.map(({ id }) => id)),
    makeCheck("mechanical-mounting", "payload-mounts", unmountedPayloads.length === 0, unmountedPayloads.length ? `${unmountedPayloads.length} payload/recovery item(s) lack a mount.` : payloads.length ? "All installed payloads have mounting paths." : "No discrete payload mounting is required.", payloads.map(({ id }) => id)),
    makeCheck("mechanical-mounting", "landing-provision", hasLandingProvision, hasLandingProvision ? landingGear.length ? "Discrete landing gear is installed." : "The airframe defines an integrated landing footprint." : "Add landing gear or define the frame landing footprint.", [...frames, ...landingGear].map(({ id }) => id))
  ];
}

function propulsionChecks(nodes: readonly DesignNode[], edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>, settings: SimulationSettings) {
  const motors = nodesOf(nodes, "motor");
  const escs = nodesOf(nodes, "esc");
  const expected = expectedMotorCount(settings);
  const undriven = motors.filter((motor) => !edges.some((edge) => edge.target === motor.id && edge.targetHandle === "power-in" && nodesById.get(edge.source)?.data.componentType === "esc"));
  const uncommanded = escs.filter((esc) => !edges.some((edge) => edge.target === esc.id && edge.targetHandle === "pwm-in" && nodesById.get(edge.source)?.data.componentType === "flight-controller"));
  const ratingsValid = motors.every((motor) => propertyNumber(motor, "thrustGrams") > 0) && escs.every((esc) => propertyNumber(esc, "maxAmps") > 0);

  return [
    makeCheck("propulsion", "propulsor-count", motors.length === expected && escs.length === expected, `Frame expects ${expected}; design has ${motors.length} motor(s) and ${escs.length} ESC(s).`, [...motors, ...escs].map(({ id }) => id)),
    makeCheck("propulsion", "motor-drive", motors.length === expected && undriven.length === 0, undriven.length ? `${undriven.length} motor(s) lack an ESC drive.` : "Every expected motor is driven by an ESC.", motors.map(({ id }) => id)),
    makeCheck("propulsion", "esc-command", escs.length === expected && uncommanded.length === 0, uncommanded.length ? `${uncommanded.length} ESC(s) lack a controller command.` : "Every expected ESC has a controller command.", escs.map(({ id }) => id)),
    makeCheck("propulsion", "propulsion-ratings", motors.length === expected && escs.length === expected && ratingsValid, ratingsValid ? "Installed motor thrust and ESC current ratings are positive." : "Complete motor thrust and ESC current ratings.", [...motors, ...escs].map(({ id }) => id))
  ];
}

function avionicsChecks(nodes: readonly DesignNode[], edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>, settings: SimulationSettings) {
  const controllers = nodesOf(nodes, "flight-controller");
  const gps = nodesOf(nodes, "gps");
  const flow = nodesOf(nodes, "optical-flow");
  const rangefinders = nodesOf(nodes, "rangefinder");
  const sensors = ["gps", "compass", "rangefinder", "airspeed-sensor", "optical-flow"].flatMap((type) => nodesOf(nodes, type));
  const unlinked = sensors.filter((sensor) => !edges.some((edge) => connectedToController(edge, nodesById, sensor.data.componentType)));
  const scenarioReady = settings.testScenario !== "gps-denied" || (flow.length > 0 && rangefinders.length > 0);

  return [
    makeCheck("avionics-sensors", "flight-controller", controllers.length > 0, controllers.length ? `${controllers.length} flight controller(s) installed.` : "Add an ArduPilot flight controller.", controllers.map(({ id }) => id)),
    makeCheck("avionics-sensors", "navigation-source", gps.length + flow.length > 0, gps.length + flow.length ? "A global or local position source is installed." : "Add GPS or optical flow.", [...gps, ...flow].map(({ id }) => id)),
    makeCheck("avionics-sensors", "sensor-links", sensors.length > 0 && unlinked.length === 0, sensors.length === 0 ? "Add and connect navigation sensors." : unlinked.length ? `${unlinked.length} installed sensor(s) are not connected to the controller.` : "All installed navigation sensors are connected.", sensors.map(({ id }) => id)),
    makeCheck("avionics-sensors", "scenario-sensors", scenarioReady, scenarioReady ? `Sensor coverage supports the ${settings.testScenario} scenario.` : "GPS-denied testing requires optical flow and a rangefinder.", [...flow, ...rangefinders].map(({ id }) => id))
  ];
}

function communicationsChecks(nodes: readonly DesignNode[], edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>) {
  const links = ["telemetry-radio", "rc-receiver"].flatMap((type) => nodesOf(nodes, type));
  const unlinked = links.filter((link) => !edges.some((edge) => connectedToController(edge, nodesById, link.data.componentType)));
  const traffic = nodesOf(nodes, "adsb-remote-id");
  const trafficUnlinked = traffic.filter((item) => !edges.some((edge) => connectedToController(edge, nodesById, item.data.componentType)));

  return [
    makeCheck("communications", "control-link", links.length > 0, links.length ? `${links.length} operator link(s) installed.` : "Add telemetry or an RC receiver.", links.map(({ id }) => id)),
    makeCheck("communications", "control-link-wired", links.length > 0 && unlinked.length === 0, unlinked.length ? `${unlinked.length} operator link(s) are not connected.` : links.length ? "All operator links connect to the controller." : "Install and wire an operator link.", links.map(({ id }) => id)),
    makeCheck("communications", "traffic-link", trafficUnlinked.length === 0, trafficUnlinked.length ? `${trafficUnlinked.length} traffic/broadcast module(s) are not connected.` : traffic.length ? "All traffic/broadcast modules are integrated." : "No traffic/broadcast module is installed; check local requirements.", traffic.map(({ id }) => id))
  ];
}

function safetyChecks(nodes: readonly DesignNode[], edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>, settings: SimulationSettings) {
  const low = Number(settings.batteryLowPercent);
  const critical = Number(settings.batteryCriticalPercent);
  const failsafeValid = Number.isFinite(low) && Number.isFinite(critical) && critical > 0 && low > critical && low <= 100 && Boolean(settings.batteryFailsafeAction) && Boolean(settings.batteryCriticalAction);
  const protection = [...nodesOf(nodes, "fuse"), ...nodesOf(nodes, "power-distribution-board").filter((node) => node.data.properties.protectedOutputs === true)];
  const alerts = nodesOf(nodes, "buzzer");
  const safetyOutputs = [...alerts, ...nodesOf(nodes, "parachute")];
  const unlinkedOutputs = safetyOutputs.filter((output) => !edges.some((edge) => edge.target === output.id && (edge.targetHandle === "pwm-in" || edge.targetHandle === "trigger-in") && nodesById.get(edge.source)?.data.componentType === "flight-controller"));

  return [
    makeCheck("safety", "battery-failsafe", failsafeValid, failsafeValid ? `Low ${low}% and critical ${critical}% thresholds are ordered and actions are set.` : "Set a critical threshold below the low threshold and choose both actions."),
    makeCheck("safety", "overcurrent-protection", protection.length > 0, protection.length ? `${protection.length} overcurrent protection device(s) identified.` : "Add a fuse or protected distribution board.", protection.map(({ id }) => id)),
    makeCheck("safety", "local-alert", alerts.length > 0, alerts.length ? "A local buzzer/status indicator is installed." : "Add a buzzer or status indicator.", alerts.map(({ id }) => id)),
    makeCheck("safety", "recovery-output", unlinkedOutputs.length === 0, unlinkedOutputs.length ? `${unlinkedOutputs.length} installed safety output(s) lack a controller trigger.` : safetyOutputs.length ? "All installed safety outputs have controller triggers." : "No discrete safety output requires a trigger.", safetyOutputs.map(({ id }) => id))
  ];
}

/** Performs a deterministic, read-only multidisciplinary acceptance review of a design graph. */
export function assessEngineeringDomains(
  nodes: readonly DesignNode[],
  edges: readonly DesignEdge[],
  settings: SimulationSettings
): EngineeringDomainAssessment[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const checksByDomain: Record<EngineeringDomainId, EngineeringAcceptanceCheck[]> = {
    "electrical-power": electricalChecks(nodes, edges, nodesById),
    "wiring-buses": wiringChecks(nodes, edges, nodesById),
    "mechanical-mounting": mechanicalChecks(nodes, edges, nodesById, settings),
    propulsion: propulsionChecks(nodes, edges, nodesById, settings),
    "avionics-sensors": avionicsChecks(nodes, edges, nodesById, settings),
    communications: communicationsChecks(nodes, edges, nodesById),
    safety: safetyChecks(nodes, edges, nodesById, settings)
  };

  return engineeringDomains.map((domain) => {
    const checks = checksByDomain[domain.id];
    const completed = checks.filter((check) => check.passed).length;
    return {
      ...domain,
      checks,
      completed,
      total: checks.length,
      progress: progressForEngineeringChecks(checks),
      status: statusForEngineeringChecks(checks)
    };
  });
}

export function summarizeEngineeringAssessments(
  assessments: readonly EngineeringDomainAssessment[]
): EngineeringAssessmentSummary {
  const checks = assessments.flatMap((assessment) => assessment.checks);
  const completed = checks.filter((check) => check.passed).length;
  return {
    completed,
    total: checks.length,
    progress: progressForEngineeringChecks(checks),
    status: statusForEngineeringChecks(checks),
    domainsNeedingAttention: assessments
      .filter((assessment) => assessment.status === "needs-attention")
      .map((assessment) => assessment.id)
  };
}
