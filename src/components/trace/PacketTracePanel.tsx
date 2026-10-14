import { ChevronLeft, ChevronRight, Download, Pause, Play, Radio, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceWorkspaceSettings } from "../../domain/design";
import {
  clearTelemetryTrace,
  exportTelemetryTrace,
  getTelemetryTrace,
  setTelemetryTracePaused,
  type TelemetryTraceEvent,
  type TelemetryTraceStats
} from "../../lib/api";
import { PacketDetails } from "./PacketDetails";
import { PacketTraceTable } from "./PacketTraceTable";
import { TraceTimeline } from "./TraceTimeline";

interface PacketTracePanelProps {
  settings: TraceWorkspaceSettings;
  onSettingsChange: (settings: TraceWorkspaceSettings) => void;
  onSelectPacket?: (event: TelemetryTraceEvent) => void;
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function PacketTracePanel({ settings, onSettingsChange, onSelectPacket }: PacketTracePanelProps) {
  const [events, setEvents] = useState<TelemetryTraceEvent[]>([]);
  const [stats, setStats] = useState<TelemetryTraceStats>();
  const [selected, setSelected] = useState<TelemetryTraceEvent>();
  const [message, setMessage] = useState("Live trace collection is bounded on the server.");
  const [refreshError, setRefreshError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const operationInProgress = useRef(false);
  const requestVersion = useRef(0);

  const filters = useMemo(
    () => ({
      direction: settings.direction,
      protocol: settings.protocol,
      systemId: settings.systemId,
      componentId: settings.componentId,
      messageId: settings.messageId,
      text: settings.text,
      limit: 250
    }),
    [settings]
  );

  const refresh = useCallback(async () => {
    if (operationInProgress.current) return;
    const version = ++requestVersion.current;
    try {
      const result = await getTelemetryTrace(filters);
      if (version !== requestVersion.current || operationInProgress.current) return;
      setEvents(result.events);
      setStats(result.stats);
      setSelected((current) => result.events.find((event) => event.id === current?.id) ?? result.events.at(-1));
      setRefreshError(undefined);
    } catch (error) {
      if (version === requestVersion.current) setRefreshError(error instanceof Error ? error.message : "Trace refresh failed");
    }
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      await refresh();
      if (!cancelled) timer = window.setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      requestVersion.current += 1;
      window.clearTimeout(timer);
    };
  }, [refresh, refreshKey]);

  const chooseEvent = (event: TelemetryTraceEvent) => {
    setSelected(event);
    onSelectPacket?.(event);
  };

  const step = (offset: -1 | 1) => {
    if (events.length === 0) return;
    const currentIndex = selected ? events.findIndex((event) => event.id === selected.id) : -1;
    const nextIndex = Math.max(0, Math.min(events.length - 1, currentIndex < 0 ? events.length - 1 : currentIndex + offset));
    chooseEvent(events[nextIndex]);
  };

  const performAction = async (action: () => Promise<void>, fallback: string) => {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    requestVersion.current += 1;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
    } finally {
      operationInProgress.current = false;
      setBusy(false);
      setRefreshKey((value) => value + 1);
    }
  };

  const togglePaused = () => performAction(async () => {
      const next = await setTelemetryTracePaused(!stats?.paused);
      setStats(next);
      setMessage(next.paused ? "Trace collection paused for all clients. Telemetry continues to update." : "Live trace collection resumed.");
  }, "Could not change trace collection state");

  const clear = () => performAction(async () => {
      const result = await clearTelemetryTrace();
      setEvents([]);
      setSelected(undefined);
      setStats(result.stats);
      setMessage(`${result.cleared} trace event${result.cleared === 1 ? "" : "s"} cleared.`);
  }, "Could not clear trace");

  const exportTrace = (format: "json" | "csv") => performAction(async () => {
      const { limit: _limit, ...exportFilters } = filters;
      const result = await exportTelemetryTrace(format, exportFilters);
      downloadBlob(result.fileName, result.blob);
      setMessage(`${format.toUpperCase()} exported with all buffered packets matching the filters.`);
  }, "Trace export failed");

  const topMessages = stats?.byMessageId.slice(0, 6) ?? [];
  const selectedIndex = events.findIndex((event) => event.id === selected?.id);
  const invalidNumericFilter = [
    { label: "SYS", value: settings.systemId, maximum: 255 },
    { label: "COMP", value: settings.componentId, maximum: 255 },
    { label: "MSG", value: settings.messageId, maximum: 16777215 }
  ].find(({ value, maximum }) => value.trim() && (!/^\d+$/.test(value.trim()) || Number(value) > maximum));

  return (
    <div className="packet-trace-panel" data-testid="packet-trace-panel">
      <section className="trace-summary">
        <div>
          <Radio size={18} />
          <span>
            <strong>{stats?.count ?? 0}</strong>
            buffered
          </span>
        </div>
        <span>RX {stats?.byDirection.rx ?? 0}</span>
        <span>TX {stats?.byDirection.tx ?? 0}</span>
        <span title="Events evicted or too large for the buffer since the server started">Dropped {stats?.droppedCount ?? 0}</span>
        <span>{Math.round((stats?.approximateBytes ?? 0) / 1024)} KB</span>
        <span>{stats ? (stats.paused ? "Collection paused" : "Collecting") : "Connecting…"}</span>
      </section>

      <div className="trace-actions">
        <button type="button" disabled={busy || !stats} onClick={() => void togglePaused()} title="Pause or resume trace collection for all clients; telemetry stays live">
          {stats?.paused ? <Play size={15} /> : <Pause size={15} />}
          {stats?.paused ? "Resume" : "Pause"}
        </button>
        <button type="button" disabled={busy || !stats} onClick={() => void clear()}>
          <Trash2 size={15} /> Clear
        </button>
        <button type="button" disabled={busy || !stats} onClick={() => void exportTrace("json")} title="Export all buffered packets matching the filters">
          <Download size={15} /> JSON
        </button>
        <button type="button" disabled={busy || !stats} onClick={() => void exportTrace("csv")} title="Export all buffered packets matching the filters">
          <Download size={15} /> CSV
        </button>
        <button type="button" onClick={() => onSettingsChange({ direction: "all", protocol: "all", systemId: "", componentId: "", messageId: "", text: "" })}>
          Reset filters
        </button>
      </div>

      <div className="trace-filters">
        <label>
          Direction
          <select value={settings.direction} onChange={(event) => onSettingsChange({ ...settings, direction: event.target.value as TraceWorkspaceSettings["direction"] })}>
            <option value="all">All</option>
            <option value="rx">RX</option>
            <option value="tx">TX</option>
          </select>
        </label>
        <label>
          Protocol
          <select value={settings.protocol} onChange={(event) => onSettingsChange({ ...settings, protocol: event.target.value as TraceWorkspaceSettings["protocol"] })}>
            <option value="all">All</option>
            <option value="MAVLink1">MAVLink 1</option>
            <option value="MAVLink2">MAVLink 2</option>
          </select>
        </label>
        <label>
          SYS
          <input value={settings.systemId} inputMode="numeric" maxLength={3} placeholder="0–255" aria-invalid={invalidNumericFilter?.label === "SYS"} onChange={(event) => onSettingsChange({ ...settings, systemId: event.target.value })} />
        </label>
        <label>
          COMP
          <input value={settings.componentId} inputMode="numeric" maxLength={3} placeholder="0–255" aria-invalid={invalidNumericFilter?.label === "COMP"} onChange={(event) => onSettingsChange({ ...settings, componentId: event.target.value })} />
        </label>
        <label>
          MSG
          <input value={settings.messageId} inputMode="numeric" maxLength={8} placeholder="Message ID" aria-invalid={invalidNumericFilter?.label === "MSG"} onChange={(event) => onSettingsChange({ ...settings, messageId: event.target.value })} />
        </label>
        <label className="trace-text-filter">
          Search
          <input value={settings.text} maxLength={512} placeholder="name, summary, endpoint" onChange={(event) => onSettingsChange({ ...settings, text: event.target.value })} />
        </label>
      </div>

      <p className="panel-message" role="status">
        {invalidNumericFilter ? `${invalidNumericFilter.label} must be a whole number from 0 to ${invalidNumericFilter.maximum}.` : refreshError ?? message}
      </p>
      <p className="panel-message">Showing the latest {events.length} matching packets (up to 250). Exports include all buffered matches. Counters describe the full buffer.</p>

      <section className="trace-counters">
        {topMessages.map((entry) => (
          <button
            type="button"
            key={entry.messageId}
            onClick={() => onSettingsChange({ ...settings, messageId: String(entry.messageId) })}
            title={`Filter by ${entry.messageName}`}
          >
            <strong>{entry.count}</strong>
            <span>{entry.messageName}</span>
          </button>
        ))}
      </section>

      <TraceTimeline events={events} selectedId={selected?.id} onSelect={chooseEvent} />
      <div className="trace-stepper">
        <button type="button" onClick={() => step(-1)} disabled={selectedIndex <= 0}>
          <ChevronLeft size={15} /> Previous
        </button>
        <span>{selected ? `Trace ${selected.id}` : "No selection"}</span>
        <button type="button" onClick={() => step(1)} disabled={selectedIndex < 0 || selectedIndex >= events.length - 1}>
          Next <ChevronRight size={15} />
        </button>
      </div>

      <PacketTraceTable events={events} selectedId={selected?.id} onSelect={chooseEvent} />
      <PacketDetails event={selected} />
    </div>
  );
}
