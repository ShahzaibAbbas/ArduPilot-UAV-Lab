import { Eye, EyeOff, Focus, RotateCcw, Tag, Tags } from "lucide-react";
import type { ThreeWorkspaceSettings } from "../../domain/design";

interface SceneToolbarProps {
  settings: ThreeWorkspaceSettings;
  hasSelection: boolean;
  rendererMode?: "laya" | "three";
  layaAvailable?: boolean;
  onRendererChange?: (renderer: "laya" | "three") => void;
  onChange: (settings: ThreeWorkspaceSettings) => void;
  onFit: () => void;
  onResetCamera: () => void;
  onAirframeView?: () => void;
}

export function SceneToolbar({ settings, hasSelection, rendererMode, layaAvailable, onRendererChange, onChange, onFit, onResetCamera, onAirframeView }: SceneToolbarProps) {
  return (
    <div className="three-scene-toolbar" role="group" aria-label="3D scene tools">
      {onAirframeView ? <button type="button" onClick={onAirframeView} title="Focus the project's selected airframe shape"><Focus size={15} />View airframe</button> : null}
      {onRendererChange ? <button type="button" aria-pressed={rendererMode === "laya"} onClick={() => onRendererChange(rendererMode === "laya" ? "three" : "laya")} title={layaAvailable ? "Use the LayaAir 3.x renderer" : "LayaAir runtime is optional; Three.js remains the fallback"}>LayaAir{layaAvailable === false ? " · fallback" : ""}</button> : null}
      <button type="button" onClick={onFit} title="Fit all components in view">
        <Focus size={15} /> Fit
      </button>
      <button type="button" onClick={onResetCamera} title="Reset the perspective camera">
        <RotateCcw size={15} /> Reset
      </button>
      <button
        type="button"
        aria-pressed={settings.showLabels}
        onClick={() => onChange({ ...settings, showLabels: !settings.showLabels })}
        title="Show or hide component labels"
      >
        {settings.showLabels ? <Tags size={15} /> : <Tag size={15} />} Labels
      </button>
      <button
        type="button"
        aria-pressed={settings.showWires}
        onClick={() => onChange({ ...settings, showWires: !settings.showWires })}
        title="Show or hide signal paths"
      >
        {settings.showWires ? <Eye size={15} /> : <EyeOff size={15} />} Wires
      </button>
      <button
        type="button"
        aria-pressed={settings.isolateSelection}
        disabled={!hasSelection && !settings.isolateSelection}
        onClick={() => onChange({ ...settings, isolateSelection: !settings.isolateSelection })}
        title="Show only the selected component"
      >
        <Focus size={15} /> Isolate
      </button>
      <button
        type="button"
        aria-pressed={settings.reducedMotion}
        onClick={() => onChange({ ...settings, reducedMotion: !settings.reducedMotion })}
        title="Disable animated camera fitting and orbit damping; system motion preferences also apply"
      >
        Reduced motion
      </button>
    </div>
  );
}
