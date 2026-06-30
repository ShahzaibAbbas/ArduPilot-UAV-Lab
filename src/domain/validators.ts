import type { DesignEdge, DesignNode, SimulationSettings } from "./design";
import { getPort } from "./componentCatalog";

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
  if (settings.vehicle === "Rover") {
    return 0;
  }
  if (settings.vehicle === "ArduPlane" && !settings.frame.includes("quadplane")) {
    return 1;
  }
  if (settings.frame.includes("octa")) {
    return 8;
  }
  if (settings.frame.includes("hexa")) {
    return 6;
  }
  if (settings.frame.includes("tri")) {
    return 3;
  }
  return 4;
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
  }

  const flightControllers = nodesOf(nodes, "flight-controller");
  const frames = nodesOf(nodes, "frame");
  const batteries = nodesOf(nodes, "battery");
  const powerModules = nodesOf(nodes, "power-module");
  const motors = nodesOf(nodes, "motor");
  const escs = nodesOf(nodes, "esc");
  const gps = nodesOf(nodes, "gps");
  const compass = nodesOf(nodes, "compass");

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

  if (batteries.length > 0 && powerModules.length > 0 && !hasConnection(edges, nodes, "battery", "power-module", "power-in")) {
    issues.push({
      id: "battery-not-wired",
      severity: "error",
      title: "Battery not wired",
      message: "Connect the battery power output to the power module power input.",
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
  if (motors.length < requiredMotors) {
    issues.push({
      id: "motor-count",
      severity: "error",
      title: "Motor count too low",
      message: `${settings.frame} expects at least ${requiredMotors} motor${requiredMotors === 1 ? "" : "s"}.`,
      nodeIds: motors.map((motor) => motor.id)
    });
  }

  if (requiredMotors > 0 && escs.length < motors.length) {
    issues.push({
      id: "esc-count",
      severity: "warning",
      title: "ESC count lower than motors",
      message: "Each brushless motor should have a matching ESC."
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

  const counts = {
    error: issues.filter((issue) => issue.severity === "error").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length
  };

  const score = Math.max(0, 100 - counts.error * 25 - counts.warning * 8 - counts.info * 2);

  return { issues, score, counts };
}
