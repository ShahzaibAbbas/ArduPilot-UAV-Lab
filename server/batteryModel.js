// Pack-level battery arithmetic shared by the inspector, budgets and exports.
// Chemistry defaults describe common cells; source-specific overrides take precedence.
const chemistryProfiles = {
  LiPo: { nominal: 3.7, full: 4.2, maximum: 4.2 },
  LiHV: { nominal: 3.8, full: 4.35, maximum: 4.45 },
  "Li-ion": { nominal: 3.6, full: 4.2, maximum: 4.2 }
};

export function batteryMetrics(properties = {}) {
  const issues = [];
  const problem = (key, message, severity = "error") => issues.push({ key, severity, message });
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    problem("properties", "Battery properties must be an object; defaults were used.");
    properties = {};
  }
  const read = (key, fallback, min, max, integer = false) => {
    const raw = properties[key];
    if (raw === undefined) return fallback;
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      problem(key, `${key} must be ${integer ? "an integer" : "a finite number"} between ${min} and ${max}.`);
      return fallback;
    }
    return value;
  };
  let chemistry = properties.chemistry ?? "LiPo";
  if (typeof chemistry !== "string" || !Object.hasOwn(chemistryProfiles, chemistry)) {
    problem("chemistry", "Choose LiPo, LiHV, or Li-ion chemistry.");
    chemistry = "LiPo";
  }
  const profile = chemistryProfiles[chemistry];
  const seriesCells = read("cells", 4, 1, 24, true);
  const parallelCells = read("parallelCells", 1, 1, 20, true);
  // capacityMah is the published TOTAL pack capacity, including parallel groups.
  const capacityMah = read("capacityMah", 5200, 1, 100000);
  const capacityAh = capacityMah / 1000;
  const cRating = read("cRating", 35, 0, 250);
  const burstCRating = read("burstCRating", 0, 0, 500);
  const declaredCurrentA = read("continuousCurrentA", 0, 0, 2000);
  const connectorCurrentA = read("connectorCurrentA", 0, 0, 2000);
  const nominalCellVoltageV = read("nominalCellVoltageV", 0, 0, 4.5) || profile.nominal;
  const maxCellVoltageV = read("maxCellVoltageV", 0, 0, 4.5) || profile.full;
  // These are editable lab failsafe thresholds, not cell discharge cutoffs or charger settings.
  const lowCellVoltageV = read("lowCellVoltageV", 0, 0, 4.5) || 3.5;
  const criticalCellVoltageV = read("criticalCellVoltageV", 0, 0, 4.5) || 3.3;
  if (nominalCellVoltageV < 2 || nominalCellVoltageV >= maxCellVoltageV) {
    problem("nominalCellVoltageV", "Nominal cell voltage must be at least 2 V and below full-charge cell voltage.");
  }
  if (maxCellVoltageV < 2 || maxCellVoltageV > profile.maximum + 1e-9) {
    problem("maxCellVoltageV", `${chemistry} full-charge cell voltage must be between 2 V and ${profile.maximum} V.`);
  }
  if (criticalCellVoltageV < 2 || criticalCellVoltageV >= lowCellVoltageV || lowCellVoltageV >= maxCellVoltageV) {
    problem("criticalCellVoltageV", "Voltage thresholds must satisfy 2 V ≤ critical < low < full-charge cell voltage.");
  }
  if (!cRating && !declaredCurrentA) problem("cRating", "Record a continuous C-rating or a continuous pack-current rating.");
  if (burstCRating > 0 && cRating > 0 && burstCRating < cRating) {
    problem("burstCRating", "Burst C-rating cannot be below the continuous C-rating.");
  }
  const currentRatings = [cRating * capacityAh, declaredCurrentA].filter((value) => value > 0);
  const packContinuousCurrentA = currentRatings.length ? Math.min(...currentRatings) : 0;
  const continuousCurrentA = connectorCurrentA > 0 ? Math.min(packContinuousCurrentA, connectorCurrentA) : packContinuousCurrentA;
  const packBurstCurrentA = burstCRating > 0 ? capacityAh * burstCRating : packContinuousCurrentA;
  if (packBurstCurrentA < packContinuousCurrentA) problem("burstCRating", "Burst pack-current rating cannot be below the continuous rating.");
  const burstCurrentA = connectorCurrentA > 0 ? Math.min(packBurstCurrentA, connectorCurrentA) : packBurstCurrentA;
  const nominalVoltageV = seriesCells * nominalCellVoltageV;
  const energyWh = nominalVoltageV * capacityAh;
  const recordedMassG = read("specMassG", 0, 0, 100000);
  // Generic engineering estimates only; use measured or manufacturer pack mass whenever available.
  const estimatedMassG = chemistry === "LiPo" ? seriesCells * capacityMah * 0.024
    : energyWh / (chemistry === "LiHV" ? 180 : 200) * 1000;
  const dimensions = ["packLengthMm", "packWidthMm", "packHeightMm"].map((key) => read(key, 0, 0, 2000));
  if (dimensions.some((value) => value > 0) && dimensions.some((value) => value === 0)) {
    problem("packLengthMm", "Record all three pack dimensions to describe its physical envelope.", "warning");
  }
  const chargeRateC = read("chargeRateC", 0, 0, 20);
  return {
    chemistry, seriesCells, parallelCells, capacityMah, capacityAh, cRating, burstCRating,
    nominalCellVoltageV, maxCellVoltageV, nominalVoltageV,
    fullVoltageV: seriesCells * maxCellVoltageV,
    lowCellVoltageV, criticalCellVoltageV,
    lowVoltageV: seriesCells * lowCellVoltageV, criticalVoltageV: seriesCells * criticalCellVoltageV,
    energyWh, packContinuousCurrentA, continuousCurrentA, burstCurrentA, connectorCurrentA,
    chargeRateC, chargeCurrentA: chargeRateC * capacityAh,
    massG: recordedMassG || Math.max(1, estimatedMassG), massSource: recordedMassG ? "spec" : "estimated", issues
  };
}
