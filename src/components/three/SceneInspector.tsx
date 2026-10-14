import { useEffect, useRef, useState } from "react";
import type { ThreeTransform } from "../../domain/design";
import { threeTransformLimits } from "../../domain/threePresentation";

interface SceneInspectorProps {
  label: string;
  transform: ThreeTransform;
  automatic: boolean;
  onChange: (transform: ThreeTransform) => void;
  onReset: () => void;
}

interface TransformNumberProps {
  label: string;
  accessibleLabel: string;
  value: number;
  step: number;
  minimum: number;
  maximum: number;
  onCommit: (value: number) => void;
}

function displayValue(value: number) {
  return String(Number(value.toFixed(3)));
}

function TransformNumber({ label, accessibleLabel, value, step, minimum, maximum, onCommit }: TransformNumberProps) {
  const [draft, setDraft] = useState(() => displayValue(value));
  const cancelled = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    setDraft(displayValue(value));
    dirty.current = false;
  }, [value]);

  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : NaN;
    if (dirty.current && !cancelled.current && Number.isFinite(parsed)) {
      const bounded = Math.min(maximum, Math.max(minimum, parsed));
      setDraft(displayValue(bounded));
      if (bounded !== value) onCommit(bounded);
    } else {
      setDraft(displayValue(value));
    }
    cancelled.current = false;
    dirty.current = false;
  };

  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={accessibleLabel}
        title="Enter or leave the field to save; Escape cancels"
        step={step}
        min={minimum}
        max={maximum}
        value={draft}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = event.key === "Escape";
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function SceneInspector({ label, transform, automatic, onChange, onReset }: SceneInspectorProps) {
  const update = (group: keyof ThreeTransform, axis: "x" | "y" | "z", value: number) => {
    onChange({ ...transform, [group]: { ...transform[group], [axis]: value } });
  };
  const rotationInput = (axis: "x" | "y" | "z", name: string) => (
    <TransformNumber
      key={axis}
      label={name + " °"}
      accessibleLabel={"3D " + name.toLowerCase() + " in degrees"}
      value={(transform.rotation[axis] * 180) / Math.PI}
      step={15}
      minimum={-360}
      maximum={360}
      onCommit={(value) => update("rotation", axis, (value * Math.PI) / 180)}
    />
  );

  return (
    <section className="three-scene-inspector" aria-label="Selected 3D transform">
      <div>
        <strong>{label}</strong>
        <span>{automatic ? "Automatic layout" : "Saved transform"}</span>
      </div>
      {(["x", "y", "z"] as const).map((axis) => (
        <TransformNumber
          key={axis}
          label={axis.toUpperCase()}
          accessibleLabel={"3D position " + axis.toUpperCase()}
          value={transform.position[axis]}
          step={0.25}
          minimum={-threeTransformLimits.position}
          maximum={threeTransformLimits.position}
          onCommit={(value) => update("position", axis, value)}
        />
      ))}
      {rotationInput("y", "Yaw")}
      <button type="button" onClick={onReset} disabled={automatic}>
        Use automatic layout
      </button>
      <details className="three-transform-advanced">
        <summary>Rotation &amp; scale</summary>
        <div>
          {rotationInput("x", "Pitch")}
          {rotationInput("z", "Roll")}
          {(["x", "y", "z"] as const).map((axis) => (
            <TransformNumber
              key={"scale-" + axis}
              label={"Scale " + axis.toUpperCase()}
              accessibleLabel={"3D scale " + axis.toUpperCase()}
              value={transform.scale[axis]}
              step={0.1}
              minimum={threeTransformLimits.minimumScale}
              maximum={threeTransformLimits.maximumScale}
              onCommit={(value) => update("scale", axis, value)}
            />
          ))}
        </div>
      </details>
    </section>
  );
}
