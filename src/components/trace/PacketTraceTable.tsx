import type { TelemetryTraceEvent } from "../../lib/api";

const highlightedMessages = new Set([0, 1, 24, 30, 33, 43, 44, 47, 51, 73, 76, 77, 147, 253]);

interface PacketTraceTableProps {
  events: TelemetryTraceEvent[];
  selectedId?: number;
  onSelect: (event: TelemetryTraceEvent) => void;
}

export function PacketTraceTable({ events, selectedId, onSelect }: PacketTraceTableProps) {
  if (events.length === 0) {
    return <div className="trace-empty">No packets match the current filters. Start the telemetry reader or adjust the trace filters.</div>;
  }

  return (
    <div className="trace-table-wrap">
      <table className="trace-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Time</th>
            <th>Dir</th>
            <th>Message</th>
            <th>SYS/COMP</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className={`${event.id === selectedId ? "selected" : ""} ${highlightedMessages.has(event.messageId) ? "highlighted" : ""}`}
              tabIndex={0}
              aria-selected={event.id === selectedId}
              aria-label={`Trace ${event.id}, ${event.messageName}, ${event.direction.toUpperCase()}${event.checksumStatus === "invalid" ? ", invalid checksum" : ""}`}
              onClick={() => onSelect(event)}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                  keyEvent.preventDefault();
                  onSelect(event);
                }
              }}
            >
              <td>{event.id}</td>
              <td>{new Date(event.receivedAt).toLocaleTimeString()}</td>
              <td>
                <span className={`trace-direction ${event.direction}`}>{event.direction.toUpperCase()}</span>
              </td>
              <td>
                <strong>{event.messageName}</strong>
                <small>#{event.messageId}</small>
                {event.checksumStatus === "invalid" && <small>Invalid CRC</small>}
              </td>
              <td>
                {event.systemId}/{event.componentId}
              </td>
              <td title={event.summary}>{event.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
