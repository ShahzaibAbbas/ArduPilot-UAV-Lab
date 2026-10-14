import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignEdge, DesignNode, ThreeTransform, ThreeWorkspaceSettings } from "../../domain/design";
import { componentCatalog } from "../../domain/componentCatalog";
import { airframeOption } from "../../domain/airframes";
import { resolveSceneNodes } from "./sceneLayout";
import { SceneInspector } from "./SceneInspector";
import { SceneToolbar } from "./SceneToolbar";
import { ThreeScene } from "./ThreeScene";
import { ThreeCanvasBoundary, ThreeCanvasUnavailable, ThreeContextMonitor } from "./ThreeCanvasBoundary";
import type { SceneNode } from "./sceneTypes";
import type { FlightDynamicsState } from "../../lib/three/flightDynamics";
import { LayaAirBridge } from "../laya/LayaAirBridge";

interface ThreeLabWorkspaceProps {
  nodes: DesignNode[];
  edges: DesignEdge[];
  selectedNodeId: string | null;
  settings: ThreeWorkspaceSettings;
  dynamics?: FlightDynamicsState | null;
  onSettingsChange: (settings: ThreeWorkspaceSettings) => void;
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  onTransformChange: (nodeId: string, transform?: ThreeTransform) => void;
}

export function ThreeLabWorkspace({
  nodes,
  edges,
  selectedNodeId,
  settings,
  dynamics,
  onSettingsChange,
  onSelectNode,
  onClearSelection,
  onTransformChange
}: ThreeLabWorkspaceProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(1);
  const [resetToken, setResetToken] = useState(0);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [rendererMode, setRendererMode] = useState<"laya" | "three">("laya");
  const [layaAvailable, setLayaAvailable] = useState<boolean | undefined>(undefined);
  const [layaReason, setLayaReason] = useState("LayaAir runtime not loaded");
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setSystemReducedMotion(preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);
  const resolvedNodes = useMemo(() => resolveSceneNodes(nodes), [nodes]);
  const selected = resolvedNodes.find((entry) => entry.node.id === selectedNodeId);
  const airframe = nodes.find((node) => node.data.componentType === "frame");
  const model = airframe ? airframeOption(String(airframe.data.properties.layout ?? "quad-x")) : null;
  const visibleNodes = settings.isolateSelection && selected ? [selected] : resolvedNodes;
  const visibleNodeIds = new Set(visibleNodes.map((entry) => entry.node.id));
  const visibleEdges = settings.isolateSelection
    ? edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    : edges;
  const hovered = visibleNodes.find((entry) => entry.node.id === hoveredNodeId);
  const handleHover = useCallback((entry: SceneNode | null) => setHoveredNodeId(entry?.node.id ?? null), []);
  const handleContextLost = useCallback(() => setContextLost(true), []);
  const handleLayaUnavailable = useCallback((reason: string) => {
    setLayaAvailable(false);
    setLayaReason(reason);
    setRendererMode("three");
  }, []);
  const retryRenderer = () => {
    setContextLost(false);
    setRendererGeneration((current) => current + 1);
    setResetToken(0);
    setFitToken((current) => current + 1);
  };

  return (
    <section className="three-lab-workspace" data-testid="three-lab-workspace">
      <div className="three-lab-heading">
        <div>
          <strong>3D vehicle workbench</strong>
          <span data-testid="airframe-model-label">{model?.label ?? "Component workspace"} · {rendererMode === "laya" ? "LayaAir" : "Three.js fallback"} · {dynamics?.source === "telemetry" && !dynamics.stale ? "live flight dynamics" : "concept aero estimate"}</span>
        </div>
        <label>
          Object
          <select
            aria-label="Select 3D component"
            value={selected?.node.id ?? ""}
            onChange={(event) => (event.target.value ? onSelectNode(event.target.value) : onClearSelection())}
          >
            <option value="">No selection</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.data.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <SceneToolbar
        settings={settings}
        hasSelection={Boolean(selected)}
        rendererMode={rendererMode}
        layaAvailable={layaAvailable}
        onRendererChange={(next) => {
          setRendererMode(next);
          if (next === "laya") setLayaAvailable(undefined);
        }}
        onChange={onSettingsChange}
        onFit={() => setFitToken((current) => current + 1)}
        onResetCamera={() => setResetToken((current) => current + 1)}
        onAirframeView={airframe ? () => {
          onSelectNode(airframe.id);
          onSettingsChange({ ...settings, isolateSelection: true });
          setFitToken((current) => current + 1);
        } : undefined}
      />

      <div className="three-canvas-wrap" onPointerLeave={() => setHoveredNodeId(null)}>
        {rendererMode === "laya" ? (
          <LayaAirBridge
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            dynamics={dynamics}
            onSelectNode={onSelectNode}
            onUnavailable={handleLayaUnavailable}
          />
        ) : contextLost ? (
          <ThreeCanvasUnavailable onRetry={retryRenderer} />
        ) : (
          <ThreeCanvasBoundary key={rendererGeneration} onRetry={retryRenderer}>
            <Canvas
              shadows
              frameloop="demand"
              dpr={[1, 1.5]}
              camera={{ position: [8, 7, 9], fov: 48, near: 0.1, far: 120 }}
              fallback={<ThreeCanvasUnavailable onRetry={retryRenderer} />}
              onPointerMissed={onClearSelection}
            >
              <ThreeContextMonitor onContextLost={handleContextLost} />
              <ThreeScene
                sceneNodes={visibleNodes}
                edges={visibleEdges}
                selectedNodeId={selectedNodeId}
                showLabels={settings.showLabels}
                showWires={settings.showWires}
                reducedMotion={settings.reducedMotion || systemReducedMotion}
                dynamics={dynamics}
                fitToken={fitToken}
                resetToken={resetToken}
                onSelectNode={onSelectNode}
                onHover={handleHover}
              />
            </Canvas>
          </ThreeCanvasBoundary>
        )}

        {layaAvailable === false && rendererMode === "three" ? <div className="laya-air-fallback-note" role="status">{layaReason} Using the compatible Three.js renderer. Provide the official LayaAir 3.x browser library to enable it.</div> : null}

        {nodes.length === 0 ? (
          <div className="three-canvas-empty" role="status">Add components in Design (2D) to populate the 3D workspace.</div>
        ) : null}

        {hovered ? (
          <div className="three-hover-card">
            <strong>{hovered.node.data.label}</strong>
            <span>{componentCatalog.find((entry) => entry.type === hovered.node.data.componentType)?.name ?? hovered.node.data.componentType}</span>
            <small>
              {hovered.node.data.health ?? "ok"} · {hovered.automatic ? "automatic position" : "saved transform"}
            </small>
            <small>
              {Object.entries(hovered.node.data.properties)
                .slice(0, 2)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join(" · ")}
            </small>
          </div>
        ) : null}
      </div>

      {dynamics ? (
        <div className={`three-dynamics-hud ${dynamics.source === "telemetry" && !dynamics.stale ? "live" : "estimate"}`} role="status" aria-label="Flight dynamics">
          <div>
            <strong>{dynamics.source === "telemetry" && !dynamics.stale ? "Live flight dynamics" : "Concept aero model"}</strong>
            <span>{dynamics.stale ? "Telemetry stale; showing configured wind" : dynamics.source === "telemetry" ? "Telemetry attitude drives the whole assembly" : "Configure wind and gust values in Simulation"}</span>
          </div>
          <dl>
            <div><dt>Roll</dt><dd>{dynamics.rollDeg.toFixed(1)}°</dd></div>
            <div><dt>Pitch</dt><dd>{dynamics.pitchDeg.toFixed(1)}°</dd></div>
            <div><dt>Yaw</dt><dd>{dynamics.yawDeg.toFixed(1)}°</dd></div>
            <div><dt>Airspeed</dt><dd>{dynamics.airspeedMps.toFixed(1)} m/s</dd></div>
            <div><dt>Climb</dt><dd>{dynamics.climbMps.toFixed(1)} m/s</dd></div>
            <div><dt>Throttle</dt><dd>{dynamics.throttlePercent.toFixed(0)}%</dd></div>
            <div><dt>Wind / gust</dt><dd>{dynamics.windSpeedMps.toFixed(1)} / {dynamics.windGustMps.toFixed(1)} m/s</dd></div>
          </dl>
        </div>
      ) : null}

      {selected ? (
        <SceneInspector
          key={selected.node.id}
          label={selected.node.data.label}
          transform={selected.transform}
          automatic={selected.automatic}
          onChange={(transform) => onTransformChange(selected.node.id, transform)}
          onReset={() => onTransformChange(selected.node.id, undefined)}
        />
      ) : (
        <div className="three-empty-selection">Select a component in 2D or 3D to inspect and persist its transform.</div>
      )}
    </section>
  );
}
