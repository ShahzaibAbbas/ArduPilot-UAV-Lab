import { CircuitBoard, Link, Play, RefreshCw, RotateCcw, Square, Trash2, Waves } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignNode, SimulationSettings } from "../../domain/design";
import {
  attachFirmware,
  deleteFirmware,
  getFirmwareWorkflow,
  getSitlProcesses,
  getTelemetryTrace,
  listFirmware,
  startFirmwareWorkflow,
  stopFirmwareWorkflow,
  resetFirmwareWorkflow,
  wipeFirmwareWorkflow,
  uploadFirmware,
  type FirmwareRecord,
  type FirmwareWorkflow,
  type SitlProcessStatus,
  type TelemetryTraceEvent
} from "../../lib/api";
import { FirmwareDropzone } from "./FirmwareDropzone";
import { FirmwareMetadataPanel } from "./FirmwareMetadataPanel";
import { FirmwareStateTimeline } from "./FirmwareStateTimeline";
import type { UnifiedFirmwareEvent } from "./firmwareTypes";

interface FirmwareLabProps {
  targetNode?: DesignNode;
  settings: SimulationSettings;
  sitlBusy: boolean;
  onAttach: (firmware: FirmwareRecord) => void;
  onDetach?: (firmwareId: string) => void;
  onLaunchSitl: () => void;
}

const allowedExtensions = new Set(["apj", "bin", "hex", "elf"]);

export function FirmwareLab({ targetNode, settings, sitlBusy, onAttach, onDetach, onLaunchSitl }: FirmwareLabProps) {
  const [records, setRecords] = useState<FirmwareRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workflow, setWorkflow] = useState<FirmwareWorkflow>();
  const [sitl, setSitl] = useState<SitlProcessStatus>({ processes: [], details: [], events: [] });
  const [mavlinkEvents, setMavlinkEvents] = useState<TelemetryTraceEvent[]>([]);
  const [uploadLimitBytes, setUploadLimitBytes] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [message, setMessage] = useState("Uploaded firmware is stored for inspection only and is never executed by the server.");
  const workflowVersion = useRef(0);
  const workflowMutation = useRef(false);
  const selected = records.find((record) => record.id === selectedId);
  const selectedWorkflow = workflow?.firmwareId === selectedId ? workflow : undefined;
  const workflowActive = selectedWorkflow && ["VALIDATING", "READY", "ERASING", "FLASHING", "VERIFYING", "BOOTING"].includes(selectedWorkflow.state);
  const flightController = targetNode?.data.componentType === "flight-controller" ? targetNode : undefined;
  const runningSitl = sitl.details.filter((process) => process.status === "running");

  const refreshRecords = useCallback(async () => {
    const result = await listFirmware();
    setRecords(result.firmware);
    setUploadLimitBytes(result.uploadLimitBytes);
    setSelectedId((current) => result.firmware.some((record) => record.id === current) ? current : result.firmware[0]?.id || "");
  }, []);

  useEffect(() => {
    refreshRecords().catch((error: Error) => setMessage(error.message));
  }, [refreshRecords]);

  useEffect(() => {
    let mounted = true;
    let timer: number | undefined;
    const refresh = async () => {
      const version = workflowVersion.current;
      const workflowPending = workflowMutation.current;
      const [nextSitl, trace, nextWorkflow] = await Promise.allSettled([
        getSitlProcesses(),
        getTelemetryTrace({ limit: 80 }),
        selectedId ? getFirmwareWorkflow(selectedId) : Promise.resolve(undefined)
      ]);
      if (!mounted) return;
      const unavailable: string[] = [];
      if (nextSitl.status === "fulfilled") setSitl(nextSitl.value);
      else unavailable.push("SITL");
      if (trace.status === "fulfilled") {
        setMavlinkEvents(trace.value.events.filter((event) => [0, 43, 44, 47, 51, 73, 76, 77, 253].includes(event.messageId)));
      } else unavailable.push("telemetry");
      if (version === workflowVersion.current && !workflowPending && !workflowMutation.current) {
        if (nextWorkflow.status === "fulfilled") setWorkflow(nextWorkflow.value?.workflow);
        else unavailable.push("firmware workflow");
      }
      setStatusMessage(unavailable.length ? `Waiting for ${unavailable.join(", ")} status. Previous results may be out of date.` : "");
      timer = window.setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [selectedId]);

  const unifiedEvents = useMemo<UnifiedFirmwareEvent[]>(
    () =>
      [
        ...(selectedWorkflow?.events.map((event) => ({
          id: event.id,
          timestamp: event.timestamp,
          origin: event.origin,
          state: event.state,
          message: event.message
        })) ?? []),
        ...sitl.events.map((event) => ({
          id: event.id,
          timestamp: event.timestamp,
          origin: "SITL" as const,
          state: event.state,
          message: event.message
        })),
        ...mavlinkEvents.map((event) => ({
          id: `trace-${event.id}`,
          timestamp: event.receivedAt,
          origin: event.direction === "rx" ? ("MAVLink RX" as const) : ("MAVLink TX" as const),
          state: event.messageName,
          message: event.summary
        }))
      ]
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .slice(-60),
    [mavlinkEvents, sitl.events, selectedWorkflow?.events]
  );

  const handleUpload = async (file: File) => {
    if (busy) return;
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!allowedExtensions.has(extension)) {
      setMessage("Supported firmware types are .apj, .bin, .hex, and .elf.");
      return;
    }
    if (uploadLimitBytes && file.size > uploadLimitBytes) {
      setMessage(`Firmware upload exceeds the ${uploadLimitBytes} byte limit.`);
      return;
    }
    if (!file.size) {
      setMessage("Choose a non-empty firmware file.");
      return;
    }

    setBusy(true);
    setUploading(true);
    setMessage("Hashing and inspecting firmware on the local server…");
    try {
      const result = await uploadFirmware(file, {
        selectedNodeId: flightController?.id,
        selectedBoard: flightController ? String(flightController.data.properties.board ?? "") : undefined,
        selectedComponentType: flightController?.data.componentType,
        linkedVehicle: settings.vehicle
      });
      setRecords((current) => [result.firmware, ...current.filter((record) => record.id !== result.firmware.id)].slice(0, 200));
      setUploadLimitBytes(result.uploadLimitBytes);
      setSelectedId(result.firmware.id);
      setWorkflow(undefined);
      if (result.firmware.selectedNode.nodeId) onAttach(result.firmware);
      setMessage(`${result.firmware.originalName} stored and inspected. Uploaded bytes were not executed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Firmware upload failed");
    } finally {
      setUploading(false);
      setBusy(false);
    }
  };

  const handleStart = async () => {
    if (!selected || busy) return;
    workflowVersion.current += 1;
    workflowMutation.current = true;
    setBusy(true);
    try {
      const result = await startFirmwareWorkflow(selected.id);
      workflowVersion.current += 1;
      setWorkflow(result.workflow);
      setMessage(result.workflow.state === "FAILED"
        ? result.workflow.events.at(-1)?.message ?? "Firmware validation failed. Upload the original file again."
        : "Visual erase/flash/verify/boot simulation started. This is not a hardware flash.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the visual workflow");
    } finally {
      workflowVersion.current += 1;
      workflowMutation.current = false;
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (!selected || busy) return;
    workflowVersion.current += 1;
    workflowMutation.current = true;
    setBusy(true);
    try {
      const result = await stopFirmwareWorkflow(selected.id);
      workflowVersion.current += 1;
      setWorkflow(result.workflow);
      setMessage("Visual firmware workflow stopped.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop the visual workflow");
    } finally {
      workflowVersion.current += 1;
      workflowMutation.current = false;
      setBusy(false);
    }
  };

  const handleAttach = async () => {
    if (!selected || !flightController) return;
    setBusy(true);
    try {
      const { firmware } = await attachFirmware(selected.id, {
        selectedNodeId: flightController.id,
        selectedBoard: String(flightController.data.properties.board ?? ""),
        selectedComponentType: flightController.data.componentType,
        linkedVehicle: settings.vehicle
      });
      setRecords((current) => current.map((record) => record.id === firmware.id ? firmware : record));
      onAttach(firmware);
      setMessage(`${firmware.originalName} attached to ${flightController.data.label}. ${firmware.compatibility.message}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not attach firmware");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await deleteFirmware(selected.id);
      onDetach?.(selected.id);
      const remaining = records.filter((record) => record.id !== selected.id);
      setRecords(remaining);
      setSelectedId(remaining[0]?.id ?? "");
      setWorkflow(undefined);
      setMessage("Firmware record and stored bytes removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove firmware");
    } finally {
      setBusy(false);
    }
  };

  const handleWipe = async () => {
    if (!selected || busy) return;
    workflowVersion.current += 1;
    workflowMutation.current = true;
    setBusy(true);
    try {
      const result = await wipeFirmwareWorkflow(selected.id);
      workflowVersion.current += 1;
      setWorkflow(result.workflow);
      setMessage("Simulation state wiped. The uploaded firmware record and bytes were retained.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not wipe the visual workflow");
    } finally {
      workflowVersion.current += 1;
      workflowMutation.current = false;
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!selected || busy) return;
    workflowVersion.current += 1;
    workflowMutation.current = true;
    setBusy(true);
    try {
      const result = await resetFirmwareWorkflow(selected.id);
      workflowVersion.current += 1;
      setWorkflow(result.workflow);
      setMessage(result.workflow.state === "FAILED"
        ? result.workflow.events.at(-1)?.message ?? "Firmware validation failed. Upload the original file again."
        : "Visual workflow reset and restarted from validation. This remains a simulation.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not reset the visual workflow");
    } finally {
      workflowVersion.current += 1;
      workflowMutation.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="firmware-lab" data-testid="firmware-lab">
      <section className="simulation-disclosure">
        <CircuitBoard size={20} />
        <div>
          <strong>Visual firmware workflow simulation</strong>
          <span>Erase, flash, verify, and boot states are educational visualization. ArduPilot behavior runs only through SITL.</span>
        </div>
      </section>

      <FirmwareDropzone
        disabled={busy}
        uploading={uploading}
        targetLabel={flightController?.data.label}
        uploadLimitBytes={uploadLimitBytes}
        onFile={(file) => void handleUpload(file)}
        onError={setMessage}
      />
      <p className="panel-message" role="status">
        {message}
      </p>
      {statusMessage ? <p className="firmware-warning" role="status">{statusMessage}</p> : null}
      <button className="firmware-refresh" type="button" disabled={busy} onClick={() => void refreshRecords().catch((error: Error) => setMessage(error.message))}>
        <RefreshCw size={15} /> Refresh firmware library
      </button>

      {records.length > 0 ? (
        <label className="firmware-record-select">
          Firmware record
          <select value={selectedId} disabled={busy} onChange={(event) => setSelectedId(event.target.value)}>
            {records.map((record) => (
              <option key={record.id} value={record.id}>
                {record.originalName} · {record.sha256.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="trace-empty">No firmware records stored.</div>
      )}

      {selected ? (
        <>
          <FirmwareMetadataPanel firmware={selected} />
          <FirmwareStateTimeline workflow={selectedWorkflow} />
          <div className="firmware-actions">
            <button type="button" onClick={() => void handleAttach()} disabled={busy || !flightController || Boolean(workflowActive)}>
              <Link size={15} /> {flightController ? `Attach to ${flightController.data.label}` : "Select a flight controller to attach"}
            </button>
            <button type="button" onClick={() => void handleStart()} disabled={busy || Boolean(workflowActive) || selected.compatibility.status === "incompatible"}>
              <Play size={15} /> Start visual workflow
            </button>
            <button type="button" onClick={() => void handleStop()} disabled={busy || !selectedWorkflow || ["EMPTY", "STOPPED", "FAILED"].includes(selectedWorkflow.state)}>
              <Square size={15} /> Stop
            </button>
            <button type="button" onClick={() => void handleReset()} disabled={busy || selected.compatibility.status === "incompatible"} title="Restart the simulation from validation; uploaded bytes are retained">
              <RotateCcw size={15} /> Reset simulation
            </button>
            <button type="button" onClick={() => void handleWipe()} disabled={busy} title="Clear simulated workflow state; uploaded bytes are retained">
              <Waves size={15} /> Wipe simulation state
            </button>
            <button className="danger" type="button" onClick={() => void handleDelete()} disabled={busy}>
              <Trash2 size={15} /> Remove
            </button>
          </div>
        </>
      ) : null}

      <section className="sitl-link-card">
        <div>
          <strong>Actual ArduPilot execution</strong>
          <span>
            {runningSitl.length > 0
              ? `SITL running · PID ${runningSitl.map((process) => process.pid).join(", ")}`
              : `${settings.vehicle} ${settings.frame} · SITL not running`}
          </span>
        </div>
        <button type="button" onClick={onLaunchSitl} disabled={sitlBusy}>
          {sitlBusy ? <RefreshCw className="spin" size={15} /> : <Play size={15} />}
          {sitlBusy ? "Starting…" : "Build & launch SITL"}
        </button>
      </section>

      <section className="firmware-event-log">
        <h3>Boot and protocol timeline</h3>
        {unifiedEvents.length > 0 ? (
          <ol>
            {unifiedEvents.map((event) => (
              <li key={`${event.origin}-${event.id}`}>
                <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                <span className={`event-origin origin-${event.origin.toLowerCase().replaceAll(" ", "-")}`}>{event.origin}</span>
                <strong>{event.state}</strong>
                <p>{event.message}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="trace-empty">Start the visual workflow or SITL to populate the unified timeline.</div>
        )}
      </section>
    </div>
  );
}
