import { useEffect, useState } from "react";
import { Check, Clipboard, Cpu, ExternalLink, Play, Square, Wifi } from "lucide-react";
import type { DesignNode } from "../domain/design";
import { getCompanionVms, startCompanionVm, stopCompanionVm, type CompanionVmStatus } from "../lib/companionVmApi";

interface Props {
  node: DesignNode;
  onPropertyChange: (key: string, value: number) => void;
  gcsTcpPort?: number;
}

export function CompanionComputerPanel({ node, onPropertyChange, gcsTcpPort = 5762 }: Props) {
  const [status, setStatus] = useState<CompanionVmStatus | null>(null);
  const [isoPath, setIsoPath] = useState("");
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [controlOpen, setControlOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nativeWindow, setNativeWindow] = useState(false);
  const machine = status?.machines.find((entry) => entry.nodeId === node.id);
  const running = machine && ["starting", "running", "stopping"].includes(machine.state);
  const value = (key: string, fallback: number) => {
    if (key === "vmDiskGb" && machine?.diskExists) return machine.diskGb;
    const saved = Number(node.data.properties[key]);
    return Number.isFinite(saved) && saved > 0 ? saved : fallback;
  };
  const stateLabel = machine?.state === "starting" ? "Starting" : machine?.state === "running" ? "Running" :
    machine?.state === "stopping" ? "Stopping" : machine?.state === "stopped" ? "Stopped" : machine?.state === "failed" ? "Failed" : "Not started";
  const vncEndpoint = machine?.vncPort ? `127.0.0.1:${machine.vncPort}` : "—";
  const mavlinkEndpoint = `tcp:10.0.2.2:${gcsTcpPort}`;
  const copyMavlinkCommand = async () => {
    try {
      await navigator.clipboard.writeText(mavlinkEndpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    const refresh = async () => {
      try {
        const next = await getCompanionVms(controller.signal);
        if (!controller.signal.aborted) { setStatus(next); setPollError(""); }
      } catch (failure) {
        if (!controller.signal.aborted) setPollError(failure instanceof Error ? failure.message : "VM status unavailable.");
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 2500);
      }
    };
    void refresh();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [node.id, revision]);

  const run = async (action: "installer" | "disk" | "stop") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = action === "stop"
        ? await stopCompanionVm(node.id)
        : await startCompanionVm(node.id, {
          memoryMb: value("vmMemoryMb", 2048), cpus: value("vmCpus", 2), diskGb: value("vmDiskGb", 16),
          boot: action, displayMode: nativeWindow ? "window" : "vnc", ...(action === "installer" ? { isoPath: isoPath.trim() } : {})
        });
      setStatus((current) => current ? {
        ...current, machines: [...current.machines.filter((entry) => entry.nodeId !== node.id), result.machine]
      } : current);
      setMessage(result.machine.state === "running" ? "Virtual machine started. Open the VNC console to continue."
        : result.machine.state === "stopped" ? "Virtual machine stopped. Its disk is retained." : `Virtual machine ${result.machine.state}.`);
      if (action === "installer") setIsoPath("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Virtual machine action failed.");
    } finally {
      setBusy(false);
      setRevision((current) => current + 1);
    }
  };

  return <section className="companion-vm-panel" aria-label="Companion Linux virtual machine">
    <h2><Cpu size={16} /> Linux virtual machine</h2>
    <p>Install an x86-64 Linux guest on a persistent virtual disk for this optional companion computer. This guest is a development VM; it does not execute the uploaded flight firmware.</p>
    <div className={`companion-vm-state companion-vm-state-${machine?.state ?? "idle"}`} role="status">
      <span className="companion-vm-state-dot" aria-hidden="true" />
      <strong>{stateLabel}</strong>
      <span>{machine?.diskExists ? "Disk saved" : "No virtual disk"}</span>
      {machine?.pid ? <span>QEMU PID {machine.pid}</span> : null}
    </div>
    {status && !status.runtime.available ? <p>Install <a href="https://www.qemu.org/download/" target="_blank" rel="noreferrer">QEMU</a> with qemu-system-x86_64 and qemu-img on the API computer, add them to PATH, then restart the lab. {status.runtime.message}</p> : null}
    <div className="companion-vm-resources">
      {[
        { key: "vmMemoryMb", label: "Memory (MB)", fallback: 2048, min: 512, max: 8192, step: 512 },
        { key: "vmCpus", label: "CPU cores", fallback: 2, min: 1, max: 4, step: 1 },
        { key: "vmDiskGb", label: "New disk (GB)", fallback: 16, min: 8, max: 128, step: 8 }
      ].map((field) => <label className="field" key={field.key}><span>{field.label}</span><input type="number"
        min={field.min} max={field.max} step={field.step} value={value(field.key, field.fallback)}
        disabled={busy || Boolean(running) || (field.key === "vmDiskGb" && machine?.diskExists)}
        onChange={(event) => onPropertyChange(field.key, Number(event.target.value))} /></label>)}
    </div>
    <label className="field"><span>Linux installer ISO path on the API computer</span><input value={isoPath}
      placeholder="Absolute path to an x86-64 Linux .iso" disabled={busy || Boolean(running)}
      onChange={(event) => setIsoPath(event.target.value)} /></label>
    <label className="toggle-row companion-vm-display-toggle"><input type="checkbox" checked={nativeWindow} disabled={busy || Boolean(running)} onChange={(event) => setNativeWindow(event.target.checked)} /><span>Open a native QEMU window on the API computer</span></label>
    <div className="action-grid">
      <button type="button" disabled={busy || Boolean(running) || !status?.runtime.available || !isoPath.trim()} onClick={() => void run("installer")}>Install Linux</button>
      <button type="button" disabled={busy || Boolean(running) || !status?.runtime.available || !machine?.diskExists} onClick={() => void run("disk")}><Play size={14} />Start Linux</button>
      <button type="button" disabled={busy || !running} onClick={() => void run("stop")}><Square size={14} />Stop VM</button>
    </div>
    {running && machine?.vncPort ? <div className="companion-vm-display-card">
      <div className="companion-vm-display-heading"><span><span className="companion-vm-live-dot" /> VM display available</span><button className="secondary-button" type="button" onClick={() => setControlOpen(true)}><ExternalLink size={14} />Open control window</button></div>
      {machine.displayMode === "window" ? <p>A native QEMU window was requested on the API computer. If it is not visible, use the local VNC viewer at <code>{vncEndpoint}</code>.</p> : <p>Open a VNC viewer on the API computer and connect to <code>{vncEndpoint}</code>. The browser cannot render the VNC protocol directly.</p>}
      <div className="companion-vm-display-meta"><span>Display</span><strong>Local VNC viewer</strong><span>Boot</span><strong>{machine.boot === "installer" ? "Linux installer" : "Saved disk"}</strong></div>
    </div> : <div className="companion-vm-display-card companion-vm-display-idle"><div className="companion-vm-display-heading"><span><span className="companion-vm-live-dot" /> VM display offline</span></div><p>Start the VM to reveal its local VNC display and open the control window.</p></div>}
    <section className="companion-mavlink-card" aria-label="Companion MAVLink connection">
      <h3><Wifi size={14} /> MAVLink connection</h3>
      <p>With SITL and the lab TCP relay running, software inside this VM reaches the host through QEMU's gateway.</p>
      <dl><dt>VM → lab relay</dt><dd><code>{mavlinkEndpoint}</code><button className="icon-button" type="button" title="Copy MAVLink endpoint" aria-label="Copy MAVLink endpoint" onClick={() => void copyMavlinkCommand()}>{copied ? <Check size={13} /> : <Clipboard size={13} />}</button></dd><dt>Use for</dt><dd>Simulated ArduPilot/SITL telemetry and commands</dd></dl>
      <p className="companion-vm-note">Physical firmware upload and hardware UART/CAN are separate from this VM. A GPIO wire in the design canvas is documentation only.</p>
    </section>
    {controlOpen ? <dialog className="companion-vm-dialog" open aria-label="Virtual machine control window">
      <div className="companion-vm-dialog-heading"><div><h3><Cpu size={15} /> Virtual machine control</h3><p>{node.data.label} · {stateLabel}</p></div><button className="icon-button" type="button" aria-label="Close virtual machine control window" onClick={() => setControlOpen(false)}>×</button></div>
      <div className="companion-vm-console"><div className="companion-vm-console-bar"><span className="companion-vm-live-dot" /> QEMU display · {vncEndpoint}</div><div className="companion-vm-console-placeholder"><Cpu size={28} /><strong>{machine?.displayMode === "window" ? "Native QEMU window requested" : "Connect with a VNC viewer"}</strong><span>{vncEndpoint === "—" ? "Start the VM to create a display" : machine?.displayMode === "window" ? "Use the host desktop window, or connect with VNC if the display backend is unavailable" : `Connect to ${vncEndpoint} on this computer`}</span></div></div>
      <div className="companion-vm-dialog-actions"><button type="button" disabled={busy || Boolean(running) || !status?.runtime.available || !isoPath.trim()} onClick={() => void run("installer")}><Play size={14} />Install Linux</button><button type="button" disabled={busy || Boolean(running) || !status?.runtime.available || !machine?.diskExists} onClick={() => void run("disk")}><Play size={14} />Start saved disk</button><button type="button" disabled={busy || !running} onClick={() => void run("stop")}><Square size={14} />Stop</button></div>
      <p className="companion-vm-note">VNC is intentionally local-only ({vncEndpoint}). Do not expose this port to an untrusted network.</p>
    </dialog> : null}
    {message ? <p role="status">{message}</p> : null}
    {error || pollError || machine?.error ? <p className="panel-error" role="alert">{error || pollError || machine?.error}</p> : null}
  </section>;
}
