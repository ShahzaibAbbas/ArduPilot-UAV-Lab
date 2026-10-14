export interface AirframeOption {
  value: string;
  label: string;
  rotorCount: number;
  simulatorFrame: string;
  vehicle: "ArduCopter" | "ArduPlane" | "Rover";
  description: string;
  /** Generic concept geometry, independent of simulator dynamics or vendor specifications. */
  visualKind?: "conventional" | "high-wing" | "flying-wing" | "vtail" | "glider" | "twin-boom" | "quadplane" | "ackermann" | "buggy" | "skid" | "tracked" | "six-wheel" | "balancebot";
  dimensions?: { spanM: number; lengthM: number; heightM: number };
  wheelCount?: number;
  propulsionMotorCount?: number;
  simulatorApproximation?: string;
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

// Keep the original fixed-wing and rover keys readable in existing .saq files.
const fixedWingAirframes: AirframeOption[] = [
  { value: "fixed-wing", label: "Fixed Wing", rotorCount: 1, propulsionMotorCount: 1, simulatorFrame: "plane", vehicle: "ArduPlane", visualKind: "conventional", dimensions: { spanM: 1.8, lengthM: 1.2, heightM: 0.34 }, description: "Conventional straight wing, nose propeller, and separate tail surfaces." },
  { value: "fixed-wing-trainer", label: "High-wing Trainer", rotorCount: 1, propulsionMotorCount: 1, simulatorFrame: "plane", vehicle: "ArduPlane", visualKind: "high-wing", dimensions: { spanM: 1.5, lengthM: 1.1, heightM: 0.4 }, description: "High-mounted wing and wheeled landing gear for training concepts.", simulatorApproximation: "Uses the standard Plane model; trainer geometry does not change its aerodynamic coefficients." },
  { value: "fixed-wing-flying-wing", label: "Flying Wing / Elevon", rotorCount: 1, propulsionMotorCount: 1, simulatorFrame: "plane-elevon", vehicle: "ArduPlane", visualKind: "flying-wing", dimensions: { spanM: 1.6, lengthM: 0.7, heightM: 0.18 }, description: "Swept tailless wing with rear pusher propulsion and elevon control." },
  { value: "fixed-wing-vtail", label: "V-tail Survey Plane", rotorCount: 1, propulsionMotorCount: 1, simulatorFrame: "plane-vtail", vehicle: "ArduPlane", visualKind: "vtail", dimensions: { spanM: 2.1, lengthM: 1.3, heightM: 0.38 }, description: "Survey concept with two canted tail surfaces and V-tail mixing." },
  { value: "fixed-wing-glider", label: "Motor Glider / Soaring", rotorCount: 1, propulsionMotorCount: 1, simulatorFrame: "plane-soaring", vehicle: "ArduPlane", visualKind: "glider", dimensions: { spanM: 3, lengthM: 1.35, heightM: 0.28 }, description: "Long-span motor glider with a powered climb and soaring configuration." },
  { value: "fixed-wing-twin-boom", label: "Twin-boom Pusher", rotorCount: 1, propulsionMotorCount: 1, simulatorFrame: "plane", vehicle: "ArduPlane", visualKind: "twin-boom", dimensions: { spanM: 2.2, lengthM: 1.4, heightM: 0.35 }, description: "Twin tail booms leave the centerline clear for a rear pusher propeller.", simulatorApproximation: "Uses the standard Plane model; the twin-boom envelope is a design visualization." },
  { value: "quadplane", label: "QuadPlane Lift + Cruise", rotorCount: 5, propulsionMotorCount: 5, simulatorFrame: "quadplane", vehicle: "ArduPlane", visualKind: "quadplane", dimensions: { spanM: 2.3, lengthM: 1.5, heightM: 0.46 }, description: "Four vertical lift motors and one cruise propeller with native QuadPlane SITL." }
];

const roverAirframes: AirframeOption[] = [
  { value: "rover", label: "Rover", rotorCount: 0, propulsionMotorCount: 1, simulatorFrame: "rover", vehicle: "Rover", visualKind: "ackermann", wheelCount: 4, dimensions: { spanM: 0.48, lengthM: 0.7, heightM: 0.3 }, description: "Four-wheel rover with a single drive channel and front steering." },
  { value: "rover-buggy", label: "Off-road Buggy", rotorCount: 0, propulsionMotorCount: 1, simulatorFrame: "rover", vehicle: "Rover", visualKind: "buggy", wheelCount: 4, dimensions: { spanM: 0.62, lengthM: 0.85, heightM: 0.45 }, description: "Wide wheels, raised suspension, and a protective cage for an off-road concept.", simulatorApproximation: "Uses standard Rover steering dynamics; suspension and terrain contact are conceptual." },
  { value: "rover-skid", label: "Skid-steer 4WD", rotorCount: 0, propulsionMotorCount: 2, simulatorFrame: "rover-skid", vehicle: "Rover", visualKind: "skid", wheelCount: 4, dimensions: { spanM: 0.65, lengthM: 0.78, heightM: 0.3 }, description: "Independent left and right drive channels turn a four-wheel chassis." },
  { value: "rover-tracked", label: "Tracked Crawler", rotorCount: 0, propulsionMotorCount: 2, simulatorFrame: "rover-skid", vehicle: "Rover", visualKind: "tracked", wheelCount: 0, dimensions: { spanM: 0.65, lengthM: 0.9, heightM: 0.32 }, description: "Two continuous tracks with differential drive for crawler concepts.", simulatorApproximation: "Uses Rover skid-steering; individual track contact and slip are not modeled by the visual shape." },
  { value: "rover-6x6", label: "Six-wheel Explorer", rotorCount: 0, propulsionMotorCount: 2, simulatorFrame: "rover-skid", vehicle: "Rover", visualKind: "six-wheel", wheelCount: 6, dimensions: { spanM: 0.8, lengthM: 1.2, heightM: 0.42 }, description: "Six-wheel exploration chassis with grouped left and right drive channels.", simulatorApproximation: "Uses Rover skid-steering; the six-wheel suspension is a design visualization." },
  { value: "rover-balancebot", label: "Two-wheel Balance Bot", rotorCount: 0, propulsionMotorCount: 2, simulatorFrame: "balancebot", vehicle: "Rover", visualKind: "balancebot", wheelCount: 2, dimensions: { spanM: 0.4, lengthM: 0.24, heightM: 0.5 }, description: "Upright two-wheel platform using the native BalanceBot SITL model." }
];

export const airframeOptions: AirframeOption[] = [...rotorAirframes, ...numericAirframes, ...fixedWingAirframes, ...roverAirframes];
export const airframeValues = airframeOptions.map((option) => option.value);

export function airframeOption(frame: string | undefined): AirframeOption {
  return airframeOptions.find((option) => option.value === normalizeAirframeValue(frame))!;
}

export function propulsionMotorCountForFrame(frame: string | undefined): number {
  const option = airframeOption(frame);
  return option.propulsionMotorCount ?? option.rotorCount;
}

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

/**
 * Several lab airframes share one SITL model (Dual Rotor and Quad X both use
 * "quad"). A bare simulator name means that model's native frame, so prefer
 * the "<model>-x" airframe before falling back to the first match.
 */
function airframeForSimulatorFrame(simulatorFrame: string): AirframeOption | undefined {
  return airframeOptions.find((option) => option.simulatorFrame === simulatorFrame && option.value === `${simulatorFrame}-x`)
    ?? airframeOptions.find((option) => option.simulatorFrame === simulatorFrame);
}

export function normalizeAirframeValue(frame: string | undefined): string {
  const normalized = String(frame ?? "")
    .trim()
    .toLowerCase();
  const direct = airframeOptions.find((option) => option.value === normalized || option.label.toLowerCase() === normalized);
  if (direct) {
    return direct.value;
  }
  const bySimulator = airframeForSimulatorFrame(normalized);
  if (bySimulator) return bySimulator.value;
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
  const bySimulator = airframeForSimulatorFrame(normalized);
  if (bySimulator) return bySimulator.rotorCount;

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
  return airframeOption(frame).simulatorFrame;
}
