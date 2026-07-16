import type { DesignEdge, DesignNode, SignalKind, SimulationSettings } from "./design";
import { getPort } from "./componentCatalog";
import { airframeLabel, rotorCountForFrame } from "./airframes";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  title: string;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
}

export interface ValidationResult {
  issues: ValidationIssue[];
  score: number;
  counts: Record<ValidationSeverity, number>;
}

export function expectedMotorCount(settings: SimulationSettings): number {
  const frame = settings.frame.toLowerCase();
  if (settings.vehicle === "Rover") {
    return 0;
  }
  if (settings.vehicle === "ArduPlane" && !frame.includes("quadplane")) {
    return 1;
  }
  return rotorCountForFrame(frame);
}

function nodesOf(nodes: DesignNode[], type: string) {
  return nodes.filter((node) => node.data.componentType === type);
}

function hasIncoming(edges: DesignEdge[], target: string, handle?: string, sourceType?: string, nodes?: DesignNode[]) {
  return edges.some((edge) => {
    if (edge.target !== target) {
      return false;
    }
    if (handle && edge.targetHandle !== handle) {
      return false;
    }
    if (!sourceType || !nodes) {
      return true;
    }
    return nodes.find((node) => node.id === edge.source)?.data.componentType === sourceType;
  });
}

function hasConnection(
  edges: DesignEdge[],
  nodes: DesignNode[],
  sourceType: string,
  targetType: string,
  targetHandle?: string
) {
  return edges.some((edge) => {
    const source = nodes.find((node) => node.id === edge.source);
    const target = nodes.find((node) => node.id === edge.target);
    return (
      source?.data.componentType === sourceType &&
      target?.data.componentType === targetType &&
      (!targetHandle || edge.targetHandle === targetHandle)
    );
  });
}

function hasSignalPath(
  edges: DesignEdge[],
  nodes: DesignNode[],
  sourceType: string,
  targetType: string,
  signal: SignalKind
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const reached = new Set(nodes.filter((node) => node.data.componentType === sourceType).map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (!reached.has(edge.source) || reached.has(edge.target)) continue;
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) continue;
      const sourcePort = getPort(source.data.componentType, edge.sourceHandle);
      const targetPort = getPort(target.data.componentType, edge.targetHandle);
      if (sourcePort?.kind === signal && targetPort?.kind === signal) {
        reached.add(edge.target);
        changed = true;
      }
    }
  }
  return nodes.some((node) => node.data.componentType === targetType && reached.has(node.id));
}

export function componentCompatibilityMessage(
  sourceType: string,
  targetType: string,
  sourceHandle?: string | null,
  targetHandle?: string | null
) {
  if (targetType === "motor" && targetHandle === "power-in" && sourceType !== "esc") {
    return "Motors must be driven from an ESC power output.";
  }

  if (sourceType === "esc" && sourceHandle === "power-out" && targetType !== "motor") {
    return "ESC power output can only drive a motor.";
  }

  if (targetType === "motor" && targetHandle === "mount-in" && sourceType !== "frame") {
    return "Motors must mount to the selected airframe.";
  }

  if (targetType === "esc" && targetHandle === "pwm-in" && sourceType !== "flight-controller") {
    return "ESC signal input must come from the flight controller PWM output.";
  }

  if (
    targetType === "esc" &&
    targetHandle === "power-in" &&
    sourceType !== "battery" &&
    sourceType !== "power-module" &&
    sourceType !== "power-distribution-board" &&
    sourceType !== "fuse" &&
    sourceType !== "wiring-harness"
  ) {
    return "ESC power input must come from a battery, protected distribution device, or rated harness.";
  }

  return undefined;
}

function incompatibleConnectionMessage(source: DesignNode, target: DesignNode, edge: DesignEdge) {
  return componentCompatibilityMessage(source.data.componentType, target.data.componentType, edge.sourceHandle, edge.targetHandle);
}

export function validateDesign(
  nodes: DesignNode[],
  edges: DesignEdge[],
  settings: SimulationSettings
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);

    if (!source || !target) {
      issues.push({
        id: `edge-${edge.id}-missing-node`,
        severity: "error",
        title: "Broken connection",
        message: "A connection references a component that no longer exists.",
        edgeIds: [edge.id]
      });
      continue;
    }

    const sourcePort = getPort(source.data.componentType, edge.sourceHandle);
    const targetPort = getPort(target.data.componentType, edge.targetHandle);

    if (!sourcePort || !targetPort) {
      issues.push({
        id: `edge-${edge.id}-missing-port`,
        severity: "error",
        title: "Unknown port",
        message: `${source.data.label} to ${target.data.label} uses a port that is not defined.`,
        nodeIds: [source.id, target.id],
        edgeIds: [edge.id]
      });
      continue;
    }

    if (sourcePort.direction !== "output" || targetPort.direction !== "input") {
      issues.push({
        id: `edge-${edge.id}-direction`,
        severity: "error",
        title: "Invalid direction",
        message: `${sourcePort.label} must connect from an output port into an input port.`,
        nodeIds: [source.id, target.id],
        edgeIds: [edge.id]
      });
    }

    if (sourcePort.kind !== targetPort.kind) {
      issues.push({
        id: `edge-${edge.id}-signal`,
        severity: "error",
        title: "Signal mismatch",
        message: `${source.data.label} ${sourcePort.label} is ${sourcePort.kind}, but ${target.data.label} ${targetPort.label} is ${targetPort.kind}.`,
        nodeIds: [source.id, target.id],
        edgeIds: [edge.id]
      });
    }

    const incompatibleMessage = incompatibleConnectionMessage(source, target, edge);
    if (incompatibleMessage) {
      issues.push({
        id: `edge-${edge.id}-component-compatibility`,
        severity: "error",
        title: "Incompatible propulsion connection",
        message: incompatibleMessage,
        nodeIds: [source.id, target.id],
        edgeIds: [edge.id]
      });
    }
  }

  const flightControllers = nodesOf(nodes, "flight-controller");
  const frames = nodesOf(nodes, "frame");
  const batteries = nodesOf(nodes, "battery");
  const powerModules = nodesOf(nodes, "power-module");
  const motors = nodesOf(nodes, "motor");
  const escs = nodesOf(nodes, "esc");
  const gps = nodesOf(nodes, "gps");
  const compass = nodesOf(nodes, "compass");
  const rangefinders = nodesOf(nodes, "rangefinder");
  const airspeedSensors = nodesOf(nodes, "airspeed-sensor");
  const opticalFlowSensors = nodesOf(nodes, "optical-flow");
  const companionComputers = nodesOf(nodes, "companion-computer");
  const adsbRemoteId = nodesOf(nodes, "adsb-remote-id");
  const parachutes = nodesOf(nodes, "parachute");
  const buzzers = nodesOf(nodes, "buzzer");

  if (flightControllers.length === 0) {
    issues.push({
      id: "missing-fc",
      severity: "error",
      title: "Flight controller missing",
      message: "Add an ArduPilot flight controller as the central autopilot."
    });
  }

  if (frames.length === 0) {
    issues.push({
      id: "missing-frame",
      severity: "error",
      title: "Airframe missing",
      message: "Add an airframe so propulsion and payload components have a physical mount."
    });
  }

  if (batteries.length === 0) {
    issues.push({
      id: "missing-battery",
      severity: "error",
      title: "Battery missing",
      message: "Add a battery to power the design."
    });
  }

  if (powerModules.length === 0) {
    issues.push({
      id: "missing-power-module",
      severity: "warning",
      title: "Power module missing",
      message: "A power module gives ArduPilot voltage and current telemetry."
    });
  }

  if (settings.batteryCriticalPercent >= settings.batteryLowPercent) {
    issues.push({
      id: "battery-failsafe-threshold-order",
      severity: "error",
      title: "Battery thresholds reversed",
      message: "Critical battery percent must be lower than the low battery percent."
    });
  }

  if (settings.batteryFailsafeAction === "Warn" && settings.testScenario === "low-battery") {
    issues.push({
      id: "battery-failsafe-warn-only",
      severity: "warning",
      title: "Low battery action only warns",
      message: "The low-battery test scenario should use Land, RTL, or SmartRTL to exercise an automated failsafe response."
    });
  }

  if (batteries.length > 0 && powerModules.length > 0 && !hasSignalPath(edges, nodes, "battery", "power-module", "power")) {
    issues.push({
      id: "battery-not-wired",
      severity: "error",
      title: "Battery not wired",
      message: "Connect the battery to the power module through the fuse and distribution path.",
      nodeIds: [batteries[0].id, powerModules[0].id]
    });
  }

  if (
    powerModules.length > 0 &&
    flightControllers.length > 0 &&
    !hasConnection(edges, nodes, "power-module", "flight-controller", "power-in")
  ) {
    issues.push({
      id: "fc-power-missing",
      severity: "error",
      title: "Flight controller power missing",
      message: "Connect regulated power from the power module to the flight controller.",
      nodeIds: [powerModules[0].id, flightControllers[0].id]
    });
  }

  if (
    powerModules.length > 0 &&
    flightControllers.length > 0 &&
    !hasConnection(edges, nodes, "power-module", "flight-controller", "analog-in")
  ) {
    issues.push({
      id: "battery-telemetry-missing",
      severity: "warning",
      title: "Battery telemetry missing",
      message: "Connect power-module voltage/current telemetry to the flight controller ADC.",
      nodeIds: [powerModules[0].id, flightControllers[0].id]
    });
  }

  const requiredMotors = expectedMotorCount(settings);
  const airframeName = airframeLabel(settings.frame);
  if (motors.length < requiredMotors) {
    issues.push({
      id: "motor-count",
      severity: "error",
      title: "Motor count too low",
      message: `${airframeName} expects exactly ${requiredMotors} motor${requiredMotors === 1 ? "" : "s"}.`,
      nodeIds: motors.map((motor) => motor.id)
    });
  }

  if (motors.length > requiredMotors) {
    issues.push({
      id: "motor-count-too-high",
      severity: "error",
      title: "Too many motors",
      message: `${airframeName} allows no more than ${requiredMotors} motor${requiredMotors === 1 ? "" : "s"}.`,
      nodeIds: motors.slice(requiredMotors).map((motor) => motor.id)
    });
  }

  if (escs.length < requiredMotors) {
    issues.push({
      id: "esc-count-too-low",
      severity: "error",
      title: "ESC count too low",
      message: `${airframeName} expects exactly ${requiredMotors} ESC${requiredMotors === 1 ? "" : "s"}.`,
      nodeIds: escs.map((esc) => esc.id)
    });
  }

  if (escs.length > requiredMotors) {
    issues.push({
      id: "esc-count-too-high",
      severity: "error",
      title: "Too many ESCs",
      message: `${airframeName} allows no more than ${requiredMotors} ESC${requiredMotors === 1 ? "" : "s"}.`,
      nodeIds: escs.slice(requiredMotors).map((esc) => esc.id)
    });
  }

  if (requiredMotors > 0 && escs.length !== motors.length) {
    issues.push({
      id: "esc-motor-count-match",
      severity: "warning",
      title: "ESC and motor counts differ",
      message: "Each propulsion rotor should have one motor and one matching ESC.",
      nodeIds: [...escs, ...motors].map((node) => node.id)
    });
  }

  for (const esc of escs) {
    if (!hasIncoming(edges, esc.id, "pwm-in", "flight-controller", nodes)) {
      issues.push({
        id: `esc-${esc.id}-pwm`,
        severity: "error",
        title: "ESC signal missing",
        message: `${esc.data.label} needs a PWM signal from the flight controller.`,
        nodeIds: [esc.id]
      });
    }
    if (!hasIncoming(edges, esc.id, "power-in")) {
      issues.push({
        id: `esc-${esc.id}-power`,
        severity: "warning",
        title: "ESC power missing",
        message: `${esc.data.label} needs main battery power.`,
        nodeIds: [esc.id]
      });
    }
  }

  for (const motor of motors) {
    if (!hasIncoming(edges, motor.id, "power-in", "esc", nodes)) {
      issues.push({
        id: `motor-${motor.id}-esc`,
        severity: "error",
        title: "Motor not driven",
        message: `${motor.data.label} needs power from an ESC output.`,
        nodeIds: [motor.id]
      });
    }
    if (!hasIncoming(edges, motor.id, "mount-in", "frame", nodes)) {
      issues.push({
        id: `motor-${motor.id}-mount`,
        severity: "warning",
        title: "Motor not mounted",
        message: `${motor.data.label} should be mounted to the airframe.`,
        nodeIds: [motor.id]
      });
    }
  }

  if (gps.length === 0) {
    issues.push({
      id: "gps-missing",
      severity: "warning",
      title: "GPS missing",
      message: "Most autonomous ArduPilot missions need a GPS source."
    });
  } else if (flightControllers.length > 0 && !hasConnection(edges, nodes, "gps", "flight-controller", "uart-in")) {
    issues.push({
      id: "gps-not-wired",
      severity: "warning",
      title: "GPS not wired",
      message: "Connect GPS UART output to the flight controller UART input.",
      nodeIds: [gps[0].id, flightControllers[0].id]
    });
  }

  if (compass.length === 0 && settings.vehicle !== "Rover") {
    issues.push({
      id: "compass-missing",
      severity: "info",
      title: "Compass optional",
      message: "Add an external compass when heading quality matters."
    });
  }

  if (settings.vehicle === "ArduPlane" && airspeedSensors.length === 0) {
    issues.push({
      id: "airspeed-missing-plane",
      severity: Number(settings.windSpeedMps) > 6 || Number(settings.windGustMps) > 10 ? "warning" : "info",
      title: "Airspeed sensor recommended",
      message: "Fixed-wing and VTOL designs should include an airspeed sensor for wind-aware speed control and stall margin."
    });
  }

  if (settings.testScenario === "gps-denied") {
    if (opticalFlowSensors.length === 0) {
      issues.push({
        id: "gps-denied-flow-missing",
        severity: "warning",
        title: "GPS-denied sensor missing",
        message: "Add optical flow for the GPS-denied scenario so horizontal motion can still be estimated."
      });
    }
    if (rangefinders.length === 0) {
      issues.push({
        id: "gps-denied-rangefinder-missing",
        severity: "warning",
        title: "Rangefinder missing",
        message: "Optical-flow hold normally needs a range source for height above ground."
      });
    }
  }

  if (settings.testScenario === "sensor-failure" && gps.length + compass.length + rangefinders.length + airspeedSensors.length < 2) {
    issues.push({
      id: "sensor-failure-redundancy",
      severity: "warning",
      title: "Sensor redundancy low",
      message: "Add at least two navigation or environment sensors before rehearsing sensor-failure scenarios."
    });
  }

  for (const flow of opticalFlowSensors) {
    if (flow.data.properties.requiresRangefinder !== false && rangefinders.length === 0) {
      issues.push({
        id: `flow-${flow.id}-rangefinder`,
        severity: "warning",
        title: "Optical flow needs range",
        message: `${flow.data.label} is configured to require a rangefinder.`,
        nodeIds: [flow.id]
      });
    }
    if (!hasIncoming(edges, flow.id, "mount-in", "frame", nodes)) {
      issues.push({
        id: `flow-${flow.id}-mount`,
        severity: "info",
        title: "Optical flow not mounted",
        message: `${flow.data.label} should be mounted to the airframe with a clear downward view.`,
        nodeIds: [flow.id]
      });
    }
  }

  for (const parachute of parachutes) {
    if (!hasIncoming(edges, parachute.id, "pwm-in", "flight-controller", nodes)) {
      issues.push({
        id: `parachute-${parachute.id}-trigger`,
        severity: "warning",
        title: "Parachute trigger missing",
        message: `${parachute.data.label} needs a flight-controller AUX/PWM trigger connection.`,
        nodeIds: [parachute.id]
      });
    }
  }

  for (const buzzer of buzzers) {
    if (!hasIncoming(edges, buzzer.id, "pwm-in", "flight-controller", nodes)) {
      issues.push({
        id: `buzzer-${buzzer.id}-trigger`,
        severity: "info",
        title: "Status output not wired",
        message: `${buzzer.data.label} can be connected to an AUX output for local failsafe alerts.`,
        nodeIds: [buzzer.id]
      });
    }
  }

  if (companionComputers.length > 0 && !hasConnection(edges, nodes, "flight-controller", "companion-computer", "uart-in")) {
    issues.push({
      id: "companion-link-missing",
      severity: "info",
      title: "Companion MAVLink link missing",
      message: "Connect the flight-controller UART output to the companion computer UART input for onboard autonomy."
    });
  }

  if (adsbRemoteId.length > 0 && !hasConnection(edges, nodes, "adsb-remote-id", "flight-controller")) {
    issues.push({
      id: "traffic-module-link-missing",
      severity: "info",
      title: "Traffic module not wired",
      message: "Connect ADSB or Remote ID modules to the flight controller by UART or CAN."
    });
  }

  const counts = {
    error: issues.filter((issue) => issue.severity === "error").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length
  };

  const score = Math.max(0, 100 - counts.error * 25 - counts.warning * 8 - counts.info * 2);

  return { issues, score, counts };
}
