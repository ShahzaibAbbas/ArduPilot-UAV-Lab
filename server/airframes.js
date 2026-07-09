const airframes = [
  ["single-rotor", "Single Rotor", 1, "heli"],
  ["dual-rotor", "Dual Rotor", 2, "quad"],
  ["tri-y", "Tri Y", 3, "tri"],
  ["quad-x", "Quad X", 4, "quad"],
  ["penta-x", "Penta X", 5, "quad"],
  ["hexa-x", "Hexa X", 6, "hexa"],
  ["hepta-x", "Hepta X", 7, "hexa"],
  ["octa-x", "Octa X", 8, "octa"],
  ["nona-x", "Nona X", 9, "octa"],
  ["deca-x", "Deca X", 10, "octa"],
  ["hendeca-x", "Hendeca X", 11, "octa"],
  ["dodeca-x", "Dodeca X", 12, "octa"],
  ...Array.from({ length: 20 }, (_, index) => {
    const rotorCount = index + 13;
    return [`${rotorCount}-rotor-x`, `${rotorCount} Rotor X`, rotorCount, "octa"];
  }),
  ["fixed-wing", "Fixed Wing", 1, "plane"],
  ["rover", "Rover", 0, "rover"]
].map(([value, label, rotorCount, simulatorFrame]) => ({ value, label, rotorCount, simulatorFrame }));

function normalizedFrame(frame) {
  return String(frame || "")
    .trim()
    .toLowerCase();
}

export function rotorCountForFrame(frame) {
  const normalized = normalizedFrame(frame);
  const direct = airframes.find((option) => option.value === normalized || option.label.toLowerCase() === normalized);
  if (direct) {
    return direct.rotorCount;
  }

  const numericMatch = normalized.match(/\b([1-9]|[12][0-9]|3[0-2])\s*-?\s*rotor\b/);
  if (numericMatch) return Number(numericMatch[1]);
  if (normalized.includes("dodeca")) return 12;
  if (normalized.includes("hendeca")) return 11;
  if (normalized.includes("deca")) return 10;
  if (normalized.includes("nona")) return 9;
  if (normalized.includes("octa")) return 8;
  if (normalized.includes("hepta")) return 7;
  if (normalized.includes("hexa")) return 6;
  if (normalized.includes("penta")) return 5;
  if (normalized.includes("quad")) return 4;
  if (normalized.includes("tri")) return 3;
  if (normalized.includes("dual") || normalized.includes("twin")) return 2;
  if (normalized.includes("fixed") || normalized.includes("plane")) return 1;
  if (normalized.includes("single") || normalized.includes("heli")) return 1;
  if (normalized.includes("rover")) return 0;
  return 4;
}

export function airframeLabel(frame) {
  const normalized = normalizedFrame(frame);
  return airframes.find((option) => option.value === normalized || option.label.toLowerCase() === normalized)?.label ?? String(frame || "Quad X");
}

export function simulatorFrameForFrame(frame) {
  const normalized = normalizedFrame(frame);
  const direct = airframes.find((option) => option.value === normalized || option.label.toLowerCase() === normalized);
  if (direct) {
    return direct.simulatorFrame;
  }
  if (normalized.includes("tri")) return "tri";
  if (normalized.includes("hexa")) return "hexa";
  if (normalized.includes("octa")) return "octa";
  if (normalized.includes("fixed") || normalized.includes("plane")) return "plane";
  if (normalized.includes("rover")) return "rover";
  if (normalized.includes("single") || normalized.includes("heli")) return "heli";
  return "quad";
}

export function usesSimulatorFallback(frame) {
  const rotorCount = rotorCountForFrame(frame);
  return ![0, 1, 3, 4, 6, 8].includes(rotorCount);
}
