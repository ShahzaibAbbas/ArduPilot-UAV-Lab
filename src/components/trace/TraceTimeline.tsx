import type { TelemetryTraceEvent } from "../../lib/api";

export function TraceTimeline({
  events,
  selectedId,
  onSelect
}: {
  events: TelemetryTraceEvent[];
  selectedId?: number;
  onSelect: (event: TelemetryTraceEvent) => void;
}) {
  const timelineEvents = events.slice(-64);
  // An empty strip reads as a broken control; the empty-state message explains what to do instead.
  if (timelineEvents.length === 0) return null;
  return (
    <div className="trace-timeline" aria-label="Recent packet timeline">
      {timelineEvents.map((event) => (
        <button
          type="button"
          key={event.id}
          className={`${event.direction} ${event.id === selectedId ? "selected" : ""}`}
          title={`${event.id} · ${event.messageName} · ${event.summary}`}
          aria-label={`Trace ${event.id} ${event.messageName}`}
          aria-pressed={event.id === selectedId}
          onClick={() => onSelect(event)}
        />
      ))}
    </div>
  );
}
