export interface AirframeOption {
  value: string;
  label: string;
  rotorCount: number;
  simulatorFrame: string;
  vehicle: "ArduCopter" | "ArduPlane" | "Rover";
  description: string;
}

const rotorAirframes: AirframeOption[] = [
  { value: "single-rotor", label: "Single Rotor", rotorCount: 1, simulatorFrame: "heli", vehicle: "ArduCopter", description: "Helicopter-style single main rotor." },
  { value: "dual-rotor", label: "Dual Rotor", rotorCount: 2, simulatorFrame: "quad", vehicle: "ArduCopter", description: "Two-rotor experimental platform." },
  { value: "tri-y", label: "Tri Y", rotorCount: 3, simulatorFrame: "tri", vehicle: "ArduCopter", description: "Lightweight tricopter with yaw mechanism." },
  { value: "quad-x", label: "Quad X", rotorCount: 4, simulatorFrame: "quad", vehicle: "ArduCopter", description: "Balanced general-purpose multirotor." },
  { value: "penta-x", label: "Penta X", rotorCount: 5, simulatorFrame: "quad", vehicle: "ArduCopter", description: "Five-rotor research configuration." },
  { value: "hexa-x", label: "Hexa X", rotorCount: 6, simulatorFrame: "hexa", vehicle: "ArduCopter", description: "Higher payload and motor-out margin." },
  { value: "hepta-x", label: "Hepta X", rotorCount: 7, simulatorFrame: "hexa", vehicle: "ArduCopter", description: "Seven-rotor experimental platform." },
  { value: "octa-x", label: "Octa X", rotorCount: 8, simulatorFrame: "octa", vehicle: "ArduCopter", description: "Heavy-lift and redundant propulsion." },
  { value: "nona-x", label: "Nona X", rotorCount: 9, simulatorFrame: "octa", vehicle: "ArduCopter", description: "Nine-rotor custom platform." },
  { value: "deca-x", label: "Deca X", rotorCount: 10, simulatorFrame: "octa", vehicle: "ArduCopter", description: "Ten-rotor custom platform." },
  { value: "hendeca-x", label: "Hendeca X", rotorCount: 11, simulatorFrame: "octa", vehicle: "ArduCopter", description: "Eleven-rotor custom platform." },
  { value: "dodeca-x", label: "Dodeca X", rotorCount: 12, simulatorFrame: "octa", vehicle: "ArduCopter", description: "Twelve-rotor heavy-lift platform." }
];

const numericAirframes: AirframeOption[] = Array.from({ length: 20 }, (_, index) => {
  const rotorCount = index + 13;
  return {
    value: `${rotorCount}-rotor-x`,
    label: `${rotorCount} Rotor X`,
    rotorCount,
    simulatorFrame: "octa",
    vehicle: "ArduCopter" as const,
    description: `${rotorCount}-rotor custom research configuration.`
  };
});

const legacyAirframes: AirframeOption[] = [
  { value: "fixed-wing", label: "Fixed Wing", rotorCount: 1, simulatorFrame: "plane", vehicle: "ArduPlane", description: "Efficient long-range wing platform." },
  { value: "rover", label: "Rover", rotorCount: 0, simulatorFrame: "rover", vehicle: "Rover", description: "Ground vehicle for navigation and autonomy." }
];

export const airframeOptions: AirframeOption[] = [...rotorAirframes, ...numericAirframes, ...legacyAirframes];
export const airframeValues = airframeOptions.map((option) => option.value);

export function airframesForVehicle(vehicle: AirframeOption["vehicle"]) {
  return airframeOptions.filter((option) => option.vehicle === vehicle);
}

export function vehicleForAirframe(frame: string | undefined): AirframeOption["vehicle"] {
  const normalized = normalizeAirframeValue(frame);
  return airframeOptions.find((option) => option.value === normalized)?.vehicle ?? "ArduCopter";
}

export function airframeLabel(value: string) {
  return airframeOptions.find((option) => option.value === value)?.label ?? value;
}

export function normalizeAirframeValue(frame: string | undefined): string {
  const normalized = String(frame ?? "")
    .trim()
    .toLowerCase();
  const direct = airframeOptions.find((option) => option.value === normalized || option.label.toLowerCase() === normalized);
  if (direct) {
    return direct.value;
  }
  if (normalized === "plane" || normalized.includes("fixed")) {
    return "fixed-wing";
  }
  if (normalized.includes("rover")) {
    return "rover";
  }

  const byRotorCount = airframeOptions.find((option) => option.rotorCount === rotorCountForFrame(normalized));
  return byRotorCount?.value ?? "quad-x";
}

export function rotorCountForFrame(frame: string | undefined): number {
  const normalized = String(frame ?? "")
    .trim()
    .toLowerCase();
  const direct = airframeOptions.find((option) => option.value === normalized || option.label.toLowerCase() === normalized);
  if (direct) {
    return direct.rotorCount;
  }

  const numericMatch = normalized.match(/\b([1-9]|[12][0-9]|3[0-2])\s*-?\s*rotor\b/);
  if (numericMatch) {
    return Number(numericMatch[1]);
  }

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

export function simulatorFrameForFrame(frame: string | undefined): string {
  const normalized = String(frame ?? "")
    .trim()
    .toLowerCase();
  return airframeOptions.find((option) => option.value === normalized || option.label.toLowerCase() === normalized)?.simulatorFrame ?? "quad";
}
