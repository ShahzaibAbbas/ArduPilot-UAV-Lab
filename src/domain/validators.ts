import type { DesignEdge, DesignNode, SignalKind, SimulationSettings } from "./design";
import { componentCatalog, getPort } from "./componentCatalog";
import { airframeLabel, propulsionMotorCountForFrame } from "./airframes";
import { batteryMetrics } from "../../server/batteryModel.js";

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  title: string;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
  portIds?: { nodeId: string; portId: string }[];
}

export interface ValidationResult {
  issues: ValidationIssue[];
  score: number;
  counts: Record<ValidationSeverity, number>;
}

/** Compare each pack only with hardware on its own valid power path. */
export function batteryHardwareIssues(nodes: readonly DesignNode[], edges: readonly DesignEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const battery of nodes.filter((node) => node.data.componentType === "battery")) {
    const metrics = batteryMetrics(battery.data.properties);
    const reached = new Set([battery.id]);
    const queue = [battery.id];
    while (queue.length) {
      const sourceId = queue.shift()!;
      for (const edge of edges) {
        if (edge.source !== sourceId || reached.has(edge.target)) continue;
        const source = byId.get(edge.source);
        const target = byId.get(edge.target);
        if (!source || !target || getPort(source.data.componentType, edge.sourceHandle)?.kind !== "power" || getPort(target.data.componentType, edge.targetHandle)?.kind !== "power") continue;
        reached.add(target.id);
        queue.push(target.id);
      }
    }
    const supplied = nodes.filter((node) => reached.has(node.id));
    for (const device of supplied) {
      const type = device.data.componentType;
      const maxCells = Number(device.data.properties[type === "power-module" ? "inputCellsMax" : "maxCells"] ?? 0);
      if ((type === "power-module" || type === "esc") && maxCells > 0 && metrics.seriesCells > maxCells) {
        issues.push({
          id: `battery-${battery.id}-${device.id}-${type === "power-module" ? "voltage" : "cells"}`,
          severity: "error", title: type === "power-module" ? "Power module voltage exceeded" : "ESC battery voltage exceeded",
          message: `${device.data.label} is rated to ${maxCells}S but ${battery.data.label} is ${metrics.seriesCells}S (${metrics.fullVoltageV.toFixed(1)} V full).`,
          nodeIds: [battery.id, device.id]
        });
      }
      const voltageRating = Number(device.data.properties.voltageRating ?? 0);
      if (type === "fuse" && voltageRating > 0 && metrics.fullVoltageV > voltageRating) {
        issues.push({ id: `battery-${battery.id}-${device.id}-voltage`, severity: "error", title: "Protection voltage exceeded", message: `${battery.data.label} reaches ${metrics.fullVoltageV.toFixed(1)} V full, above ${device.data.label}'s ${voltageRating} V rating.`, nodeIds: [battery.id, device.id] });
      }
    }
    const escs = supplied.filter((node) => node.data.componentType === "esc");
    const explicitEscCurrent = escs.reduce((sum, esc) => {
      const rating = Number(esc.data.properties.maxAmps ?? 0);
      return sum + (Number.isFinite(rating) ? Math.max(0, rating) : 0);
    }, 0);
    if (metrics.continuousCurrentA > 0 && explicitEscCurrent > metrics.continuousCurrentA * 1.1) {
      issues.push({ id: `battery-${battery.id}-propulsion-current`, severity: "warning", title: "Battery current margin is low", message: `${battery.data.label} is rated ${metrics.continuousCurrentA.toFixed(1)} A continuous while connected ESCs total ${explicitEscCurrent.toFixed(1)} A. Check measured propulsion current, duty cycle, wiring, and thermal margin.`, nodeIds: [battery.id, ...escs.map((esc) => esc.id)] });
    }
  }
  return issues;
}

export function expectedMotorCount(settings: SimulationSettings): number {
  return propulsionMotorCountForFrame(settings.frame);
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

function compatibleDesignConnections(nodes: readonly DesignNode[], edges: readonly DesignEdge[]): DesignEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.filter((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target || source.id === target.id) return false;
    const sourcePort = getPort(source.data.componentType, edge.sourceHandle);
    const targetPort = getPort(target.data.componentType, edge.targetHandle);
    return sourcePort?.direction === "output" && targetPort?.direction === "input" &&
      sourcePort.kind === targetPort.kind && !incompatibleConnectionMessage(source, target, edge);
  });
}

function conflictsForConnections(nodes: readonly DesignNode[], edges: readonly DesignEdge[]): ValidationIssue[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inputs = new Map<string, DesignEdge[]>();
  const escOutputs = new Map<string, DesignEdge[]>();
  for (const edge of edges) {
    const target = byId.get(edge.target)!;
    const port = getPort(target.data.componentType, edge.targetHandle)!;
    // I2C/CAN are shared buses; the controller UART handle groups its serial ports.
    const sharedBus = ["i2c", "can"].includes(port.kind) ||
      target.data.componentType === "flight-controller" && port.kind === "uart";
    if (!sharedBus) {
      const key = JSON.stringify([edge.target, edge.targetHandle]);
      const connections = inputs.get(key) ?? [];
      connections.push(edge);
      inputs.set(key, connections);
    }
    if (byId.get(edge.source)?.data.componentType === "esc" && edge.sourceHandle === "power-out") {
      const connections = escOutputs.get(edge.source) ?? [];
      connections.push(edge);
      escOutputs.set(edge.source, connections);
    }
  }

  const issues: ValidationIssue[] = [];
  for (const connections of inputs.values()) {
    const sources = new Set(connections.map((edge) => JSON.stringify([edge.source, edge.sourceHandle])));
    if (sources.size <= 1) continue;
    const { target, targetHandle } = connections[0];
    issues.push({
      id: `input-${target}-${targetHandle}-conflict`, severity: "error", title: "Competing input connections",
      message: `${byId.get(target)!.data.label} (${targetHandle}) has multiple sources. Keep one compatible feed for this input.`,
      nodeIds: [...new Set([...connections.map((edge) => edge.source), target])],
      edgeIds: connections.map((edge) => edge.id), portIds: [{ nodeId: target, portId: targetHandle! }]
    });
  }
  for (const [source, connections] of escOutputs) {
    if (new Set(connections.map((edge) => edge.target)).size <= 1) continue;
    issues.push({
      id: `esc-${source}-multiple-motors`, severity: "error", title: "ESC drives multiple motors",
      message: `${byId.get(source)!.data.label} must drive exactly one motor. Give each motor its own ESC.`,
      nodeIds: [source, ...new Set(connections.map((edge) => edge.target))],
      edgeIds: connections.map((edge) => edge.id)
    });
  }
  return issues;
}

/** Finds graph-level conflicts between otherwise compatible connections. */
export function connectionConflictIssues(nodes: readonly DesignNode[], edges: readonly DesignEdge[]): ValidationIssue[] {
  return conflictsForConnections(nodes, compatibleDesignConnections(nodes, edges));
}

/** Only compatible, unambiguous connections can satisfy wiring and acceptance requirements. */
export function validDesignConnections(nodes: readonly DesignNode[], edges: readonly DesignEdge[]): DesignEdge[] {
  const connections = compatibleDesignConnections(nodes, edges);
  const conflicted = new Set(conflictsForConnections(nodes, connections).flatMap((issue) => issue.edgeIds ?? []));
  return connections.filter((edge) => !conflicted.has(edge.id));
}

export function unconnectedRequiredPorts(nodes: readonly DesignNode[], edges: readonly DesignEdge[]) {
  const connections = validDesignConnections(nodes, edges);
  return nodes.flatMap((node) => {
    const ports = componentCatalog.find((definition) => definition.type === node.data.componentType)?.ports ?? [];
    return ports.filter((port) => port.required && !connections.some((edge) => port.direction === "input"
      ? edge.target === node.id && edge.targetHandle === port.id
      : edge.source === node.id && edge.sourceHandle === port.id
    )).map((port) => ({ node, port }));
  });
}

/** Follows a device's data cable, including a documented harness, to a controller. */
export function componentHasControllerDataPath(node: DesignNode, edges: readonly DesignEdge[], nodesById: ReadonlyMap<string, DesignNode>) {
  const dataKinds: SignalKind[] = ["uart", "i2c", "can", "analog", "telemetry"];
  for (const kind of dataKinds) {
    const reached = new Set([node.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        if (!source || !target) continue;
        const sourcePort = getPort(source.data.componentType, edge.sourceHandle);
        const targetPort = getPort(target.data.componentType, edge.targetHandle);
        if (sourcePort?.kind !== kind || targetPort?.kind !== kind ||
          sourcePort.direction !== "output" || targetPort.direction !== "input" ||
          incompatibleConnectionMessage(source, target, edge)) continue;
        const nextId = reached.has(edge.source) ? edge.target : reached.has(edge.target) ? edge.source : undefined;
        if (!nextId || reached.has(nextId)) continue;
        const next = nodesById.get(nextId);
        if (next?.data.componentType === "flight-controller") return true;
        if (next?.data.componentType === "wiring-harness") {
          reached.add(nextId);
          changed = true;
        }
      }
    }
  }
  return false;
}

export function validateDesign(
  nodes: DesignNode[],
  edges: DesignEdge[],
  settings: SimulationSettings
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (!componentCatalog.some((definition) => definition.type === node.data.componentType)) {
      issues.push({
        id: `node-${node.id}-unknown-component`, severity: "error", title: "Unknown component",
        message: `${node.data.label} uses the unsupported component type ${node.data.componentType}. Replace it with a catalog component.`,
        nodeIds: [node.id]
      });
    }
  }

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

    if (source.id === target.id) {
      issues.push({
        id: `edge-${edge.id}-self`, severity: "error", title: "Component wired to itself",
        message: `${source.data.label} cannot supply its own input. Connect it to another component.`,
        nodeIds: [source.id], edgeIds: [edge.id]
      });
    }

    if (!sourcePort || !targetPort) {
      issues.push({
        id: `edge-${edge.id}-missing-port`,
        severity: "error",
        title: "Unknown port",
        message: `${source.data.label} (${edge.sourceHandle ?? "no source port"}) to ${target.data.label} (${edge.targetHandle ?? "no target port"}) uses a port that is not defined.`,
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

  issues.push(...connectionConflictIssues(nodes, edges));
  // Keep invalid wires visible above, but never count them as a repaired path.
  edges = validDesignConnections(nodes, edges);
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

  for (const battery of batteries) {
    for (const issue of batteryMetrics(battery.data.properties).issues) {
      issues.push({
        id: `battery-${battery.id}-${issue.key}`,
        severity: issue.severity,
        title: issue.severity === "error" ? "Battery specification invalid" : "Battery specification review",
        message: `${battery.data.label}: ${issue.message}`,
        nodeIds: [battery.id]
      });
    }
  }

  // Catch the common integration errors that graph topology alone cannot see.
  issues.push(...batteryHardwareIssues(nodes, edges));

  if (powerModules.length === 0) {
    issues.push({
      id: "missing-power-module",
      severity: "warning",
      title: "Power module missing",
      message: "A power module gives ArduPilot voltage and current telemetry."
    });
  }

  const lowPercent = Number(settings.batteryLowPercent);
  const criticalPercent = Number(settings.batteryCriticalPercent);
  if (!Number.isFinite(lowPercent) || !Number.isFinite(criticalPercent) || criticalPercent <= 0 || lowPercent > 100 || lowPercent <= criticalPercent) {
    issues.push({
      id: "battery-failsafe-threshold-order",
      severity: "error",
      title: "Battery thresholds invalid",
      message: "Battery reserve thresholds must be finite numbers with 0 < critical < low ≤ 100%."
    });
  }

  const lowActions = settings.vehicle === "Rover" ? ["Warn", "RTL", "Hold", "SmartRTL"] : settings.vehicle === "ArduPlane" ? ["Warn", "RTL", "Land"] : ["Warn", "Land", "RTL", "SmartRTL"];
  const criticalActions = settings.vehicle === "Rover" ? ["RTL", "Hold", "SmartRTL", "Terminate"] : settings.vehicle === "ArduPlane" ? ["RTL", "Land", "Terminate"] : ["Land", "RTL", "SmartRTL", "Terminate"];
  if (!lowActions.includes(settings.batteryFailsafeAction)) {
    issues.push({ id: "battery-low-action-unsupported", severity: "error", title: "Low battery action unsupported", message: `${settings.vehicle} does not support ${settings.batteryFailsafeAction} as a low-battery action.`, nodeIds: [] });
  }
  if (!criticalActions.includes(settings.batteryCriticalAction)) {
    issues.push({ id: "battery-critical-action-unsupported", severity: "error", title: "Critical battery action unsupported", message: `${settings.vehicle} does not support ${settings.batteryCriticalAction} as a critical action.`, nodeIds: [] });
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

  for (const controller of flightControllers) {
    if (!hasIncoming(edges, controller.id, "power-in")) {
      issues.push({
        id: flightControllers.length === 1 ? "fc-power-missing" : `fc-${controller.id}-power-missing`,
        severity: "error",
        title: "Flight controller power missing",
        message: `${controller.data.label} needs a regulated supply connected to its PWR input (power-in).`,
        nodeIds: [controller.id],
        portIds: [{ nodeId: controller.id, portId: "power-in" }]
      });
    }
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
        nodeIds: [esc.id],
        portIds: [{ nodeId: esc.id, portId: "pwm-in" }]
      });
    }
    if (!hasIncoming(edges, esc.id, "power-in")) {
      issues.push({
        id: `esc-${esc.id}-power`,
        severity: "error",
        title: "ESC power missing",
        message: `${esc.data.label} needs main battery power.`,
        nodeIds: [esc.id],
        portIds: [{ nodeId: esc.id, portId: "power-in" }]
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
        nodeIds: [motor.id],
        portIds: [{ nodeId: motor.id, portId: "power-in" }]
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

  for (const servo of nodesOf(nodes, "servo")) {
    const requiredConnections = [
      { handle: "pwm-in", source: "flight-controller", title: "Servo command missing", message: "needs a PWM command from the flight controller", severity: "error" as const },
      { handle: "power-in", source: undefined, title: "Servo power missing", message: "needs a supply matching its voltage rating", severity: "error" as const },
      { handle: "mount-in", source: "frame", title: "Servo mount missing", message: "needs a mount on its airframe or chassis", severity: "warning" as const }
    ];
    for (const connection of requiredConnections) {
      if (!hasIncoming(edges, servo.id, connection.handle, connection.source, nodes)) {
        issues.push({ id: `servo-${servo.id}-${connection.handle}`, severity: connection.severity, title: connection.title, message: `${servo.data.label} ${connection.message}.`, nodeIds: [servo.id], portIds: [{ nodeId: servo.id, portId: connection.handle }] });
      }
    }
  }

  if (gps.length === 0) {
    issues.push({
      id: "gps-missing",
      severity: "warning",
      title: "GPS missing",
      message: "Most autonomous ArduPilot missions need a GPS source."
    });
  }
  for (const sensor of [...gps, ...compass, ...rangefinders, ...airspeedSensors, ...opticalFlowSensors]) {
    if (flightControllers.length > 0 && !componentHasControllerDataPath(sensor, edges, byId)) {
      issues.push({
        id: sensor.data.componentType === "gps" && gps.length === 1 ? "gps-not-wired" : `sensor-${sensor.id}-data`,
        severity: "warning",
        title: "Sensor data link missing",
        message: `${sensor.data.label} needs a compatible data path to the flight controller, directly or through a wiring harness.`,
        nodeIds: [sensor.id]
      });
    }
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

  for (const companion of companionComputers) {
    if (!componentHasControllerDataPath(companion, edges, byId)) issues.push({
      id: companionComputers.length === 1 ? "companion-link-missing" : `companion-${companion.id}-link-missing`,
      severity: "info",
      title: "Companion MAVLink link missing",
      message: `${companion.data.label} needs a UART data path to the flight controller, directly or through a wiring harness.`,
      nodeIds: [companion.id]
    });
  }

  for (const traffic of adsbRemoteId) {
    if (!componentHasControllerDataPath(traffic, edges, byId)) issues.push({
      id: adsbRemoteId.length === 1 ? "traffic-module-link-missing" : `traffic-${traffic.id}-link-missing`,
      severity: "info",
      title: "Traffic module not wired",
      message: `${traffic.data.label} needs a UART or CAN data path to the flight controller.`,
      nodeIds: [traffic.id]
    });
  }

  for (const { node, port } of unconnectedRequiredPorts(nodes, edges)) {
    if (issues.some((issue) => issue.portIds?.some((location) => location.nodeId === node.id && location.portId === port.id))) continue;
    issues.push({
      id: `required-${node.id}-${port.id}`,
      severity: "error",
      title: `Required ${port.kind} ${port.direction} missing`,
      message: `${node.data.label} has no valid connection at ${port.label} (${port.id}). Connect a compatible ${port.direction === "input" ? "output to this input" : "input to this output"}.`,
      nodeIds: [node.id],
      portIds: [{ nodeId: node.id, portId: port.id }]
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
