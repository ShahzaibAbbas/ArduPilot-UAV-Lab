import { useEffect, useMemo, useRef } from "react";
import type { DesignNode } from "../../domain/design";
import type { FlightDynamicsState } from "../../lib/three/flightDynamics";
import { attitudeRotation } from "../../lib/three/flightDynamics";
import { geometryForComponent } from "../../lib/three/geometryFactory";
import { resolveSceneNodes } from "../three/sceneLayout";

interface LayaAirBridgeProps {
  nodes: DesignNode[];
  selectedNodeId: string | null;
  dynamics?: FlightDynamicsState | null;
  onSelectNode: (nodeId: string) => void;
  onUnavailable: (reason: string) => void;
}

type RuntimeRecord = Record<string, unknown>;
type RuntimeFunction = (...args: unknown[]) => unknown;

declare global {
  interface Window {
    /** Optional compiled LayaAir 3.x browser runtime supplied by the host app. */
    Laya?: unknown;
    __UAV_LAB_LAYA_SCENE__?: unknown;
  }
}

function record(value: unknown): RuntimeRecord | null {
  return value && typeof value === "object" ? value as RuntimeRecord : null;
}

function functionValue(value: unknown, key: string): RuntimeFunction | undefined {
  const candidate = record(value)?.[key];
  return typeof candidate === "function" ? candidate as RuntimeFunction : undefined;
}

function constructorValue(value: unknown, key: string): (new (...args: unknown[]) => RuntimeRecord) | undefined {
  const candidate = record(value)?.[key];
  return typeof candidate === "function" ? candidate as new (...args: unknown[]) => RuntimeRecord : undefined;
}

function vector(runtime: RuntimeRecord, x: number, y: number, z: number) {
  const Vector3 = constructorValue(runtime, "Vector3");
  return Vector3 ? new Vector3(x, y, z) : { x, y, z };
}

function setTransform(node: RuntimeRecord, runtime: RuntimeRecord, position: [number, number, number], rotation: [number, number, number]) {
  const transform = record(node.transform);
  if (!transform) return;
  const positionValue = vector(runtime, ...position);
  const rotationValue = vector(runtime, rotation[0] * 180 / Math.PI, rotation[1] * 180 / Math.PI, rotation[2] * 180 / Math.PI);
  if ("position" in transform) transform.position = positionValue;
  if ("rotationEuler" in transform) transform.rotationEuler = rotationValue;
  else if ("localRotationEuler" in transform) transform.localRotationEuler = rotationValue;
}

function destroy(value: unknown) {
  const candidate = record(value);
  const dispose = functionValue(candidate, "destroy");
  if (dispose) dispose.call(candidate, true);
}

/**
 * Optional LayaAir 3.x renderer bridge. The normal web build does not ship a
 * second 12 MB engine bundle; a host that provides the official compiled
 * runtime as window.Laya gets a native LayaAir scene, while the workbench
 * keeps its Three.js renderer as a safe fallback.
 */
export function LayaAirBridge({ nodes, selectedNodeId, dynamics, onSelectNode, onUnavailable }: LayaAirBridgeProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<RuntimeRecord | null>(null);
  const modelRootRef = useRef<RuntimeRecord | null>(null);
  const runtimeRef = useRef<RuntimeRecord | null>(null);
  const selectedNodeRef = useRef(selectedNodeId);
  selectedNodeRef.current = selectedNodeId;
  const resolvedNodes = useMemo(() => resolveSceneNodes(nodes), [nodes]);
  const manifest = useMemo(() => resolvedNodes.map((entry) => ({
    id: entry.node.id,
    componentType: entry.node.data.componentType,
    label: entry.node.data.label,
    position: entry.transform.position,
    size: geometryForComponent(entry.node.data.componentType).size
  })), [resolvedNodes]);

  useEffect(() => {
    window.__UAV_LAB_LAYA_SCENE__ = {
      version: 1,
      nodes: manifest,
      dynamics: dynamics ?? null
    };
  }, [dynamics, manifest]);

  useEffect(() => {
    const host = hostRef.current;
    const supplied = record(window.Laya);
    if (!host || !supplied) {
      onUnavailable("LayaAir 3.x runtime is not loaded; using the built-in renderer.");
      return;
    }

    const runtime = record(supplied.Laya) ?? supplied;
    const init = functionValue(runtime, "init") ?? functionValue(supplied, "init");
    const Scene3D = constructorValue(runtime, "Scene3D");
    const Camera = constructorValue(runtime, "Camera");
    const DirectionLight = constructorValue(runtime, "DirectionLight");
    const Sprite3D = constructorValue(runtime, "Sprite3D");
    const MeshSprite3D = constructorValue(runtime, "MeshSprite3D");
    const PrimitiveMesh = record(runtime.PrimitiveMesh);
    const createBox = functionValue(PrimitiveMesh, "createBox");
    const stage = record(runtime.stage) ?? record(supplied.stage);
    const addChild = functionValue(stage, "addChild");
    if (!init || !Scene3D || !Camera || !DirectionLight || !Sprite3D || !MeshSprite3D || !createBox || !addChild) {
      onUnavailable("The supplied LayaAir runtime does not expose the required 3D classes.");
      return;
    }

    let scene: RuntimeRecord | null = null;
    try {
      const width = Math.max(320, host.clientWidth);
      const height = Math.max(180, host.clientHeight);
      try {
        init.call(runtime, { width, height, canvas: host.querySelector("canvas") });
      } catch {
        init.call(runtime, width, height);
      }
      scene = new Scene3D();
      const camera = new Camera(0, 0.1, 300);
      setTransform(camera, runtime, [0, 6, 12], [0, 0, 0]);
      functionValue(scene, "addChild")?.call(scene, camera);
      const light = new DirectionLight();
      functionValue(scene, "addChild")?.call(scene, light);
      const root = new Sprite3D("UAV Lab components");
      functionValue(scene, "addChild")?.call(scene, root);
      addChild.call(stage, scene);

      const meshes = new Map<string, RuntimeRecord>();
      for (const entry of resolvedNodes) {
        const size = geometryForComponent(entry.node.data.componentType).size;
        const primitive = createBox.call(PrimitiveMesh, Math.max(size[0] * 0.38, 0.08), Math.max(size[1] * 0.38, 0.08), Math.max(size[2] * 0.38, 0.08));
        const mesh = new MeshSprite3D(primitive);
        mesh.name = entry.node.data.label;
        setTransform(mesh, runtime, [entry.transform.position.x, entry.transform.position.y, entry.transform.position.z], [0, 0, 0]);
        functionValue(root, "addChild")?.call(root, mesh);
        const on = functionValue(mesh, "on");
        const event = record(runtime.Event)?.CLICK ?? "click";
        if (on) on.call(mesh, event, null, () => onSelectNode(entry.node.id));
        meshes.set(entry.node.id, mesh);
      }
      runtimeRef.current = runtime;
      sceneRef.current = scene;
      modelRootRef.current = root;
      (modelRootRef.current as RuntimeRecord & { __uavMeshes?: Map<string, RuntimeRecord> }).__uavMeshes = meshes;
    } catch (error) {
      destroy(scene);
      onUnavailable(`LayaAir could not initialize this browser: ${error instanceof Error ? error.message : "unknown engine error"}`);
      return;
    }

    return () => {
      const activeScene = sceneRef.current;
      const activeStage = record(runtimeRef.current?.stage);
      const removeChild = functionValue(activeStage, "removeChild");
      if (activeScene && removeChild) removeChild.call(activeStage, activeScene);
      destroy(activeScene);
      sceneRef.current = null;
      modelRootRef.current = null;
      runtimeRef.current = null;
    };
  }, [manifest, onSelectNode, onUnavailable, resolvedNodes]);

  useEffect(() => {
    const root = modelRootRef.current;
    const runtime = runtimeRef.current;
    if (!root || !runtime || !dynamics || dynamics.source !== "telemetry" || dynamics.stale) return;
    const rotation = attitudeRotation(dynamics);
    setTransform(root, runtime, [0, 0, 0], rotation);
    const meshes = (root as RuntimeRecord & { __uavMeshes?: Map<string, RuntimeRecord> }).__uavMeshes;
    if (meshes && selectedNodeRef.current) {
      const selectedMesh = meshes.get(selectedNodeRef.current);
      if (selectedMesh) selectedMesh.__uavSelected = true;
    }
  }, [dynamics]);

  return (
    <div ref={hostRef} className="laya-air-host" data-testid="laya-air-workspace" aria-label="LayaAir 3D renderer">
      <canvas className="laya-air-canvas" aria-label="LayaAir vehicle canvas" />
      <div className="laya-air-badge">LayaAir 3.x renderer</div>
    </div>
  );
}
