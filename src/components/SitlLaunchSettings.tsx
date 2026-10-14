import type { SimulationSettings } from "../domain/design";

interface Props {
  settings: SimulationSettings;
  port: number;
  listenerActive: boolean;
  onChange: (patch: Partial<SimulationSettings>) => void;
  onPortChange: (port: number) => void;
}

export function SitlLaunchSettings({ settings, port, listenerActive, onChange, onPortChange }: Props) {
  return <section className="sitl-locator">
    <h2>Launch &amp; telemetry</h2>
    <label className="toggle-row">
      <input type="checkbox" checked={settings.sitlHeadless !== false}
        onChange={(event) => onChange({ sitlHeadless: event.target.checked })} />
      <span>Run without external windows</span>
    </label>
    <label className="toggle-row">
      <input type="checkbox" checked={settings.sitlRebuild !== false}
        onChange={(event) => onChange({ sitlRebuild: event.target.checked })} />
      <span>Rebuild autopilot before launch</span>
    </label>
    <label className="toggle-row">
      <input type="checkbox" checked={settings.sitlWipeOnLaunch === true}
        onChange={(event) => onChange({ sitlWipeOnLaunch: event.target.checked })} />
      <span>Wipe SITL EEPROM on next launch</span>
    </label>
    <label className="field">
      <span>Lab telemetry UDP port</span>
      <input type="number" min={1024} max={65535} step={1} value={port} disabled={listenerActive}
        onChange={(event) => onPortChange(Number(event.target.value))} />
    </label>
    <p>Launching SITL connects it to the lab's telemetry reader. An active reader keeps its current port. MAVProxy output is available in the embedded console below. Uncheck <strong>Run without external windows</strong> when you also want sim_vehicle/MAVProxy to request native map and console windows; WSL needs a working GUI display. EEPROM wipe applies once to the next launch.</p>
  </section>;
}
