import type { DesignEdge, DesignNode, SignalKind, SimulationSettings } from "./design";
import { componentCatalog } from "./componentCatalog";
import { componentHasControllerDataPath, expectedMotorCount, validDesignConnections } from "./validators";

export interface AutoWireSuggestion {
  id: string;
  title: string;
  sourceId: string;
  sourceHandle: string;
  targetId: string;
  targetHandle: string;
  signal: SignalKind;
}

const definitions = new Map(componentCatalog.map((definition) => [definition.type, definition]));
const dataKinds: SignalKind[] = ["uart", "i2c", "can", "analog", "telemetry"];
const portsFor = (node: DesignNode) => definitions.get(node.data.componentType)?.ports ?? [];
const endpointKey = (nodeId: string, handle: string) => JSON.stringify([nodeId, handle]);

/** Adds only missing compatible connections; existing wires always remain the user's choice. */
export function autoWireSuggestions(nodes: DesignNode[], edges: DesignEdge[], settings: SimulationSettings): AutoWireSuggestion[] {
  const knownNodes = nodes.filter((node) => definitions.has(node.data.componentType));
  const byId = new Map(knownNodes.map((node) => [node.id, node]));
  const byType = (type: string) => knownNodes.filter((node) => node.data.componentType === type);
  const first = (type: string) => byType(type)[0];
  const working = validDesignConnections(knownNodes, edges);
  const valid = new Set(working);
  const blockedInputs = new Set<string>();
  const blockedNodes = new Set<string>();
  const occupied = new Set<string>();
  for (const edge of edges) {
    const target = byId.get(edge.target);
    if (!target) continue;
    const port = portsFor(target).find((candidate) => candidate.id === edge.targetHandle);
    if (!port) { blockedNodes.add(target.id); continue; }
    const key = endpointKey(target.id, port.id);
    occupied.add(key);
    if (!valid.has(edge)) blockedInputs.add(key);
  }
  const suggestions: AutoWireSuggestion[] = [];

  const hasPath = (sourceId: string, targetId: string, kind: SignalKind) => {
    const reached = new Set([sourceId]);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of working) {
        const source = byId.get(edge.source);
        if (!source || !reached.has(edge.source) || reached.has(edge.target)) continue;
        if (portsFor(source).find((port) => port.id === edge.sourceHandle)?.kind !== kind) continue;
        reached.add(edge.target);
        changed = true;
      }
    }
    return reached.has(targetId);
  };

  const add = (title: string, source: DesignNode | undefined, sourceHandle: string, target: DesignNode | undefined, targetHandle: string) => {
    if (!source || !target || source.id === target.id) return false;
    const sourcePort = portsFor(source).find((port) => port.id === sourceHandle);
    const targetPort = portsFor(target).find((port) => port.id === targetHandle);
    if (!sourcePort || !targetPort) return false;
    const targetKey = endpointKey(target.id, targetHandle);
    if (blockedNodes.has(target.id) || blockedInputs.has(targetKey)) return false;
    // I2C/CAN and grouped FC UART ports are shared. Power, PWM, video and mounts
    // are single-feed inputs; an alternate valid supply must never get paralleled.
    const sharedBus = ["i2c", "can"].includes(targetPort.kind) ||
      target.data.componentType === "flight-controller" && targetPort.kind === "uart";
    if (occupied.has(targetKey) && !sharedBus) return false;
    if (working.some((edge) => edge.source === source.id && edge.sourceHandle === sourceHandle && edge.target === target.id && edge.targetHandle === targetHandle)) return false;
    if (hasPath(target.id, source.id, sourcePort.kind)) return false;
    const id = `${source.id}:${sourceHandle}->${target.id}:${targetHandle}`;
    const candidate: DesignEdge = { id, source: source.id, sourceHandle, target: target.id, targetHandle };
    if (!validDesignConnections(knownNodes, [candidate]).length) return false;
    suggestions.push({ id, title, sourceId: source.id, sourceHandle, targetId: target.id, targetHandle, signal: sourcePort.kind });
    working.push(candidate);
    occupied.add(targetKey);
    return true;
  };

  const feed = (target: DesignNode, sources: Array<DesignNode | undefined>) => {
    for (const source of sources) {
      if (add(`${target.data.label} power from ${source?.data.label ?? "supply"}`, source, "power-out", target, "power-in")) return;
    }
  };
  const battery = first("battery");
  const fuse = first("fuse");
  const distribution = first("power-distribution-board");
  const powerModule = first("power-module");
  const harness = first("wiring-harness");
  const controllers = byType("flight-controller");
  const frame = first("frame");
  const regulatedSources = knownNodes.filter((node) => node.data.componentType === "power-module" ||
    (node.data.componentType === "power-distribution-board" && typeof node.data.properties.auxVoltage === "string" && node.data.properties.auxVoltage !== "None"));

  for (const node of byType("fuse")) feed(node, [battery]);
  for (const node of byType("power-distribution-board")) feed(node, [fuse, battery, powerModule]);
  for (const node of byType("power-module")) feed(node, [distribution, fuse, battery]);
  for (const node of byType("wiring-harness")) feed(node, [distribution, powerModule, fuse, battery]);
  for (const controller of controllers) {
    feed(controller, [powerModule, ...regulatedSources]);
    add(`${controller.data.label} battery telemetry`, powerModule, "analog-out", controller, "analog-in");
  }

  const harnessHasRegulatedFeed = harness && regulatedSources.some((source) => hasPath(source.id, harness.id, "power"));
  const lowVoltageSources = [harnessHasRegulatedFeed ? harness : undefined, powerModule, ...regulatedSources];
  const powerChainTypes = new Set(["battery", "fuse", "power-distribution-board", "power-module", "wiring-harness", "flight-controller", "esc", "motor"]);
  for (const node of knownNodes) {
    if (!powerChainTypes.has(node.data.componentType) && portsFor(node).some((port) => port.id === "power-in")) feed(node, lowVoltageSources);
  }

  // Preserve a device's existing connection through a harness. If its other end
  // is missing, finish that path instead of adding a direct duplicate cable.
  const connectData = (device: DesignNode, preferredKinds: SignalKind[]) => {
    if (componentHasControllerDataPath(device, working, byId)) return;
    const connectedKinds = working.filter((edge) => edge.source === device.id || edge.target === device.id)
      .map((edge) => portsFor(device).find((port) => port.id === (edge.source === device.id ? edge.sourceHandle : edge.targetHandle))?.kind)
      .filter((kind): kind is SignalKind => Boolean(kind && dataKinds.includes(kind)));
    const kinds = connectedKinds.length ? [...new Set(connectedKinds)] : preferredKinds;
    for (const kind of kinds) {
      const reached = new Map<string, DesignNode>([[device.id, device]]);
      for (let changed = true; changed;) {
        changed = false;
        for (const edge of working) {
          const source = byId.get(edge.source);
          if (!source || portsFor(source).find((port) => port.id === edge.sourceHandle)?.kind !== kind) continue;
          const next = reached.has(edge.source) ? byId.get(edge.target) : reached.has(edge.target) ? source : undefined;
          if (next?.data.componentType === "wiring-harness" && !reached.has(next.id)) {
            reached.set(next.id, next);
            changed = true;
          }
        }
      }
      for (const endpoint of [...reached.values()].reverse()) {
        for (const port of portsFor(endpoint).filter((candidate) => candidate.kind === kind)) {
          const alreadyUsed = edges.some((edge) => edge.source === endpoint.id && edge.sourceHandle === port.id || edge.target === endpoint.id && edge.targetHandle === port.id);
          if (alreadyUsed) continue;
          for (const controller of controllers) {
            const counterpart = portsFor(controller).find((candidate) => candidate.kind === kind && candidate.direction !== port.direction);
            if (!counterpart) continue;
            const connected = port.direction === "output"
              ? add(`${device.data.label} ${kind.toUpperCase()} to ${controller.data.label}`, endpoint, port.id, controller, counterpart.id)
              : add(`${controller.data.label} ${kind.toUpperCase()} to ${device.data.label}`, controller, counterpart.id, endpoint, port.id);
            if (connected) return;
          }
        }
      }
    }
  };
  for (const node of knownNodes) {
    const configured = String(node.data.properties.interface ?? "").toLowerCase();
    const configuredKind: SignalKind = configured.includes("can") ? "can" : configured.includes("analog") ? "analog" : configured.includes("uart") ? "uart" : "i2c";
    const preferences: Record<string, SignalKind[]> = {
      gps: ["uart"], compass: ["i2c"], rangefinder: ["uart", "i2c"], "rc-receiver": ["uart"],
      "optical-flow": [configuredKind], "airspeed-sensor": [configuredKind],
      "telemetry-radio": ["uart"], "virtual-telemetry": ["uart"], "companion-computer": ["uart", "can"], "adsb-remote-id": ["uart", "can"]
    };
    if (preferences[node.data.componentType]) connectData(node, preferences[node.data.componentType]);
  }

  const propulsionCount = expectedMotorCount(settings);
  const motors = byType("motor").slice(0, propulsionCount);
  const escs = byType("esc").slice(0, propulsionCount);
  for (const esc of escs) {
    feed(esc, [distribution, fuse, battery, powerModule]);
    add(`${esc.data.label} PWM command`, controllers[0], "pwm-out", esc, "pwm-in");
  }
  const usedEscs = new Set(edges.filter((edge) => edge.sourceHandle === "power-out" && byId.get(edge.source)?.data.componentType === "esc").map((edge) => edge.source));
  for (const motor of motors) {
    const esc = escs.find((candidate) => !usedEscs.has(candidate.id));
    if (esc && add(`${motor.data.label} driven by ${esc.data.label}`, esc, "power-out", motor, "power-in")) usedEscs.add(esc.id);
    add(`${motor.data.label} mounted to ${frame?.data.label ?? "airframe"}`, frame, "mount-out", motor, "mount-in");
  }
  for (const node of knownNodes) {
    if (["servo", "parachute", "buzzer", "gimbal"].includes(node.data.componentType)) {
      add(`${node.data.label} PWM command`, controllers[0], "pwm-out", node, "pwm-in");
    }
    if (["servo", "landing-gear", "optical-flow", "airspeed-sensor", "rangefinder", "parachute", "payload-mount"].includes(node.data.componentType)) {
      add(`${node.data.label} mounted to ${frame?.data.label ?? "airframe"}`, frame, "mount-out", node, "mount-in");
    }
  }
  for (const [index, gimbal] of byType("gimbal").entries()) {
    add(`${gimbal.data.label} mechanical mount`, byType("payload-mount")[index] ?? frame, "mount-out", gimbal, "mount-in");
  }
  for (const [index, camera] of byType("camera").entries()) {
    add(`${camera.data.label} mechanical mount`, byType("gimbal")[index] ?? byType("payload-mount")[index] ?? frame, "mount-out", camera, "mount-in");
    add(`${camera.data.label} video link`, camera, "video-out", byType("companion-computer")[index], "video-in");
  }
  return suggestions;
}
