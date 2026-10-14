import { useEffect, useState } from "react";
import { Cable, CheckCircle2, Circle, FolderSearch, RefreshCw, Square } from "lucide-react";
import { getRuntimeStatus, stopSitlProcess, type RuntimeStatus, type SystemStatus, type TelemetryStatus } from "../lib/api";
import type { GcsTargetSettings } from "../domain/design";
import { ExitApplicationButton } from "./ExitApplicationButton";

export function ConnectionsPanel({ system, targets, locating, onDetect, onLocate, onOpenTelemetry, onOpenSimulation, telemetry }: {
  system: SystemStatus | null;
  targets: GcsTargetSettings[];
  locating: boolean;
  onDetect: () => void;
  onLocate: () => void;
  onOpenTelemetry: () => void;
  onOpenSimulation: () => void;
  telemetry?: TelemetryStatus | null;
}) {
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [stopping, setStopping] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    let timer: number;
    const refresh = async () => {
      try { const result = await getRuntimeStatus(); if (active) { setRuntime(result); setError(""); } }
      catch (reason) { if (active) { setRuntime(null); setError(reason instanceof Error ? reason.message : "The local API is unavailable."); } }
      finally { if (active) timer = window.setTimeout(refresh, 3000); }
    };
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [revision]);
  const stopProcess = async (pid: number) => {
    setStopping(pid);
    try { await stopSitlProcess(pid); setRevision(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not stop SITL."); }
    finally { setStopping(null); }
  };
  // Runtime owns the live bridge state. The telemetry prop is only a fallback
  // while the runtime endpoint is being fetched, avoiding stale panel output
  // once a bridge starts or stops.
  const bridge = runtime?.gcsBridge ?? runtime?.telemetry.gcsBridge ?? telemetry?.gcsBridge;
  const bridgeError = bridge?.error || bridge?.tcp.error;
  const bridgeListening = Boolean(bridge?.active && bridge.tcp.listening);
  const bridgeState = bridgeListening ? "Listening" : bridgeError ? "Failed" : bridge?.active ? "Starting" : "Stopped";
  const groundStations = (bridge?.gcsLinks ?? []).filter((link) => link.connected);
  return <div className="detail-content connections-panel">
    <div className="panel-title"><span>Ports & setup</span><button className="icon-button" type="button" aria-label="Refresh connection status" onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /></button></div>
    <p className="panel-introduction">A live view of your browser, local server and simulation connections.</p>
    {error ? <p className="panel-error" role="alert">{error}</p> : null}
    <section className="connection-status-list" aria-label="Connection status">
      <ConnectionRow label="Browser" detail={window.location.host} state="Open" ok />
      <ConnectionRow label="Local API · TCP" detail={runtime ? `${runtime.api.host}:${runtime.api.port}` : "Waiting for local server"} state={runtime ? "Connected" : error ? "Offline" : "Checking"} ok={Boolean(runtime)} />
      <ConnectionRow label="MAVLink listener · UDP" detail={runtime ? `${runtime.telemetry.host}:${runtime.telemetry.port}${runtime.telemetry.pid ? ` · PID ${runtime.telemetry.pid}` : ""}` : "Status unavailable"} state={!runtime ? "Unknown" : runtime.telemetry.active ? "Listening" : runtime.telemetry.error ? "Failed" : "Stopped"} ok={Boolean(runtime?.telemetry.active)} />
      <ConnectionRow label="GCS relay · TCP" detail={bridge ? `${bridge.tcp.host}:${bridge.tcp.port} · ${bridge.tcp.clients} client(s)` : "Not started with SITL"} state={bridge ? bridgeState : "Stopped"} ok={bridgeListening} />
      <ConnectionRow label="Virtual MAVLink hardware" detail={bridge ? `${bridge.tcp.host}:${bridge.tcp.port} TCP · ${bridge.outputs.filter((output) => !output.dynamic).length} UDP output(s)` : "Starts with SITL"} state={bridgeListening ? "Mission Planner ready" : bridge ? bridgeState : "Stopped"} ok={bridgeListening} />
      <ConnectionRow label="Ground stations" detail={groundStations.length ? groundStations.map((link) => `SYS ${link.sysid}/${link.compid} ${link.transport.toUpperCase()} ${link.host}:${link.port}`).join(" · ") : bridgeListening ? "No ground station heartbeat yet" : "Starts with SITL"} state={groundStations.length ? `${groundStations.length} connected` : "None"} ok={groundStations.length > 0} />
      <ConnectionRow label="ArduPilot SITL" detail={!runtime ? "Status unavailable" : runtime.sitl.processes.length ? `${runtime.sitl.processes.length} managed process(es)` : runtime.sitl.lastFailure ? runtime.sitl.lastFailure.message : "No managed process running"} state={!runtime ? "Unknown" : runtime.sitl.running ? "Running" : runtime.sitl.lastFailure ? "Failed" : "Stopped"} ok={Boolean(runtime?.sitl.running)} />
    </section>
    {bridge ? <section className="connection-bridge-status" aria-label="GCS relay details">
      <div className="file-list-heading"><h2>GCS relay</h2><span className={`status-pill ${bridgeListening ? "good" : bridgeError ? "bad" : "neutral"}`}>{bridgeState}</span></div>
      <p>TCP <code>{bridge.tcp.host}:{bridge.tcp.port}</code> · {bridge.tcp.clients} connected client(s). UDP outputs: {bridge.outputs.length}.</p>
      <p>Packets forwarded to Windows GCS: <strong>{bridge.forwardedToGcs}</strong> · commands to SITL: <strong>{bridge.forwardedToSitl}</strong> · dropped: <strong>{bridge.droppedFrames}</strong>.</p>
      {!bridge.upstreamConnected ? <p className="panel-footnote">Waiting for a SITL heartbeat on the lab UDP listener.</p> : null}
      {bridge.warnings?.map((warning) => <p className="panel-warning" role="status" key={warning}>{warning}</p>)}
      <p className="panel-footnote">This virtual MAVLink endpoint is the Mission Planner connection: TCP <code>{bridge.tcp.host}:{bridge.tcp.port}</code> or an enabled UDP output.</p>
      {bridgeError ? <p className="panel-error" role="alert">{bridgeError}</p> : null}
    </section> : null}
    <button className="guide-action" type="button" onClick={onOpenTelemetry}><Cable size={16} />Configure telemetry listener</button>
    <section className="connection-discovery"><div className="file-list-heading"><h2>SITL discovery</h2><span className={`status-pill ${system?.sitl.available ? "good" : "neutral"}`}>{!system ? "Not checked" : system.sitl.available ? "Detected" : "Not detected"}</span></div>
      <p>{system?.sitl.available ? `Found in ${system.sitl.source ?? "native"} environment` : "Search native checkouts, environment paths, Cygwin and WSL."}</p>
      {system?.sitl.displayPath ? <code className="detected-path">{system.sitl.displayPath}</code> : null}
      <div className="file-actions"><button type="button" onClick={onDetect} disabled={locating}><RefreshCw size={16} />{locating ? "Searching…" : "Auto-detect SITL"}</button><button type="button" onClick={onLocate} disabled={locating}><FolderSearch size={16} />Enter location</button></div>
      {system?.sitl.searched?.length ? <details className="search-locations"><summary>Locations checked ({system.sitl.searched.length})</summary><ul>{system.sitl.searched.map((location, index) => <li key={index}>{location}</li>)}</ul></details> : null}
    </section>
    <section><div className="file-list-heading"><h2>Ground station outputs</h2><button className="text-action" type="button" onClick={onOpenSimulation}>Edit</button></div>
      {targets.map(target => <ConnectionRow key={target.id} label={target.name} detail={`${target.host}:${target.port} · UDP destination`} state={target.enabled ? (bridgeListening ? "Relay active" : "Configured · relay stopped") : "Disabled"} ok={Boolean(target.enabled && bridgeListening)} />)}
      <p className="panel-footnote">Configured outputs are destinations, not detected connections. Use a separate UDP port for each local receiver.</p>
    </section>
    {runtime?.sitl.processes.length ? <section><h2>SITL processes</h2>{runtime.sitl.processes.map(process => <div className="sitl-process-row" key={process.pid}><span><strong>{process.vehicle}</strong><small>PID {process.pid} · {process.status}{process.distro ? ` · ${process.distro}` : ""}{process.console ? ` · console ${process.console.state}` : ""}</small>{process.telemetry ? <small>Telemetry {process.telemetry.host}:{process.telemetry.port}</small> : null}{process.error ? <small className="panel-error">{process.error}</small> : null}{process.telemetryWarning ? <small className="panel-warning">{process.telemetryWarning}</small> : null}</span><button type="button" disabled={stopping !== null || process.status === "stopping"} onClick={() => void stopProcess(process.pid)}><Square size={14} />Stop</button></div>)}</section> : null}
    {runtime?.sitl.lastFailure ? <p className="panel-error" role="alert">Last SITL failure: {runtime.sitl.lastFailure.message}{runtime.sitl.lastFailure.code ? ` (${runtime.sitl.lastFailure.code})` : ""}</p> : null}
    <p className="panel-footnote">Firmware flash and boot previews are simulations. Live telemetry and SITL process status are reported separately.</p>
    <ExitApplicationButton />
  </div>;
}

function ConnectionRow({ label, detail, state, ok }: { label: string; detail: string; state: string; ok: boolean }) {
  return <div className="connection-status-row">{ok ? <CheckCircle2 size={17} className="connection-ok" /> : <Circle size={17} />}<div><strong>{label}</strong><code>{detail}</code></div><span className={ok ? "connection-ok" : ""}>{state}</span></div>;
}
