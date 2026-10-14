import {
  defaultLabSettings,
  type LabWorkspaceSettings
} from "./design";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function identifierValue(value: unknown, maximum: number) {
  if (typeof value !== "string" || !/^\d{1,8}$/.test(value)) return "";
  const identifier = Number(value);
  return identifier <= maximum ? String(identifier) : "";
}

export function labSettingsWithDefaults(value?: unknown): LabWorkspaceSettings {
  const settings = record(value);
  const three = record(settings.three);
  const trace = record(settings.trace);
  return {
    viewMode: settings.viewMode === "3d" ? "3d" : "2d",
    three: {
      showLabels: booleanValue(three.showLabels, defaultLabSettings.three.showLabels),
      showWires: booleanValue(three.showWires, defaultLabSettings.three.showWires),
      isolateSelection: booleanValue(three.isolateSelection, defaultLabSettings.three.isolateSelection),
      reducedMotion: booleanValue(three.reducedMotion, defaultLabSettings.three.reducedMotion)
    },
    trace: {
      direction: trace.direction === "rx" || trace.direction === "tx" ? trace.direction : "all",
      protocol: trace.protocol === "MAVLink1" || trace.protocol === "MAVLink2" ? trace.protocol : "all",
      systemId: identifierValue(trace.systemId, 255),
      componentId: identifierValue(trace.componentId, 255),
      messageId: identifierValue(trace.messageId, 16_777_215),
      text: typeof trace.text === "string" ? trace.text.slice(0, 512) : ""
    }
  };
}
