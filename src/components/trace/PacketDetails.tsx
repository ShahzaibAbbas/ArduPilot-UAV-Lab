import type { TelemetryTraceEvent } from "../../lib/api";

function endpoint(value?: { host: string; port: number }) {
  return value ? `${value.host}:${value.port}` : "Not available";
}

function spacedHex(value: string) {
  return value.match(/.{1,2}/g)?.join(" ") ?? "";
}

export function PacketDetails({ event }: { event?: TelemetryTraceEvent }) {
  if (!event) {
    return <div className="trace-empty">Select a trace event to inspect framing and the capped raw preview.</div>;
  }
  return (
    <section className="packet-details">
      <header>
        <div>
          <strong>{event.messageName}</strong>
          <span>
            {event.protocol} · {event.direction.toUpperCase()} · trace {event.id}
          </span>
        </div>
        <span className={`trace-direction ${event.direction}`}>{event.direction.toUpperCase()}</span>
      </header>
      <dl>
        <div>
          <dt>Timestamp</dt>
          <dd>{event.receivedAt}</dd>
        </div>
        <div>
          <dt>System / component</dt>
          <dd>
            {event.systemId} / {event.componentId}
          </dd>
        </div>
        <div>
          <dt>Sequence</dt>
          <dd>{event.sequence}</dd>
        </div>
        <div>
          <dt>Checksum</dt>
          <dd>{event.checksumStatus === "valid" ? "Valid CRC" : event.checksumStatus === "invalid" ? "Invalid CRC · excluded from live telemetry" : "Unverified · unknown message definition"}</dd>
        </div>
        <div>
          <dt>Signature</dt>
          <dd>{event.signed ? "Present · not authenticated" : "Not present"}</dd>
        </div>
        <div>
          <dt>Datagram</dt>
          <dd>{event.datagramLength} bytes</dd>
        </div>
        <div>
          <dt>Frame / payload</dt>
          <dd>
            {event.frameLength} / {event.payloadLength} bytes
          </dd>
        </div>
        <div>
          <dt>Remote</dt>
          <dd>{endpoint(event.remote)}</dd>
        </div>
        <div>
          <dt>Local</dt>
          <dd>{endpoint(event.local)}</dd>
        </div>
        <div>
          <dt>Correlation</dt>
          <dd>{event.correlation ?? "None"}</dd>
        </div>
      </dl>
      <p>{event.summary}</p>
      <div className="packet-hex">
        <span>Raw frame preview · {event.rawPreviewHex.length / 2} of {event.frameLength} bytes{event.rawPreviewHex.length / 2 < event.frameLength ? " · truncated" : ""}</span>
        <code>{spacedHex(event.rawPreviewHex) || "No raw preview"}</code>
      </div>
    </section>
  );
}
