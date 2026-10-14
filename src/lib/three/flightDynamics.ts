/**
 * The small, render-friendly subset of vehicle dynamics used by the concept
 * geometry view.  Keeping this separate from the telemetry API means the 3D
 * workspace can also render the configured wind/aero estimate when no vehicle
 * is connected.
 */
export interface FlightDynamicsState {
  source: "telemetry" | "concept";
  connected: boolean;
  stale: boolean;
  ageMs?: number;
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  airspeedMps: number;
  groundspeedMps: number;
  climbMps: number;
  throttlePercent: number;
  windSpeedMps: number;
  windGustMps: number;
}

const finite = (value: unknown, fallback = 0) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function degreesToRadians(value: number) {
  return finite(value) * Math.PI / 180;
}

/** Maps aircraft attitude into Three.js's x=pitch, y=yaw, z=roll axes. */
export function attitudeRotation(state: Pick<FlightDynamicsState, "rollDeg" | "pitchDeg" | "yawDeg">): [number, number, number] {
  return [degreesToRadians(state.pitchDeg), degreesToRadians(state.yawDeg), degreesToRadians(state.rollDeg)];
}

/** Returns a bounded visual speed so a bad packet cannot create a huge mesh. */
export function aerodynamicFlowLength(state: Pick<FlightDynamicsState, "airspeedMps" | "groundspeedMps" | "windSpeedMps" | "windGustMps">) {
  const vehicleSpeed = Math.max(finite(state.airspeedMps), finite(state.groundspeedMps));
  const apparentWind = Math.max(finite(state.windSpeedMps), finite(state.windGustMps));
  return clamp(0.65 + (vehicleSpeed + apparentWind) * 0.055, 0.65, 3.4);
}

export function normalizeFlightDynamics(input: Partial<FlightDynamicsState> | null | undefined): FlightDynamicsState {
  return {
    source: input?.source === "telemetry" ? "telemetry" : "concept",
    connected: input?.connected === true,
    stale: input?.stale === true,
    ageMs: Number.isFinite(input?.ageMs) ? input?.ageMs : undefined,
    rollDeg: clamp(finite(input?.rollDeg), -180, 180),
    pitchDeg: clamp(finite(input?.pitchDeg), -90, 90),
    yawDeg: clamp(finite(input?.yawDeg), -360, 360),
    airspeedMps: clamp(finite(input?.airspeedMps), 0, 120),
    groundspeedMps: clamp(finite(input?.groundspeedMps), 0, 120),
    climbMps: clamp(finite(input?.climbMps), -80, 80),
    throttlePercent: clamp(finite(input?.throttlePercent), 0, 100),
    windSpeedMps: clamp(finite(input?.windSpeedMps), 0, 80),
    windGustMps: clamp(finite(input?.windGustMps), 0, 100)
  };
}
