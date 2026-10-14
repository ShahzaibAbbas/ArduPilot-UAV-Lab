import type { ThreeTransform, ThreeVector3 } from "./design";

const unitScale: ThreeVector3 = { x: 1, y: 1, z: 1 };
const zeroVector: ThreeVector3 = { x: 0, y: 0, z: 0 };

export const threeTransformLimits = {
  position: 10_000,
  minimumScale: 0.1,
  maximumScale: 100
} as const;

function finiteValue(value: unknown, fallback: number) {
  // Coercing null, booleans, arrays, or blank strings silently turns corrupt
  // workspace data into real coordinates. Only finite numeric values qualify.
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizedVector(value: unknown, fallback: ThreeVector3, minimum: number, maximum: number): ThreeVector3 {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<ThreeVector3>) : {};
  const clamp = (coordinate: unknown, defaultValue: number) => Math.min(maximum, Math.max(minimum, finiteValue(coordinate, defaultValue)));
  return {
    x: clamp(source.x, fallback.x),
    y: clamp(source.y, fallback.y),
    z: clamp(source.z, fallback.z)
  };
}

export function normalizeThreeTransform(value: unknown): ThreeTransform | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<ThreeTransform>;
  const rotation = normalizedVector(candidate.rotation, zeroVector, -Number.MAX_VALUE, Number.MAX_VALUE);
  return {
    position: normalizedVector(candidate.position, zeroVector, -threeTransformLimits.position, threeTransformLimits.position),
    rotation: { x: rotation.x % (Math.PI * 2), y: rotation.y % (Math.PI * 2), z: rotation.z % (Math.PI * 2) },
    scale: normalizedVector(candidate.scale, unitScale, threeTransformLimits.minimumScale, threeTransformLimits.maximumScale)
  };
}

export function cloneThreeTransform(transform: ThreeTransform): ThreeTransform {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale }
  };
}
