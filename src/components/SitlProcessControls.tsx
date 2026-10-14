import { useEffect, useRef, useState } from "react";
import { RefreshCw, RotateCcw, Square } from "lucide-react";
import { getSitlProcesses, stopSitlProcess, type SitlProcessStatus } from "../lib/api";
import { stopManagedSitl } from "../lib/sitlMaintenance";

interface Props {
  disabled: boolean;
  launchDisabled: boolean;
  onLaunch: () => Promise<boolean>;
  onActionChange: (action: "stopping" | "resetting" | null) => void;
}

export function SitlProcessControls({ disabled, launchDisabled, onLaunch, onActionChange }: Props) {
  const [status, setStatus] = useState<SitlProcessStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState<"stopping" | "resetting" | null>(null);
  const [revision, setRevision] = useState(0);
  const maintenance = useRef<AbortController | null>(null);

  useEffect(() => () => maintenance.current?.abort(), []);
  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    let timer: number;
    const refresh = async () => {
      try {
        const result = await getSitlProcesses(controller.signal);
        if (!controller.signal.aborted) { setStatus(result); setStatusError(""); }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatus(null);
          setStatusError(error instanceof Error ? error.message : "SITL status is unavailable. Check that the local API is running.");
        }
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 2500);
      }
    };
    void refresh();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [busy, revision]);

  const maintain = async (reset: boolean) => {
    if (maintenance.current || disabled || (reset && launchDisabled)) return;
    const controller = new AbortController();
    maintenance.current = controller;
    const action = reset ? "resetting" : "stopping";
    setBusy(action);
    onActionChange(action);
    setActionError("");
    setActionMessage("Waiting for managed SITL processes to exit…");
    try {
      await stopManagedSitl({ list: getSitlProcesses, stop: stopSitlProcess }, {
        signal: controller.signal,
        onStatus: (result) => { setStatus(result); setStatusError(""); }
      });
      controller.signal.throwIfAborted();
      if (reset) {
        setActionMessage("SITL stopped. Starting the replacement…");
        const launched = await onLaunch();
        if (!controller.signal.aborted) {
          setActionMessage(launched ? "SITL reset launch started. Check Logs for build and startup progress." : "");
          if (!launched) setActionError("SITL stopped, but the replacement could not launch. Review the status message and Logs, correct the launch settings, then try Build & Launch.");
        }
      } else setActionMessage("All managed SITL processes stopped.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setActionMessage("");
        setActionError(error instanceof Error ? error.message : "SITL maintenance failed. Check Logs and Ports & setup before retrying.");
      }
    } finally {
      maintenance.current = null;
      onActionChange(null);
      if (!controller.signal.aborted) setBusy(null);
    }
  };

  const unavailable = disabled || busy !== null || !status?.processes.length;
  return <section className="sitl-locator" aria-label="Managed SITL controls">
    <div className="file-list-heading"><h2>Managed SITL</h2><button type="button" className="icon-button" aria-label="Refresh SITL processes" disabled={busy !== null} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={15} /></button></div>
    <p>{!status ? "Process status unavailable" : status.processes.length ? status.details.map((process) => `${process.vehicle} · PID ${process.pid} · ${process.status}`).join("; ") : "No managed SITL process running."}</p>
    {status?.details.filter((process) => process.telemetryWarning).map((process) => <p className="panel-warning" role="status" key={process.pid}>{process.telemetryWarning}</p>)}
    <div className="action-grid">
      <button type="button" disabled={unavailable} onClick={() => void maintain(false)}><Square size={15} />{busy === "stopping" ? "Stopping…" : "Stop SITL"}</button>
      <button type="button" disabled={unavailable || launchDisabled} title={launchDisabled ? "Resolve validation errors before resetting SITL" : "Stop managed SITL, wait for exit, then launch with the current options"} onClick={() => void maintain(true)}><RotateCcw size={15} />{busy === "resetting" ? "Resetting…" : "Reset SITL"}</button>
    </div>
    <p>Reset stops the managed simulation, waits for it to exit, then relaunches with the current options. The live telemetry reader has separate controls.</p>
    {actionMessage ? <p role="status">{actionMessage}</p> : null}
    {statusError || actionError ? <p className="panel-error" role="alert">{actionError || statusError}</p> : null}
  </section>;
}
