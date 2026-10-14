import { Html } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import type { ComponentDefinition } from "../../domain/design";
import { componentCatalog } from "../../domain/componentCatalog";
import { geometryForComponent } from "../../lib/three/geometryFactory";
import type { SceneNode } from "./sceneTypes";
import { AirframeMesh } from "./AirframeMesh";
import { HardwareMesh } from "./HardwareMesh";
import { airframeOption } from "../../domain/airframes";
import { airframeModelScale } from "../../lib/three/airframeGeometry";
import type { FlightDynamicsState } from "../../lib/three/flightDynamics";

const categoryColors: Record<ComponentDefinition["category"], string> = {
  Core: "#38bdf8",
  Power: "#f59e0b",
  Propulsion: "#fb7185",
  Sensors: "#4ade80",
  Comms: "#2dd4bf",
  Payload: "#c084fc",
  Safety: "#facc15"
};

interface ComponentMeshProps {
  sceneNode: SceneNode;
  selected: boolean;
  showLabel: boolean;
  dynamics?: FlightDynamicsState | null;
  reducedMotion: boolean;
  onSelect: (nodeId: string) => void;
  onHover: (sceneNode: SceneNode | null) => void;
}

export function ComponentMesh({ sceneNode, selected, showLabel, dynamics, reducedMotion, onSelect, onHover }: ComponentMeshProps) {
  const definition = useMemo(() => componentCatalog.find((entry) => entry.type === sceneNode.node.data.componentType), [sceneNode.node.data.componentType]);
  const geometry = useMemo(() => geometryForComponent(sceneNode.node.data.componentType), [sceneNode.node.data.componentType]);
  const isFrame = sceneNode.node.data.componentType === "frame";
  const frame = String(sceneNode.node.data.properties.layout ?? "quad-x");
  const ringRadius = isFrame ? (airframeOption(frame).visualKind === "glider" ? 3.85 : airframeOption(frame).vehicle === "Rover" ? 1.48 : 2.6) : Math.max(...geometry.size) * 0.65;
  const color =
    sceneNode.node.data.health === "error"
      ? "#ef4444"
      : sceneNode.node.data.health === "warning"
        ? "#f97316"
        : categoryColors[definition?.category ?? "Core"];
  const position: [number, number, number] = [
    sceneNode.transform.position.x,
    sceneNode.transform.position.y,
    sceneNode.transform.position.z
  ];
  const rotation: [number, number, number] = [
    sceneNode.transform.rotation.x,
    sceneNode.transform.rotation.y,
    sceneNode.transform.rotation.z
  ];
  const scale: [number, number, number] = [sceneNode.transform.scale.x, sceneNode.transform.scale.y, sceneNode.transform.scale.z];

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(sceneNode.node.id);
  };

  return (
    <group
      position={position}
      rotation={rotation}
      scale={scale}
      onClick={select}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(sceneNode);
      }}
      onPointerOut={() => onHover(null)}
    >
      {isFrame ? <group scale={airframeModelScale(frame, sceneNode.node.data.properties)}><AirframeMesh frame={frame} accent={color} dynamics={dynamics} reducedMotion={reducedMotion} /></group> : <HardwareMesh node={sceneNode.node} color={color} />}

      {selected ? (
        <mesh position={[0, -0.39, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringRadius, ringRadius + 0.045, 64]} />
          <meshBasicMaterial color="#0284c7" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      ) : null}

      {showLabel ? (
        <Html
          position={[0, isFrame ? 1.35 : 0.65, 0]}
          center
          style={{ pointerEvents: "none" }}
          zIndexRange={[20, 0]}
        >
          <span className="three-component-label" aria-hidden="true">{sceneNode.node.data.label}</span>
        </Html>
      ) : null}
    </group>
  );
}
