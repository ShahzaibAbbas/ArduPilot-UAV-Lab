import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, MapPin, Radio, ShieldAlert, X } from "lucide-react";
import type { MavlinkCommandRequest, TelemetryStatus } from "../lib/api";
import { collectTelemetryAlerts, type BatteryAlertSettings } from "../lib/telemetryAlerts";

export interface TelemetryAlertDialogProps {
  status: TelemetryStatus | null;
  batterySettings: BatteryAlertSettings;
  onCommand?: (request: MavlinkCommandRequest) => Promise<void>;
  onOpenTelemetry?: () => void;
}

/** Operator advice only; recovery commands require an explicit click. */
export function TelemetryAlertDialog({ status, batterySettings, onCommand, onOpenTelemetry }: TelemetryAlertDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dismissedKeys = useRef(new Set<string>());
  const activeKey = useRef<string | undefined>(undefined);
  const [dismissalRevision, setDismissalRevision] = useState(0);
  const [commandState, setCommandState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [commandError, setCommandError] = useState<string | null>(null);
  const alerts = useMemo(() => collectTelemetryAlerts(status, batterySettings), [status, batterySettings]);
  const alert = alerts.find((candidate) => !dismissedKeys.current.has(candidate.key));

  useEffect(() => {
    const present = new Set(alerts.map((candidate) => candidate.key));
    for (const key of dismissedKeys.current) if (!present.has(key)) dismissedKeys.current.delete(key);
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (alert?.key !== activeKey.current) {
      activeKey.current = alert?.key;
      setCommandState("idle");
      setCommandError(null);
    }
    if (alert && !dialog.open) dialog.showModal();
    if (!alert && dialog.open) dialog.close();
  }, [alert, alerts, dismissalRevision]);

  const close = () => {
    if (alert) dismissedKeys.current.add(alert.key);
    dialogRef.current?.close();
    setDismissalRevision((value) => value + 1);
  };

  const runRecommendedAction = async () => {
    if (!alert?.command || !onCommand || !alert.vehicle.link || alert.vehicle.heartbeat?.armed !== true) return;
    const key = alert.key;
    setCommandState("sending");
    setCommandError(null);
    try {
      await onCommand({ sysid: alert.vehicle.sysid, compid: alert.vehicle.compid, ...alert.command });
      if (activeKey.current === key) setCommandState("sent");
    } catch (error) {
      if (activeKey.current !== key) return;
      setCommandState("failed");
      setCommandError(error instanceof Error ? error.message : "The command could not be sent.");
    }
  };

  return (
    <dialog ref={dialogRef} className="telemetry-alert-dialog" aria-labelledby="telemetry-alert-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      {alert ? <>
        <header className={alert.severity <= 2 ? "critical" : "warning"}>
          <div className="telemetry-alert-heading"><ShieldAlert size={20} /><div>
            <small>Live MAVLink alert · SYS {alert.vehicle.sysid}</small>
            <h2 id="telemetry-alert-title">{alert.title}</h2>
          </div></div>
          <button type="button" className="icon-button" aria-label="Dismiss alert" onClick={close}><X size={18} /></button>
        </header>
        <div className="telemetry-alert-body">
          <p className="telemetry-alert-detail"><AlertTriangle size={15} />{alert.detail}</p>
          <section><h3><ShieldAlert size={16} />Operator recommendation</h3><p>{alert.recommendation}</p>
            <ol className="telemetry-alert-steps">{alert.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </section>
          <section className="telemetry-alert-action"><div>
            <strong>{alert.command ? `Recommended action: ${alert.actionLabel}` : "Inspect the reported condition"}</strong>
            <span>{alert.vehicle.link ? `Command link ${alert.vehicle.link.host}:${alert.vehicle.link.port}` : "No command link is available."}</span>
          </div>
            {alert.command ? <button type="button" onClick={() => void runRecommendedAction()} disabled={!onCommand || !alert.vehicle.link || commandState === "sending" || commandState === "sent"}>
              {commandState === "sending" ? "Sending…" : commandState === "sent" ? <><CheckCircle2 size={15} />Sent</> : <><Radio size={15} />Send {alert.actionLabel}</>}
            </button> : null}
          </section>
          {commandState === "failed" && commandError ? <p className="telemetry-alert-error" role="alert">{commandError}</p> : null}
          {commandState === "sent" ? <p className="telemetry-alert-success" role="status">Command sent by the telemetry bridge. Verify the vehicle's response and mode.</p> : null}
          <button type="button" className="telemetry-alert-link" onClick={() => { close(); onOpenTelemetry?.(); }}><MapPin size={14} />Open telemetry details</button>
        </div>
        <footer><button type="button" onClick={close}>Dismiss this condition</button></footer>
      </> : null}
    </dialog>
  );
}
