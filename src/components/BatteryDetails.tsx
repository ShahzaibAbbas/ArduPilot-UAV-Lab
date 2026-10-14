import type { ChangeEvent } from "react";
import { batteryMetrics } from "../../server/batteryModel.js";
import type { DesignNode } from "../domain/design";
import type { CustomComponentTemplate } from "../lib/api";

interface BatteryDetailsProps {
  node: DesignNode;
  presets: CustomComponentTemplate[];
  onApplyPreset: (preset: CustomComponentTemplate) => void;
}

function validUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function BatteryDetails({ node, presets, onApplyPreset }: BatteryDetailsProps) {
  const metrics = batteryMetrics(node.data.properties);
  const sourceUrl = node.data.properties.specDatasheetUrl;
  const batteryPresets = presets.filter((preset) => preset.baseType === "battery");
  const applyPreset = (event: ChangeEvent<HTMLSelectElement>) => {
    const preset = batteryPresets.find((candidate) => candidate.id === event.target.value);
    if (preset) onApplyPreset(preset);
  };

  return (
    <section className="battery-details" data-testid="battery-details" aria-label="Battery calculations">
      <div className="battery-details-heading">
        <h2>Battery calculations</h2>
        <span className={`status-pill ${metrics.issues.some((issue) => issue.severity === "error") ? "bad" : "good"}`}>
          {metrics.issues.some((issue) => issue.severity === "error") ? "Review values" : "Calculated"}
        </span>
      </div>
      <label className="field">
        <span>Manufacturer preset</span>
        <select aria-label="Battery product preset" value="" onChange={applyPreset}>
          <option value="">Choose a researched pack…</option>
          {batteryPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>
      </label>
      <div className="battery-metric-grid">
        <div><small>Nominal / full</small><strong>{metrics.nominalVoltageV.toFixed(1)} / {metrics.fullVoltageV.toFixed(1)} V</strong></div>
        <div><small>Energy</small><strong>{metrics.energyWh.toFixed(1)} Wh</strong></div>
        <div><small>Low / critical voltage</small><strong>{metrics.lowVoltageV.toFixed(1)} / {metrics.criticalVoltageV.toFixed(1)} V</strong></div>
        <div><small>Capacity</small><strong>{metrics.capacityAh.toFixed(2)} Ah ({metrics.seriesCells}S{metrics.parallelCells}P)</strong></div>
        <div><small>Continuous / burst</small><strong>{metrics.continuousCurrentA > 0 ? `${metrics.continuousCurrentA.toFixed(1)} / ${metrics.burstCurrentA.toFixed(1)} A` : "Unspecified"}</strong></div>
        <div><small>Mass</small><strong>{metrics.massG.toFixed(1)} g ({metrics.massSource})</strong></div>
        <div><small>Envelope</small><strong>{["packLengthMm", "packWidthMm", "packHeightMm"].map((key) => Number(node.data.properties[key] ?? 0)).every(Boolean)
          ? `${node.data.properties.packLengthMm} × ${node.data.properties.packWidthMm} × ${node.data.properties.packHeightMm} mm`
          : "Unspecified"}</strong></div>
      </div>
      <p className="field-help">Parallel-cell configuration describes the pack; published capacity is already total. C-ratings do not certify wiring, connector, thermal, or propulsion limits.</p>
      <p className="field-help">Changing this pack recalculates engineering checks and export thresholds. Stop and relaunch SITL to apply the new simulated pack and reset a latched battery failsafe.</p>
      {validUrl(sourceUrl) ? <a href={String(sourceUrl)} target="_blank" rel="noopener noreferrer">Open manufacturer source</a> : null}
      {metrics.issues.length > 0 ? <ul className="battery-issues">{metrics.issues.map((issue) => <li key={`${issue.key}-${issue.message}`}>{issue.message}</li>)}</ul> : null}
    </section>
  );
}

