import type { DesignNode } from "../../domain/design";
import { geometryForComponent } from "../../lib/three/geometryFactory";

function Material({ color, metal = false }: { color: string; metal?: boolean }) {
  return <meshStandardMaterial color={color} metalness={metal ? 0.65 : 0.12} roughness={metal ? 0.32 : 0.55} />;
}

function Board({ color, type }: { color: string; type: string }) {
  return <group>
    <mesh castShadow receiveShadow><boxGeometry args={[0.84, 0.07, 0.65]} /><Material color="#17675e" /></mesh>
    <mesh position={[0, 0.11, 0]} castShadow><boxGeometry args={[0.34, 0.15, 0.3]} /><Material color="#243244" /></mesh>
    {[-1, 1].flatMap(side => Array.from({ length: 6 }, (_, index) => <mesh key={`${side}-${index}`} position={[side * 0.32, 0.085, -0.23 + index * 0.09]}>
      <boxGeometry args={[0.065, 0.08, 0.035]} /><Material color="#dab96e" metal />
    </mesh>))}
    {[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`${x}-${z}`} position={[x * 0.36, 0.035, z * 0.27]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.018, 0.032, 10]} /><Material color="#b8c7cb" metal />
    </mesh>))}
    <mesh position={[0.27, 0.08, -0.15]}><boxGeometry args={[0.04, 0.035, 0.055]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} /></mesh>
    {type === "flight-controller" ? <mesh position={[0, 0.19, -0.05]} rotation={[-Math.PI / 2, 0, 0]}><coneGeometry args={[0.065, 0.12, 3]} /><Material color="#e9f1f7" /></mesh> : null}
  </group>;
}

export function HardwareMesh({ node, color }: { node: DesignNode; color: string }) {
  const type = node.data.componentType;
  if (["flight-controller", "companion-computer", "power-distribution-board", "compass"].includes(type)) return <Board color={color} type={type} />;
  if (type === "battery") return <group>
    <mesh castShadow receiveShadow><boxGeometry args={[0.76, 0.38, 1.04]} /><Material color="#303d52" /></mesh>
    {[-0.28, 0.28].map(z => <mesh key={z} position={[0, 0.005, z]} castShadow><boxGeometry args={[0.78, 0.4, 0.13]} /><Material color="#101b2b" /></mesh>)}
    <mesh position={[0, 0.198, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.53, 0.24]} /><Material color={color} /></mesh>
    <mesh position={[0.2, 0, -0.62]}><boxGeometry args={[0.15, 0.13, 0.2]} /><Material color="#e5b64a" /></mesh>
  </group>;
  if (type === "motor") {
    const ground = node.data.properties.propulsionRole === "Ground drive";
    return <group rotation={ground ? [Math.PI / 2, 0, 0] : [0, 0, 0]}>
      <mesh castShadow><cylinderGeometry args={[0.2, 0.22, 0.3, 24]} /><Material color="#344256" metal /></mesh>
      <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.222, 0.222, 0.045, 24]} /><Material color="#b9773f" metal /></mesh>
      <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.04, 0.04, 0.15, 12]} /><Material color="#a5b8c9" metal /></mesh>
      {!ground ? <mesh position={[0, 0.23, 0]} rotation={[0, 0.4, 0]} castShadow><boxGeometry args={[0.9, 0.025, 0.08]} /><Material color="#253246" /></mesh> : null}
    </group>;
  }
  if (type === "gps" || type === "buzzer") return <group>
    <mesh castShadow><cylinderGeometry args={[type === "gps" ? 0.29 : 0.16, 0.25, 0.13, 28]} /><Material color={type === "gps" ? "#e1e7ec" : "#263446"} /></mesh>
    <mesh position={[0, 0.071, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.08, 0.11, 24]} /><Material color={color} /></mesh>
  </group>;
  if (["camera", "rangefinder", "optical-flow"].includes(type)) return <group>
    <mesh castShadow><boxGeometry args={[0.58, 0.38, 0.35]} /><Material color="#384559" /></mesh>
    <mesh position={[0, 0, -0.25]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.14, 0.17, 0.22, 24]} /><Material color="#172233" /></mesh>
    <mesh position={[0, 0, -0.366]}><circleGeometry args={[0.11, 24]} /><meshStandardMaterial color="#326b94" metalness={0.72} roughness={0.1} side={2} /></mesh>
  </group>;
  if (type === "esc") return <group>
    <mesh castShadow><boxGeometry args={[0.72, 0.16, 0.38]} /><Material color="#243245" /></mesh>
    {Array.from({ length: 7 }, (_, index) => <mesh key={index} position={[-0.25 + index * 0.08, 0.105, 0]} castShadow><boxGeometry args={[0.035, 0.09, 0.36]} /><Material color="#78889b" metal /></mesh>)}
  </group>;
  if (type === "telemetry-radio" || type === "virtual-telemetry" || type === "rc-receiver") return <group>
    <mesh castShadow><boxGeometry args={[0.38, 0.2, 0.6]} /><Material color="#303f50" /></mesh>
    <mesh position={[0.1, 0.35, -0.23]} rotation={[0.1, 0, -0.18]} castShadow><cylinderGeometry args={[0.018, 0.026, 0.67, 10]} /><Material color="#172333" /></mesh>
    <mesh position={[-0.1, 0.105, 0.15]}><boxGeometry args={[0.045, 0.02, 0.06]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.65} /></mesh>
  </group>;
  if (type === "servo") return <group>
    <mesh castShadow><boxGeometry args={[0.3, 0.38, 0.5]} /><Material color="#30496d" /></mesh>
    <mesh position={[0, 0.25, -0.11]} castShadow><boxGeometry args={[0.56, 0.04, 0.09]} /><Material color="#e5ebed" /></mesh>
    <mesh position={[0, 0.21, -0.11]}><cylinderGeometry args={[0.06, 0.06, 0.1, 12]} /><Material color="#bdc9d6" metal /></mesh>
  </group>;
  const geometry = geometryForComponent(type);
  return <mesh castShadow receiveShadow><boxGeometry args={geometry.size} /><Material color={color} /></mesh>;
}
