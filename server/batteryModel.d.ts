export interface BatteryPropertyIssue { key: string; severity: "error" | "warning"; message: string; }
export interface BatteryMetrics {
  chemistry: "LiPo" | "LiHV" | "Li-ion";
  seriesCells: number; parallelCells: number; capacityMah: number; capacityAh: number;
  cRating: number; burstCRating: number;
  nominalCellVoltageV: number; maxCellVoltageV: number; nominalVoltageV: number; fullVoltageV: number;
  lowCellVoltageV: number; criticalCellVoltageV: number; lowVoltageV: number; criticalVoltageV: number;
  energyWh: number; packContinuousCurrentA: number; continuousCurrentA: number; burstCurrentA: number;
  connectorCurrentA: number; chargeRateC: number; chargeCurrentA: number;
  massG: number; massSource: "spec" | "estimated"; issues: BatteryPropertyIssue[];
}
export function batteryMetrics(properties?: Record<string, unknown>): BatteryMetrics;
