import type {
  DesignNode,
  EngineeringDomainId,
  EngineeringManagementState,
  EngineeringPriority,
  EngineeringWorkItem,
  PowerLoadCriticality,
  PowerLoadOverride,
  PowerRailId,
  SimulationSettings
} from "./design";

export interface EngineeringCheckInput {
  id: string;
  label: string;
  description: string;
  detail: string;
  passed: boolean;
  severity: "error" | "warning" | "info";
}

export interface EngineeringAssessmentInput {
  id: EngineeringDomainId;
  label: string;
  checks: EngineeringCheckInput[];
}

export interface PowerLoadRow extends PowerLoadOverride {
  label: string;
  componentType: string;
  voltageV: number;
  continuousCurrentA: number;
  continuousPowerW: number;
  peakPowerW: number;
  source: "derived" | "override";
}

export interface PowerRailBudget {
  id: PowerRailId;
  label: string;
  voltageV: number;
  loadCount: number;
  continuousCurrentA: number;
  peakCurrentA: number;
  continuousLimitA: number;
  peakLimitA: number;
  continuousUtilizationPercent: number;
  peakUtilizationPercent: number;
  marginA: number;
  reserveTargetPercent: number;
  withinReserve: boolean;
  peakWithinLimit: boolean;
}

export interface PowerBudget {
  rows: PowerLoadRow[];
  rails: PowerRailBudget[];
  totalContinuousPowerW: number;
  totalPeakPowerW: number;
  withinReserve: boolean;
  peakWithinLimit: boolean;
  limitingRail?: PowerRailBudget;
}

const railIds: PowerRailId[] = ["battery-bus", "regulated-5v", "regulated-12v"];

const railLabels: Record<PowerRailId, string> = {
  "battery-bus": "Battery bus",
  "regulated-5v": "5 V avionics",
  "regulated-12v": "12 V payload"
};

const domainOwners: Record<EngineeringDomainId, string> = {
  "electrical-power": "Electrical",
  "wiring-buses": "Integration",
  "mechanical-mounting": "Mechanical",
  propulsion: "Propulsion",
  "avionics-sensors": "Avionics",
  communications: "Communications",
  safety: "Safety"
};

export const defaultEngineeringManagement: EngineeringManagementState = {
  version: 1,
  projectPhase: "Preliminary design",
  technicalLead: "Unassigned",
  nextReviewDate: "",
  powerReservePercent: 20,
  railLimits: {
    "battery-bus": { continuousCurrentA: 0, peakCurrentA: 0 },
    "regulated-5v": { continuousCurrentA: 0, peakCurrentA: 0 },
    "regulated-12v": { continuousCurrentA: 0, peakCurrentA: 0 }
  },
  loadOverrides: {},
  workItems: []
};

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positive(value: unknown, fallback: number) {
  const parsed = finiteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function propertyNumber(node: DesignNode, key: string, fallback = 0) {
  return finiteNumber(node.data.properties[key], fallback);
}

function powerRailLimit(value: unknown) {
  const candidate = (value ?? {}) as Partial<{ continuousCurrentA: number; peakCurrentA: number }>;
  return {
    continuousCurrentA: Math.max(0, finiteNumber(candidate.continuousCurrentA)),
    peakCurrentA: Math.max(0, finiteNumber(candidate.peakCurrentA))
  };
}

function normalizeWorkItem(value: EngineeringWorkItem): EngineeringWorkItem {
  return {
    ...value,
    owner: value.owner || "Unassigned",
    status: ["open", "in-progress", "blocked", "verified"].includes(value.status) ? value.status : "open",
    priority: ["low", "medium", "high", "critical"].includes(value.priority) ? value.priority : "medium",
    dueDate: value.dueDate || "",
    effortHours: Math.max(0, finiteNumber(value.effortHours)),
    likelihood: clamp(finiteNumber(value.likelihood, 2), 1, 5),
    impact: clamp(finiteNumber(value.impact, 3), 1, 5),
    mitigation: value.mitigation || "",
    evidence: value.evidence || ""
  };
}

export function managementWithDefaults(value?: Partial<EngineeringManagementState> | null): EngineeringManagementState {
  const input = value ?? {};
  return {
    version: 1,
    projectPhase: input.projectPhase ?? defaultEngineeringManagement.projectPhase,
    technicalLead: input.technicalLead?.trim() || defaultEngineeringManagement.technicalLead,
    nextReviewDate: input.nextReviewDate ?? "",
    powerReservePercent: clamp(finiteNumber(input.powerReservePercent, 20), 0, 60),
    railLimits: {
      "battery-bus": powerRailLimit(input.railLimits?.["battery-bus"]),
      "regulated-5v": powerRailLimit(input.railLimits?.["regulated-5v"]),
      "regulated-12v": powerRailLimit(input.railLimits?.["regulated-12v"])
    },
    loadOverrides: Object.fromEntries(
      Object.entries(input.loadOverrides ?? {}).map(([nodeId, override]) => [
        nodeId,
        {
          ...override,
          nodeId,
          enabled: override.enabled !== false,
          nominalCurrentA: Math.max(0, finiteNumber(override.nominalCurrentA)),
          peakCurrentA: Math.max(0, finiteNumber(override.peakCurrentA)),
          dutyCyclePercent: clamp(finiteNumber(override.dutyCyclePercent, 100), 0, 100),
          shedPriority: clamp(Math.round(finiteNumber(override.shedPriority, 3)), 1, 5),
          notes: override.notes ?? ""
        }
      ])
    ),
    workItems: (input.workItems ?? []).map(normalizeWorkItem)
  };
}

function batteryVoltage(nodes: readonly DesignNode[]) {
  const battery = nodes.find((node) => node.data.componentType === "battery");
  return battery ? positive(propertyNumber(battery, "cells", 4), 4) * 3.7 : 14.8;
}

function railVoltage(rail: PowerRailId, nodes: readonly DesignNode[]) {
  if (rail === "regulated-5v") return 5;
  if (rail === "regulated-12v") return 12;
  return batteryVoltage(nodes);
}

function defaultLoad(node: DesignNode, nodes: readonly DesignNode[]): Omit<PowerLoadOverride, "nodeId" | "notes"> | null {
  const batteryV = batteryVoltage(nodes);
  const defaults: Record<string, Omit<PowerLoadOverride, "nodeId" | "notes"> | undefined> = {
    "flight-controller": { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.45, peakCurrentA: 0.8, dutyCyclePercent: 100, criticality: "essential", shedPriority: 5 },
    gps: { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.12, peakCurrentA: 0.18, dutyCyclePercent: 100, criticality: "essential", shedPriority: 5 },
    compass: { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.02, peakCurrentA: 0.04, dutyCyclePercent: 100, criticality: "essential", shedPriority: 5 },
    rangefinder: { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.18, peakCurrentA: 0.35, dutyCyclePercent: 80, criticality: "mission", shedPriority: 3 },
    "airspeed-sensor": { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.08, peakCurrentA: 0.14, dutyCyclePercent: 100, criticality: "mission", shedPriority: 4 },
    "optical-flow": { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.22, peakCurrentA: 0.4, dutyCyclePercent: 80, criticality: "mission", shedPriority: 3 },
    "telemetry-radio": { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.28, peakCurrentA: 0.65, dutyCyclePercent: 85, criticality: "essential", shedPriority: 4 },
    "rc-receiver": { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.12, peakCurrentA: 0.25, dutyCyclePercent: 100, criticality: "essential", shedPriority: 5 },
    "adsb-remote-id": { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.22, peakCurrentA: 0.45, dutyCyclePercent: 100, criticality: "mission", shedPriority: 4 },
    parachute: { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.08, peakCurrentA: 1.4, dutyCyclePercent: 5, criticality: "essential", shedPriority: 5 },
    buzzer: { rail: "regulated-5v", enabled: true, nominalCurrentA: 0.08, peakCurrentA: 0.2, dutyCyclePercent: 15, criticality: "essential", shedPriority: 5 },
    camera: { rail: "regulated-12v", enabled: true, nominalCurrentA: 0.55, peakCurrentA: 0.9, dutyCyclePercent: 85, criticality: "mission", shedPriority: 2 },
    gimbal: { rail: "regulated-12v", enabled: true, nominalCurrentA: 0.8, peakCurrentA: 2.2, dutyCyclePercent: 65, criticality: "mission", shedPriority: 2 }
  };

  if (node.data.componentType === "esc") {
    const rating = positive(propertyNumber(node, "maxAmps", 35), 35);
    return { rail: "battery-bus", enabled: true, nominalCurrentA: rating * 0.7, peakCurrentA: rating * 0.85, dutyCyclePercent: 65, criticality: "essential", shedPriority: 5 };
  }

  if (node.data.componentType === "companion-computer") {
    const watts = positive(propertyNumber(node, "powerWatts", 8), 8);
    const rail: PowerRailId = watts > 18 ? "regulated-12v" : "regulated-5v";
    const volts = rail === "regulated-12v" ? 12 : 5;
    return { rail, enabled: true, nominalCurrentA: watts / volts, peakCurrentA: (watts * 1.35) / volts, dutyCyclePercent: 85, criticality: "mission", shedPriority: 2 };
  }

  const product = defaults[node.data.componentType];
  if (product) return product;

  const watts = propertyNumber(node, "powerWatts");
  if (watts > 0) {
    return { rail: "battery-bus", enabled: true, nominalCurrentA: watts / batteryV, peakCurrentA: (watts * 1.25) / batteryV, dutyCyclePercent: 80, criticality: "support", shedPriority: 1 };
  }

  return null;
}

function autoRailLimits(nodes: readonly DesignNode[]): Record<PowerRailId, { continuousCurrentA: number; peakCurrentA: number }> {
  const battery = nodes.find((node) => node.data.componentType === "battery");
  const batteryMax = battery
    ? positive(propertyNumber(battery, "capacityMah", 5200), 5200) / 1000 * positive(propertyNumber(battery, "cRating", 35), 35)
    : 120;
  const pdb = nodes.find((node) => node.data.componentType === "power-distribution-board");
  const fuse = nodes.find((node) => node.data.componentType === "fuse");
  const harness = nodes.find((node) => node.data.componentType === "wiring-harness");
  const batteryContinuousCandidates = [
    batteryMax,
    pdb ? propertyNumber(pdb, "continuousCurrentA") : 0,
    fuse ? propertyNumber(fuse, "ratingAmps") : 0,
    harness ? propertyNumber(harness, "maxCurrentA") : 0
  ].filter((value) => value > 0);
  const batteryPeakCandidates = [
    batteryMax,
    pdb ? propertyNumber(pdb, "peakCurrentA") : 0,
    fuse ? propertyNumber(fuse, "ratingAmps") * 1.5 : 0,
    harness ? propertyNumber(harness, "maxCurrentA") * 1.25 : 0
  ].filter((value) => value > 0);
  const powerModule = nodes.find((node) => node.data.componentType === "power-module");
  const regulated5 = powerModule ? positive(propertyNumber(powerModule, "regulatedMaxAmps", 5), 5) : 5;
  const auxCurrent = pdb ? positive(propertyNumber(pdb, "auxCurrentA", 5), 5) : 5;

  return {
    "battery-bus": {
      continuousCurrentA: batteryContinuousCandidates.length ? Math.min(...batteryContinuousCandidates) : 120,
      peakCurrentA: batteryPeakCandidates.length ? Math.min(...batteryPeakCandidates) : 150
    },
    "regulated-5v": { continuousCurrentA: regulated5, peakCurrentA: regulated5 * 1.5 },
    "regulated-12v": { continuousCurrentA: auxCurrent, peakCurrentA: auxCurrent * 1.5 }
  };
}

export function buildPowerBudget(
  nodes: readonly DesignNode[],
  _settings: SimulationSettings,
  state?: Partial<EngineeringManagementState> | null
): PowerBudget {
  const management = managementWithDefaults(state);
  const rows = nodes.flatMap((node): PowerLoadRow[] => {
    const derived = defaultLoad(node, nodes);
    if (!derived) return [];
    const override = management.loadOverrides[node.id];
    const load: PowerLoadOverride = override
      ? { ...derived, ...override, nodeId: node.id, notes: override.notes ?? "" }
      : { ...derived, nodeId: node.id, notes: "" };
    const voltageV = railVoltage(load.rail, nodes);
    const continuousCurrentA = load.enabled ? load.nominalCurrentA * (load.dutyCyclePercent / 100) : 0;
    const peakCurrentA = load.enabled ? load.peakCurrentA : 0;
    return [{
      ...load,
      label: node.data.label,
      componentType: node.data.componentType,
      voltageV,
      continuousCurrentA,
      continuousPowerW: continuousCurrentA * voltageV,
      peakPowerW: peakCurrentA * voltageV,
      source: override ? "override" : "derived"
    }];
  });

  const automaticLimits = autoRailLimits(nodes);
  const reserveTargetPercent = management.powerReservePercent;
  const rails = railIds.map((id): PowerRailBudget => {
    const railRows = rows.filter((row) => row.rail === id);
    const continuousCurrentA = railRows.reduce((sum, row) => sum + row.continuousCurrentA, 0);
    const peakCurrentA = railRows.reduce((sum, row) => sum + row.peakCurrentA, 0);
    const configured = management.railLimits[id];
    const continuousLimitA = configured.continuousCurrentA > 0 ? configured.continuousCurrentA : automaticLimits[id].continuousCurrentA;
    const peakLimitA = configured.peakCurrentA > 0 ? configured.peakCurrentA : automaticLimits[id].peakCurrentA;
    const continuousUtilizationPercent = continuousLimitA > 0 ? (continuousCurrentA / continuousLimitA) * 100 : 0;
    const peakUtilizationPercent = peakLimitA > 0 ? (peakCurrentA / peakLimitA) * 100 : 0;
    return {
      id,
      label: railLabels[id],
      voltageV: railVoltage(id, nodes),
      loadCount: railRows.length,
      continuousCurrentA,
      peakCurrentA,
      continuousLimitA,
      peakLimitA,
      continuousUtilizationPercent,
      peakUtilizationPercent,
      marginA: continuousLimitA - continuousCurrentA,
      reserveTargetPercent,
      withinReserve: continuousUtilizationPercent <= 100 - reserveTargetPercent,
      peakWithinLimit: peakUtilizationPercent <= 100
    };
  });
  const activeRails = rails.filter((rail) => rail.loadCount > 0);
  const limitingRail = [...activeRails].sort((left, right) => right.continuousUtilizationPercent - left.continuousUtilizationPercent)[0];

  return {
    rows,
    rails,
    totalContinuousPowerW: rows.reduce((sum, row) => sum + row.continuousPowerW, 0),
    totalPeakPowerW: rows.reduce((sum, row) => sum + row.peakPowerW, 0),
    withinReserve: activeRails.every((rail) => rail.withinReserve),
    peakWithinLimit: activeRails.every((rail) => rail.peakWithinLimit),
    limitingRail
  };
}

function priorityForSeverity(severity: EngineeringCheckInput["severity"]): EngineeringPriority {
  if (severity === "error") return "high";
  if (severity === "warning") return "medium";
  return "low";
}

function riskDefaults(domainId: EngineeringDomainId, severity: EngineeringCheckInput["severity"]) {
  const impact = ["electrical-power", "propulsion", "safety"].includes(domainId) ? 5 : 4;
  return { likelihood: severity === "error" ? 4 : severity === "warning" ? 3 : 2, impact };
}

export function buildEngineeringWorkItems(
  assessments: readonly EngineeringAssessmentInput[],
  state?: Partial<EngineeringManagementState> | null
): EngineeringWorkItem[] {
  const management = managementWithDefaults(state);
  const stored = new Map(management.workItems.map((item) => [item.id, item]));
  const generated = assessments.flatMap((domain) =>
    domain.checks.map((check): EngineeringWorkItem => {
      const id = `check:${domain.id}:${check.id}`;
      const existing = stored.get(id);
      const risk = riskDefaults(domain.id, check.severity);
      return normalizeWorkItem({
        id,
        title: check.label,
        domainId: domain.id,
        sourceCheckId: check.id,
        owner: existing?.owner ?? domainOwners[domain.id],
        status: check.passed ? "verified" : existing?.status === "verified" ? "open" : existing?.status ?? "open",
        priority: existing?.priority ?? priorityForSeverity(check.severity),
        dueDate: existing?.dueDate ?? "",
        effortHours: existing?.effortHours ?? (check.severity === "error" ? 8 : check.severity === "warning" ? 4 : 2),
        likelihood: existing?.likelihood ?? risk.likelihood,
        impact: existing?.impact ?? risk.impact,
        mitigation: existing?.mitigation ?? check.description,
        evidence: existing?.evidence ?? ""
      });
    })
  );
  const manual = management.workItems.filter((item) => item.manual || !item.sourceCheckId);
  return [...generated, ...manual].sort((left, right) => {
    const statusRank = { blocked: 0, open: 1, "in-progress": 2, verified: 3 } as const;
    const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return statusRank[left.status] - statusRank[right.status] || priorityRank[left.priority] - priorityRank[right.priority];
  });
}

export function engineeringManagementSummary(items: readonly EngineeringWorkItem[]) {
  const today = new Date().toISOString().slice(0, 10);
  const active = items.filter((item) => item.status !== "verified");
  return {
    total: items.length,
    verified: items.length - active.length,
    open: active.length,
    blocked: active.filter((item) => item.status === "blocked").length,
    overdue: active.filter((item) => item.dueDate && item.dueDate < today).length,
    highRisk: active.filter((item) => item.likelihood * item.impact >= 12).length,
    remainingEffortHours: active.reduce((sum, item) => sum + item.effortHours, 0),
    readinessPercent: items.length ? Math.round(((items.length - active.length) / items.length) * 100) : 0
  };
}

export function powerRailLabel(id: PowerRailId) {
  return railLabels[id];
}

export const powerCriticalityOptions: PowerLoadCriticality[] = ["essential", "mission", "support"];
export const powerRailOptions: PowerRailId[] = [...railIds];
