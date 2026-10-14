import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eraser, RefreshCw, Send, TerminalSquare } from "lucide-react";
import { clearSitlConsole, getSitlConsole, getSitlProcesses, sendSitlConsoleInput, type SitlConsoleLine } from "../lib/api";

export function SitlConsolePanel({ disabled = false }: { disabled?: boolean }) {
  const [pid, setPid] = useState<number | null>(null);
  const [lines, setLines] = useState<SitlConsoleLine[]>([]);
  const [consoleState, setConsoleState] = useState<string>("stopped");
  const [consoleReason, setConsoleReason] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let active = true;
    const refresh = async () => {
      try {
        const processes = await getSitlProcesses(controller.signal);
        const process = processes.details.find((entry) => entry.status === "running" || entry.status === "stopping") ?? processes.lastProcess ?? processes.details[0];
        if (!process) {
          if (active) { setPid(null); setConsoleState("stopped"); setConsoleReason(""); setLines([]); setError(""); }
          return;
        }
        const consoleStatus = await getSitlConsole(process.pid, controller.signal);
        if (active) {
          setPid(process.pid);
          setLines(consoleStatus.lines);
          setConsoleState(consoleStatus.state ?? (consoleStatus.available ? "ready" : "unavailable"));
          setConsoleReason(consoleStatus.error || consoleStatus.reason || process.console?.error || process.console?.reason || "");
          setError("");
        }
      } catch (reason) {
        if (active && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : "MAVProxy console is unavailable.");
      } finally {
        if (active && !controller.signal.aborted) timer = window.setTimeout(refresh, 1200);
      }
    };
    void refresh();
    return () => { active = false; controller.abort(); if (timer) window.clearTimeout(timer); };
  }, [disabled, refreshToken]);

  // Follow new output inside the console only. scrollIntoView would also scroll
  // the inspector, hiding the launch settings whenever the SITL panel opens.
  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [lines.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!pid || !command.trim() || busy || consoleState !== "ready") return;
    setBusy(true);
    setError("");
    try {
      await sendSitlConsoleInput(pid, command);
      setCommand("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MAVProxy did not accept the command.");
    } finally { setBusy(false); }
  };

  const clear = async () => {
    if (!pid || busy || consoleState !== "ready") return;
    setBusy(true);
    try { await clearSitlConsole(pid); setLines([]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not clear the console."); }
    finally { setBusy(false); }
  };

  const consoleAvailable = !disabled && Boolean(pid) && consoleState === "ready";
  const stateClass = consoleAvailable ? "good" : consoleState === "unavailable" ? "bad" : "neutral";
  return <section className="sitl-console-panel" aria-label="MAVProxy console">
    <div className="file-list-heading">
      <h2><TerminalSquare size={15} /> MAVProxy console</h2>
      <span className={`status-pill ${stateClass}`}>{pid ? `SITL PID ${pid} · ${consoleState}` : "Waiting for SITL"}</span>
    </div>
    <p className="sitl-console-help">This is the managed MAVProxy output and command channel. Start SITL, then use commands such as <code>status</code>, <code>mode GUIDED</code>, or <code>param show SYSID_THISMAV</code>.</p>
    <pre className="sitl-console-output" aria-live="polite" ref={outputRef}>{lines.length ? lines.map((line, index) => <span className={`sitl-console-line ${line.stream}`} key={`${line.at}-${index}`}><b>{line.stream === "stderr" ? "!" : ">"}</b>{line.text}{"\n"}</span>) : <span className="sitl-console-empty">{pid ? consoleState === "starting" ? "Waiting for MAVProxy readiness…" : "No MAVProxy output captured." : "Build & Launch SITL to open the console."}</span>}</pre>
    <form className="sitl-console-input" onSubmit={(event) => void submit(event)}>
      <input value={command} maxLength={2048} disabled={!consoleAvailable || busy} placeholder={consoleAvailable ? "Enter a MAVProxy command" : consoleReason || "MAVProxy console is unavailable"} aria-label="MAVProxy command" onChange={(event) => setCommand(event.target.value)} />
      <button type="submit" disabled={!consoleAvailable || busy || !command.trim()}><Send size={14} /> Send</button>
      <button type="button" className="secondary-button" disabled={!consoleAvailable || busy || !lines.length} onClick={() => void clear()}><Eraser size={14} /> Clear</button>
      <button type="button" className="icon-button" title="Refresh console" aria-label="Refresh console" disabled={busy} onClick={() => setRefreshToken((current) => current + 1)}><RefreshCw size={14} /></button>
    </form>
    {consoleReason ? <p className="panel-footnote" role="status">{consoleReason}</p> : null}
    {error ? <p className="panel-error" role="alert">{error}</p> : null}
  </section>;
}
