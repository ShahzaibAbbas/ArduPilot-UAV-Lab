import { airframeOption } from "../../domain/airframes";

/** Apply envelope edits relative to each concept model's nominal proportions. */
export function airframeModelScale(frame: string, properties: Record<string, string | number | boolean>): [number, number, number] {
  const option = airframeOption(frame);
  const dimensions = option.dimensions;
  if (!dimensions) return [1, 1, 1];
  const measured = (key: string, fallback: number) => {
    const value = properties[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.max(0.1, Math.min(20, value / 1000)) : fallback;
  };
  return [
    measured("spanMm", dimensions.spanM) / dimensions.spanM,
    measured("heightMm", dimensions.heightM) / dimensions.heightM,
    measured("lengthMm", dimensions.lengthM) / dimensions.lengthM
  ];
}
