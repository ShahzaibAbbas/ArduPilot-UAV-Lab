import { useEffect, useMemo } from "react";
import { ExtrudeGeometry, Shape, Vector3, Quaternion } from "three";
import { airframeOption } from "../../domain/airframes";
import { AeroFlow } from "./AeroFlow";
import type { FlightDynamicsState } from "../../lib/three/flightDynamics";

const shell = "#e8edf1";
const carbon = "#263548";
const rubber = "#17202b";
const metal = "#8296a9";

function Solid({ color = shell, metalness = 0.2 }: { color?: string; metalness?: number }) {
  return <meshStandardMaterial color={color} metalness={metalness} roughness={0.48} />;
}

export function Rod({ from, to, radius = 0.045, color = carbon }: {
  from: [number, number, number]; to: [number, number, number]; radius?: number; color?: string;
}) {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const direction = end.clone().sub(start);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
  return <mesh position={start.add(end).multiplyScalar(0.5)} quaternion={rotation} castShadow>
    <cylinderGeometry args={[radius, radius, direction.length(), 10]} /><Solid color={color} metalness={0.5} />
  </mesh>;
}

function Planform({ outline, y = 0, thickness = 0.055, color = shell }: {
  outline: Array<[number, number]>; y?: number; thickness?: number; color?: string;
}) {
  const key = JSON.stringify(outline);
  const geometry = useMemo(() => {
    const points = JSON.parse(key) as Array<[number, number]>;
    const shape = new Shape();
    points.forEach(([x, z], index) => index ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
    shape.closePath();
    return new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.012, bevelThickness: 0.012 });
  }, [key, thickness]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow><Solid color={color} /></mesh>;
}

function Propeller({ position, radius = 0.5, forward = false, color = carbon }: {
  position: [number, number, number]; radius?: number; forward?: boolean; color?: string;
}) {
  return <group position={position} rotation={forward ? [Math.PI / 2, 0, 0] : [0, 0.35, 0]}>
    <mesh castShadow><cylinderGeometry args={[0.07, 0.09, 0.13, 14]} /><Solid color={metal} metalness={0.75} /></mesh>
    {[0, Math.PI].map((angle) => <group key={angle} rotation={[0, angle, 0]}>
      <mesh position={[radius * 0.48, 0.065, 0]} rotation={[0, -0.12, 0]} castShadow>
        <boxGeometry args={[radius, 0.025, radius * 0.13]} /><Solid color={color} />
      </mesh>
    </group>)}
  </group>;
}

function Tail({ kind, accent }: { kind: string; accent: string }) {
  if (kind === "vtail") return <group position={[0, 0.08, 1.4]}>
    {[-1, 1].map(side => <mesh key={side} position={[side * 0.32, 0.28, 0]} rotation={[0, 0, side * 0.75]} castShadow>
      <boxGeometry args={[0.85, 0.055, 0.42]} /><Solid color={shell} />
    </mesh>)}
  </group>;
  return <group>
    <Planform outline={[[-0.8, 1.35], [0, 1.13], [0.8, 1.35], [0.74, 1.7], [-0.74, 1.7]]} y={0.12} />
    <mesh position={[0, 0.39, 1.45]} rotation={[-0.25, 0, 0]} castShadow><boxGeometry args={[0.055, 0.6, 0.46]} /><Solid color={accent} /></mesh>
  </group>;
}

function Aircraft({ kind, accent }: { kind: string; accent: string }) {
  const flyingWing = kind === "flying-wing";
  const glider = kind === "glider";
  const twin = kind === "twin-boom";
  const span = glider ? 3.6 : flyingWing ? 2.5 : 2.35;
  const wingHeight = kind === "high-wing" || twin ? 0.26 : 0.04;
  const outline: Array<[number, number]> = flyingWing
    ? [[0, -1.18], [span, 0.72], [span, 1.1], [0.38, 0.6], [0, 0.8], [-0.38, 0.6], [-span, 1.1], [-span, 0.72]]
    : [[-span, 0.08], [-0.25, -0.28], [0.25, -0.28], [span, 0.08], [span - 0.12, glider ? 0.43 : 0.68], [-span + 0.12, glider ? 0.43 : 0.68]];
  return <group scale={glider ? [1, 1, 1.13] : 1}>
    <Planform outline={outline} y={wingHeight} thickness={0.065} />
    {[-1, 1].map(side => <group key={side}>
      <Planform outline={[[side * (span - 0.35), flyingWing ? 0.61 : 0.06], [side * span, flyingWing ? 0.72 : 0.08], [side * (span - 0.03), flyingWing ? 1.08 : 0.48], [side * (span - 0.35), flyingWing ? 0.99 : 0.51]]} y={wingHeight + 0.07} thickness={0.012} color={accent} />
      {flyingWing ? <mesh position={[side * (span - 0.05), 0.18, 0.82]} castShadow><boxGeometry args={[0.035, 0.42, 0.36]} /><Solid color={accent} /></mesh> : null}
      {kind === "high-wing" ? <Rod from={[side * 0.12, -0.12, 0]} to={[side * 1.35, wingHeight, 0.3]} radius={0.024} color={metal} /> : null}
    </group>)}
    <mesh position={[0, 0.02, flyingWing ? 0 : -0.15]} scale={flyingWing ? [0.22, 0.18, 0.7] : twin ? [0.28, 0.24, 0.9] : [glider ? 0.15 : 0.23, 0.23, 1.8]} castShadow receiveShadow>
      <sphereGeometry args={[1, 28, 16]} /><Solid />
    </mesh>
    <mesh position={[0, 0.21, -0.55]} scale={[0.17, 0.13, flyingWing ? 0.32 : 0.47]} castShadow>
      <sphereGeometry args={[1, 20, 12]} /><meshStandardMaterial color="#244b66" metalness={0.55} roughness={0.18} />
    </mesh>
    {twin ? <group>{[-0.8, 0.8].map(x => <group key={x}>
      <Rod from={[x, 0.12, -0.12]} to={[x, 0.12, 1.72]} radius={0.055} />
      <mesh position={[x, 0.36, 1.48]} castShadow><boxGeometry args={[0.045, 0.52, 0.43]} /><Solid color={accent} /></mesh>
    </group>)}<Planform outline={[[-0.9, 1.35], [0.9, 1.35], [0.9, 1.75], [-0.9, 1.75]]} y={0.15} />
      <Propeller position={[0, 0.08, 0.9]} radius={0.54} forward />
    </group>
      : flyingWing ? <Propeller position={[0, 0.06, 0.85]} radius={0.45} forward />
        : <><Tail kind={kind} accent={accent} /><Propeller position={[0, 0.01, -1.96]} radius={glider ? 0.36 : 0.52} forward /></>}
    {kind === "quadplane" ? [-1, 1].flatMap(x => [-1, 1].map(z => <group key={`${x}-${z}`}>
      <Rod from={[x * 0.96, -0.05, -0.88]} to={[x * 0.96, -0.05, 1.08]} radius={0.05} />
      <Propeller position={[x * 0.96, 0.17, z * 0.9]} radius={0.54} color={z < 0 ? accent : carbon} />
    </group>)) : null}
  </group>;
}

function Wheel({ x, z, radius = 0.34 }: { x: number; z: number; radius?: number }) {
  return <group position={[x, -0.12, z]} rotation={[0, 0, Math.PI / 2]}>
    <mesh castShadow receiveShadow><cylinderGeometry args={[radius, radius, 0.23, 24]} /><Solid color={rubber} metalness={0.02} /></mesh>
    <mesh><cylinderGeometry args={[radius * 0.51, radius * 0.51, 0.245, 12]} /><Solid color={metal} metalness={0.7} /></mesh>
    <mesh><cylinderGeometry args={[radius * 0.15, radius * 0.15, 0.27, 12]} /><Solid color={carbon} /></mesh>
    {Array.from({ length: 12 }, (_, index) => <mesh key={index} position={[Math.cos(index * Math.PI / 6) * radius, 0, Math.sin(index * Math.PI / 6) * radius]} rotation={[0, -index * Math.PI / 6, 0]} castShadow>
      <boxGeometry args={[0.07, 0.24, 0.12]} /><Solid color={rubber} metalness={0} />
    </mesh>)}
  </group>;
}

function Rover({ kind, accent }: { kind: string; accent: string }) {
  const balance = kind === "balancebot";
  const tracked = kind === "tracked";
  const six = kind === "six-wheel";
  const buggy = kind === "buggy";
  const positions = balance ? [0] : six || tracked ? [-0.86, 0, 0.86] : [-0.77, 0.77];
  return <group>
    <mesh position={[0, balance ? 0.33 : 0.08, 0]} castShadow receiveShadow><boxGeometry args={[balance ? 0.82 : 1.35, balance ? 0.95 : 0.32, balance ? 0.52 : 2.2]} /><Solid color={carbon} metalness={0.42} /></mesh>
    <mesh position={[0, balance ? 0.83 : 0.27, 0]} castShadow><boxGeometry args={[balance ? 0.88 : 1.37, 0.075, balance ? 0.55 : 2.18]} /><Solid color={accent} /></mesh>
    {[-1, 1].flatMap(side => positions.map(z => <Wheel key={`${side}-${z}`} x={side * (balance ? 0.57 : 0.84)} z={z} radius={tracked ? 0.28 : buggy ? 0.4 : 0.34} />))}
    {tracked ? [-1, 1].flatMap(side => [-1, 1].map(y => <mesh key={`${side}-${y}`} position={[side * 0.84, -0.12 + y * 0.3, 0]} castShadow>
      <boxGeometry args={[0.34, 0.09, 2]} /><Solid color={rubber} metalness={0} />
    </mesh>)) : null}
    {buggy ? [-1, 1].flatMap(side => [
      <Rod key={`${side}-front`} from={[side * 0.57, 0.25, -0.7]} to={[side * 0.48, 0.82, -0.25]} radius={0.038} color={metal} />,
      <Rod key={`${side}-rear`} from={[side * 0.48, 0.82, -0.25]} to={[side * 0.57, 0.25, 0.75]} radius={0.038} color={metal} />,
      <Rod key={`${side}-top`} from={[-0.48, 0.82, -0.25]} to={[0.48, 0.82, -0.25]} radius={0.035} color={metal} />
    ]) : <mesh position={[0, balance ? 1 : 0.44, 0.12]} castShadow><boxGeometry args={[0.56, 0.3, 0.72]} /><Solid color={shell} /></mesh>}
    {[-1, 1].map(side => <mesh key={side} position={[side * (balance ? 0.24 : 0.43), balance ? 0.6 : 0.17, balance ? -0.28 : -1.12]}><boxGeometry args={[0.16, 0.1, 0.04]} /><meshStandardMaterial color="#d4f5ff" emissive="#67cfff" emissiveIntensity={0.7} /></mesh>)}
    {!balance ? <Rod from={[0.34, 0.3, 0.73]} to={[0.34, 1.05, 0.73]} radius={0.018} /> : null}
  </group>;
}

function Multirotor({ count, accent }: { count: number; accent: string }) {
  const radius = count > 8 ? 2 : 1.55;
  if (count === 1) return <group>
    <mesh scale={[0.34, 0.36, 0.8]} castShadow><sphereGeometry args={[1, 24, 16]} /><Solid color={accent} /></mesh>
    <mesh position={[0, 0.12, -0.45]} scale={[0.28, 0.26, 0.38]} castShadow><sphereGeometry args={[1, 20, 12]} /><Solid color="#244b66" metalness={0.5} /></mesh>
    <Rod from={[0, 0.04, 0.6]} to={[0, 0.25, 2]} radius={0.045} />
    <Rod from={[0, 0.25, 0]} to={[0, 0.58, 0]} radius={0.04} color={metal} />
    <Propeller position={[0, 0.62, 0]} radius={1.7} />
    <group position={[0, 0.25, 1.9]} rotation={[0, 0, Math.PI / 2]}><Propeller position={[0, 0, 0]} radius={0.25} /></group>
    {[-0.36, 0.36].map(x => <group key={x}>
      <Rod from={[x, -0.5, -0.68]} to={[x, -0.5, 0.68]} radius={0.028} color={metal} />
      <Rod from={[0, -0.15, 0]} to={[x, -0.5, 0]} radius={0.023} color={metal} />
    </group>)}
  </group>;
  return <group>
    <mesh castShadow receiveShadow><cylinderGeometry args={[0.48, 0.43, 0.22, count === 4 ? 4 : 8]} /><Solid color={carbon} metalness={0.45} /></mesh>
    <mesh position={[0, 0.16, 0]} castShadow><boxGeometry args={[0.6, 0.12, 0.8]} /><Solid color={accent} /></mesh>
    {Array.from({ length: count }, (_, index) => {
      const angle = index * Math.PI * 2 / count + Math.PI / 4;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      return <group key={index}>
        <Rod from={[0, 0, 0]} to={[x, 0, z]} radius={0.052} />
        <Propeller position={[x, 0.16, z]} radius={Math.min(0.55, Math.PI * radius / count * 0.8)} color={z < 0 ? accent : carbon} />
      </group>;
    })}
    {[-0.38, 0.38].map(x => <group key={x}>
      <Rod from={[x, 0, -0.35]} to={[x, -0.36, -0.5]} radius={0.025} color={metal} />
      <Rod from={[x, -0.36, -0.65]} to={[x, -0.36, 0.65]} radius={0.025} color={metal} />
    </group>)}
  </group>;
}

export function AirframeMesh({ frame, accent, dynamics, reducedMotion = false }: {
  frame: string;
  accent: string;
  dynamics?: FlightDynamicsState | null;
  reducedMotion?: boolean;
}) {
  const option = airframeOption(frame);
  const model = option.vehicle === "ArduPlane"
    ? <Aircraft kind={option.visualKind ?? "conventional"} accent={accent} />
    : option.vehicle === "Rover"
      ? <Rover kind={option.visualKind ?? "ackermann"} accent={accent} />
      : <Multirotor count={option.rotorCount} accent={accent} />;
  return <>
    {model}
    {dynamics ? <AeroFlow dynamics={dynamics} reducedMotion={reducedMotion} /> : null}
  </>;
}
