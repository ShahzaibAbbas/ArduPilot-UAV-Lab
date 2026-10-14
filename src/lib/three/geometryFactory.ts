export type ProceduralGeometryKind = "box" | "cylinder" | "sphere" | "frame";

export interface ProceduralGeometry {
  kind: ProceduralGeometryKind;
  size: [number, number, number];
}

export function geometryForComponent(componentType: string): ProceduralGeometry {
  if (componentType === "frame") return { kind: "frame", size: [2.4, 0.22, 2.4] };
  if (componentType === "motor" || componentType === "gps" || componentType === "buzzer") {
    return { kind: "cylinder", size: [0.46, 0.5, 0.46] };
  }
  if (componentType.includes("camera") || componentType.includes("rangefinder")) {
    return { kind: "sphere", size: [0.58, 0.58, 0.58] };
  }
  if (componentType === "battery") return { kind: "box", size: [1.45, 0.68, 0.82] };
  if (componentType === "flight-controller") return { kind: "box", size: [1.15, 0.34, 1.0] };
  if (componentType === "esc") return { kind: "box", size: [0.88, 0.24, 0.58] };
  return { kind: "box", size: [1.0, 0.48, 0.72] };
}

