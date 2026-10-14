import { useMemo } from "react";
import { aerodynamicFlowLength, type FlightDynamicsState } from "../../lib/three/flightDynamics";

interface AeroFlowProps {
  dynamics: FlightDynamicsState;
  reducedMotion: boolean;
}

/** A lightweight, bounded airflow cue that follows the vehicle attitude. */
export function AeroFlow({ dynamics, reducedMotion }: AeroFlowProps) {
  const length = aerodynamicFlowLength(dynamics);
  const gust = Math.max(0, dynamics.windGustMps - dynamics.windSpeedMps);
  const count = reducedMotion ? 3 : 5;
  const lanes = useMemo(() => Array.from({ length: count }, (_, index) => index - (count - 1) / 2), [count]);
  const color = dynamics.source === "telemetry" ? "#22d3ee" : "#60a5fa";
  const gustColor = dynamics.source === "telemetry" ? "#fbbf24" : "#a5b4fc";

  return (
    <group position={[0, 0.08, 0]}>
      {lanes.map((lane) => (
        <group key={lane} position={[lane * 0.22, lane * 0.025, length * 0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.012, 0.012, length, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <mesh position={[0, length * 0.5, 0]}>
            <coneGeometry args={[0.06, 0.16, 8]} />
            <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {gust > 0.2 ? (
        <group position={[0.72, 0.12, length * 0.48]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh>
            <cylinderGeometry args={[0.018, 0.018, Math.min(length * 1.12, 3.8), 8]} />
            <meshBasicMaterial color={gustColor} transparent opacity={0.58} depthWrite={false} />
          </mesh>
        </group>
      ) : null}
    </group>
  );
}
