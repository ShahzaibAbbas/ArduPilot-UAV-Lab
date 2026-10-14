import { Bounds, GizmoHelper, GizmoViewport, Grid, OrbitControls, useBounds } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, type ComponentRef, type RefObject } from "react";
import type { DesignEdge } from "../../domain/design";
import { attitudeRotation, type FlightDynamicsState } from "../../lib/three/flightDynamics";
import { ComponentMesh } from "./ComponentMesh";
import { ConnectionPath } from "./ConnectionPath";
import type { SceneNode } from "./sceneTypes";

interface ThreeSceneProps {
  sceneNodes: SceneNode[];
  edges: DesignEdge[];
  selectedNodeId: string | null;
  showLabels: boolean;
  showWires: boolean;
  reducedMotion: boolean;
  dynamics?: FlightDynamicsState | null;
  fitToken: number;
  resetToken: number;
  onSelectNode: (nodeId: string) => void;
  onHover: (sceneNode: SceneNode | null) => void;
}

function FitScene({ token, membership, hasNodes }: { token: number; membership: string; hasNodes: boolean }) {
  const bounds = useBounds();
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (!hasNodes) return;
    let fitFrame = 0;
    // Allow the canvas to commit new visibility and world matrices before measuring.
    const layoutFrame = requestAnimationFrame(() => {
      invalidate();
      fitFrame = requestAnimationFrame(() => { bounds.refresh().clip().fit(); invalidate(); });
    });
    return () => { cancelAnimationFrame(layoutFrame); cancelAnimationFrame(fitFrame); };
  }, [bounds, invalidate, token, membership, hasNodes]);
  return null;
}

type SceneControls = ComponentRef<typeof OrbitControls>;

function ResetCamera({ token, controls }: { token: number; controls: RefObject<SceneControls | null> }) {
  const { camera, invalidate } = useThree();
  useEffect(() => {
    if (token === 0) return;
    controls.current?.target.set(0, 0, 0);
    camera.position.set(8, 7, 9);
    camera.near = 0.1;
    camera.far = 120;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.current?.update();
    invalidate();
  }, [camera, controls, invalidate, token]);
  return null;
}

export function ThreeScene({
  sceneNodes,
  edges,
  selectedNodeId,
  showLabels,
  showWires,
  reducedMotion,
  dynamics,
  fitToken,
  resetToken,
  onSelectNode,
  onHover
}: ThreeSceneProps) {
  const controls = useRef<SceneControls>(null);
  const transforms = new Map(sceneNodes.map((entry) => [entry.node.id, entry.transform]));
  const membership = JSON.stringify(sceneNodes.map((entry) => [entry.node.id, entry.node.data.properties.layout]));
  const vehicleRotation: [number, number, number] = dynamics?.source === "telemetry" && !dynamics.stale
    ? attitudeRotation(dynamics)
    : [0, 0, 0];
  return (
    <>
      <color attach="background" args={["#dfe6ed"]} />
      <hemisphereLight args={["#ffffff", "#8494a9", 1.4]} />
      <directionalLight castShadow position={[-5, 12, -7]} intensity={2.1} shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-18} shadow-camera-right={18} shadow-camera-top={18} shadow-camera-bottom={-18} shadow-normalBias={0.035} />
      <directionalLight position={[7, 4, 5]} intensity={0.65} color="#c7e4ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} /><meshStandardMaterial color="#e2e8ee" roughness={0.92} />
      </mesh>

      <Grid
        args={[80, 80]}
        position={[0, -0.15, 0]}
        cellSize={0.5}
        cellThickness={0.55}
        cellColor="#bdcbd7"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#a5b6c6"
        fadeDistance={24}
        fadeStrength={1}
        infiniteGrid
      />

      <Bounds clip observe margin={1.25} maxDuration={reducedMotion ? 0 : 0.35}>
        <FitScene token={fitToken} membership={membership} hasNodes={sceneNodes.length > 0} />
        <group rotation={vehicleRotation}>
          {showWires
            ? edges.map((edge) => {
                const source = transforms.get(edge.source);
                const target = transforms.get(edge.target);
                return source && target ? <ConnectionPath key={edge.id} edge={edge} source={source} target={target} /> : null;
              })
            : null}
          {sceneNodes.map((sceneNode) => (
            <ComponentMesh
              key={sceneNode.node.id}
              sceneNode={sceneNode}
              selected={sceneNode.node.id === selectedNodeId}
              showLabel={showLabels}
              dynamics={dynamics}
              reducedMotion={reducedMotion}
              onSelect={onSelectNode}
              onHover={onHover}
            />
          ))}
        </group>
      </Bounds>

      <OrbitControls ref={controls} makeDefault enableDamping={!reducedMotion} dampingFactor={0.08} minDistance={0.1} maxDistance={50_000} />
      <ResetCamera token={resetToken} controls={controls} />
      <GizmoHelper alignment="bottom-right" margin={[74, 74]}>
        <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#e2e8f0" />
      </GizmoHelper>
    </>
  );
}
