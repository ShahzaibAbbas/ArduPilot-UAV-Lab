import type { SimulationSettings } from "../domain/design";
import type { MavlinkCommandRequest, TelemetryStatus } from "./api";

type Vehicle = TelemetryStatus["vehicles"][number];
export interface BatteryAlertSettings {
  lowPercent: number;
  criticalPercent: number;
  lowVoltageV?: number;
  criticalVoltageV?: number;
  lowAction: SimulationSettings["batteryFailsafeAction"];
  criticalAction: SimulationSettings["batteryCriticalAction"];
  vehicle: SimulationSettings["vehicle"];
}
export interface TelemetryAlert {
  key: string;
  kind: "battery" | "status";
  vehicle: Vehicle;
  title: string;
  detail: string;
  severity: number;
  recommendation: string;
  steps: string[];
  command?: Pick<MavlinkCommandRequest, "action" | "mode">;
  actionLabel?: string;
}

const severityNames = ["Emergency", "Alert", "Critical", "Error", "Warning", "Notice", "Info", "Debug"];
function fresh(timestamp: string | undefined, now: number, maxAge = 15000) {
  const time = Date.parse(timestamp ?? "");
  return Number.isFinite(time) && now - time >= -5000 && now - time <= maxAge;
}

function configuredCommand(action: string, vehicle: Vehicle, settings: BatteryAlertSettings): Pick<TelemetryAlert, "command" | "actionLabel"> {
  // Never offer recovery commands for a disarmed or unidentified vehicle.
  if (vehicle.heartbeat?.armed !== true || vehicle.heartbeat.autopilot !== 3) return {};
  const type = vehicle.heartbeat.type;
  if (type === undefined) return {};
  const family = [10, 11].includes(type) ? "Rover"
    : [1, 19, 20, 21, 22, 23, 24, 28].includes(type) ? "ArduPlane"
      : [2, 3, 4, 13, 14, 15, 29, 35, 43].includes(type) ? "ArduCopter" : undefined;
  if (!family) return {};
  if (action === "RTL") return { command: { action: "rtl" }, actionLabel: "RTL" };
  if (action === "Land" && family === "ArduCopter") return { command: { action: "land" }, actionLabel: "Land" };
  if ((action === "Hold" || action === "Land") && family === "Rover") return { command: { action: "mode", mode: "hold" }, actionLabel: "Hold" };
  if (action === "SmartRTL" && family !== "ArduPlane") return { command: { action: "mode", mode: "smart_rtl" }, actionLabel: "SmartRTL" };
  return {};
}

export function collectTelemetryAlerts(status: TelemetryStatus | null, settings: BatteryAlertSettings, now = Date.now()): TelemetryAlert[] {
  if (!status?.listener.active) return [];
  const alerts: TelemetryAlert[] = [];
  for (const vehicle of status.vehicles) {
    if (!fresh(vehicle.lastSeenAt, now)) continue;
    const validTexts = [...(vehicle.statusHistory ?? []), vehicle.statusText]
      .filter((text): text is NonNullable<typeof text> => Boolean(text && text.severity >= 0 && text.severity <= 7 && fresh(text.receivedAt, now, 30000)))
      .sort((a, b) => Date.parse(a.receivedAt!) - Date.parse(b.receivedAt!));
    // A newer status supersedes an old warning; do not keep reopening old history.
    const text = validTexts.at(-1);
    if (text?.text && text.severity <= 4) {
      const value = text.text.toLowerCase();
      const batteryMessage = /battery|voltage/.test(value);
      const prearm = /pre.?arm|unhealthy|not healthy|bad battery/.test(value);
      const critical = /critical|emergency/.test(value) || text.severity <= 2;
      const action = batteryMessage ? (critical ? settings.criticalAction : settings.lowAction)
        : /land/.test(value) ? "Land" : /rtl|return|failsafe/.test(value) ? "RTL" : "Warn";
      const recovery = prearm ? {} : configuredCommand(action, vehicle, settings);
      alerts.push({
        key: `${vehicle.id}:status:${text.severity}:${text.text}`,
        kind: "status", vehicle,
        title: text.advice?.title ?? text.text,
        detail: `${text.advice?.severityLabel ?? severityNames[text.severity]} · ${text.text}`,
        severity: text.severity,
        recommendation: text.advice?.summary ?? "Review the reported subsystem and the current vehicle state.",
        steps: text.advice?.steps ?? ["Inspect the reported subsystem before continuing."],
        ...recovery
      });
    }
    const battery = vehicle.battery;
    if (!battery || !fresh(battery.receivedAt ?? vehicle.lastSeenAt, now)) continue;
    const remaining = battery.remainingPercent;
    const voltage = battery.voltageV;
    const validRemaining = typeof remaining === "number" && Number.isFinite(remaining) && remaining >= 0 && remaining <= 100;
    const validVoltage = typeof voltage === "number" && Number.isFinite(voltage) && voltage >= 0;
    const below = (threshold: number | undefined) => validVoltage && typeof threshold === "number" && threshold > 0 && voltage < threshold;
    const critical = (validRemaining && settings.criticalPercent > 0 && remaining <= settings.criticalPercent) || below(settings.criticalVoltageV) || battery.chargeState === 3 || battery.chargeState === 4;
    const fault = battery.chargeState === 5 || battery.chargeState === 6 || (battery.faultBitmask ?? 0) !== 0;
    const low = critical || fault || (validRemaining && settings.lowPercent > 0 && remaining <= settings.lowPercent) || below(settings.lowVoltageV) || battery.chargeState === 2;
    if (!low) continue;
    const level = fault ? "fault" : critical ? "critical" : "low";
    const action = critical || fault ? settings.criticalAction : settings.lowAction;
    const recovery = configuredCommand(action, vehicle, settings);
    const readings = [validRemaining ? `${Math.round(remaining)}% remaining` : "Remaining capacity unavailable", validVoltage ? `${voltage.toFixed(1)} V` : "Voltage unavailable"];
    const thresholds = [below(settings.criticalVoltageV) ? `critical voltage ${settings.criticalVoltageV!.toFixed(1)} V` : below(settings.lowVoltageV) ? `low voltage ${settings.lowVoltageV!.toFixed(1)} V` : null,
      validRemaining && remaining <= (critical ? settings.criticalPercent : settings.lowPercent) ? `${critical ? "critical" : "low"} reserve ${critical ? settings.criticalPercent : settings.lowPercent}%` : null].filter(Boolean);
    alerts.push({
      key: `${vehicle.id}:battery:${level}`, kind: "battery", vehicle,
      title: fault ? "Battery fault reported" : critical ? "Battery critically low" : "Battery reserve low",
      detail: `${readings.join(" · ")}${thresholds.length ? ` · Crossed ${thresholds.join(" and ")}` : ""}`,
      severity: critical || fault ? 2 : 4,
      recommendation: vehicle.heartbeat?.armed === true
        ? `Configured ${level} response: ${action}. Confirm the vehicle state and a safe recovery path.`
        : "Keep the vehicle disarmed. Inspect or replace the pack and verify battery-monitor calibration before arming.",
      steps: [
        "Verify voltage and remaining capacity against the calibrated battery monitor.",
        "Inspect the pack, cell balance, connector, and wiring; replace a damaged or depleted pack.",
        "After a pack change, re-export the battery capacity and voltage thresholds and restart SITL to apply the design.",
        "This is an operator alert. ArduPilot triggers its configured failsafe using its own voltage timer and capacity checks."
      ],
      ...recovery
    });
  }
  return alerts.sort((a, b) => a.severity - b.severity || (a.kind === "battery" ? -1 : 1));
}
