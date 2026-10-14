import type { GcsTargetSettings } from "../domain/design";
import type { GcsLinkStatus } from "../lib/api";

interface BridgeStatus {
  active: boolean;
  pid?: number;
  local?: { host: string; port: number };
  tcp: { host: string; port: number; listening: boolean; clients: number; error?: string; errorCode?: string; lastClientError?: { host: string; port: number; error: string; errorCode?: string; errorAt?: string } };
  upstreamConnected: boolean;
  outputs: Array<{ name?: string; host: string; port: number; dynamic?: boolean; sentPackets?: number; receivedPackets?: number; lastSentAt?: string; lastReceivedAt?: string; error?: string; errorCode?: string; errorAt?: string }>;
  forwardedToGcs?: number;
  forwardedToSitl?: number;
  droppedFrames?: number;
  gcsLinks?: GcsLinkStatus[];
  warnings?: string[];
  error?: string;
  errorCode?: string;
  errorAt?: string;
}

function linkLabel(link: GcsLinkStatus) {
  const transport = link.transport === "tcp" ? "TCP client" : link.dynamic ? "UDP client" : `UDP ${link.name}`;
  return `${transport} ${link.host}:${link.port}`;
}

export function GcsConnectionGuide({ bridge, targets, tcpPort = 5762, labPort = 14552 }: {
  bridge?: BridgeStatus;
  targets: GcsTargetSettings[];
  tcpPort?: number;
  labPort?: number;
}) {
  const destination = targets.find((target) => target.id === "mission-planner" && target.enabled);
  const bridgeError = bridge?.error || bridge?.tcp.error;
  const tcpState = bridge?.tcp.listening ? "listening" : bridge?.error || bridge?.tcp.error ? "failed" : bridge?.active ? "starting" : "stopped";
  const udpOutputs = (bridge?.outputs ?? []).filter((output) => !output.dynamic);
  const links = bridge?.gcsLinks ?? [];
  const connected = links.filter((link) => link.connected);
  const relayPort = bridge?.tcp.port ?? tcpPort;
  const readerPort = bridge?.local?.port ?? labPort;
  return <section className="gcs-connection-guide" aria-label="Mission Planner connection guide">
    <h2>Virtual MAVLink hardware · Mission Planner</h2>
    <p>Start SITL with Build &amp; Launch. The lab presents a virtual telemetry device and relays MAVLink to Mission Planner using one of these options.</p>
    <dl>
      <dt>TCP</dt><dd>Host <code>{bridge?.tcp.host || "127.0.0.1"}</code>, port <code>{relayPort}</code> · {tcpState} ({bridge?.tcp.clients ?? 0} client(s)){bridge?.pid ? ` · API PID ${bridge.pid}` : ""}</dd>
      <dt>UDP</dt><dd>{destination ? <>Select UDP, then listen on port <code>{destination.port}</code> on <code>{destination.host}</code>.</> : "Enable the Mission Planner UDP output in Ground Stations."}</dd>
      <dt>UDPCl</dt><dd>Mission Planner UDPCl (or another client-mode GCS) can send to the lab reader at <code>127.0.0.1:{readerPort}</code>. The lab registers it after its first heartbeat.</dd>
      <dt>Auto-connect</dt><dd>AutoConnect listens on UDP 14550 and 14551 at the same time. Keep only one of those as an enabled lab output, or disable one AutoConnect entry, so Mission Planner holds a single link.</dd>
      <dt>Avoid</dt><dd>TCP <code>5760</code> is MAVProxy&apos;s simulator port: Mission Planner connects but never receives a heartbeat. The HTTP API port cannot carry MAVLink.</dd>
    </dl>
    <p role="status">{!bridge?.active ? "Relay starts with SITL." : bridgeError ? "Relay failed to start or lost its socket." : bridge.upstreamConnected ? "SITL telemetry is reaching the relay." : "Relay listening; waiting for SITL telemetry."} {udpOutputs.length ? `${udpOutputs.length} UDP output(s) configured.` : "No UDP outputs configured."} {bridge?.forwardedToGcs !== undefined ? `${bridge.forwardedToGcs} packet(s) forwarded.` : ""}</p>
    {bridge?.active ? <div className="gcs-link-status" aria-label="Connected ground stations">
      <strong>{connected.length ? `${connected.length} ground station link(s) connected` : "No ground station connected"}</strong>
      {links.length ? <ul className="connection-output-list">{links.map((link) => <li key={`${link.transport}:${link.host}:${link.port}`}>
        <span className={link.connected ? "connection-ok" : ""}>{link.connected ? "Connected" : "Heartbeat lost"}</span> · SYS {link.sysid}/{link.compid} · <code>{linkLabel(link)}</code>
      </li>)}</ul> : <span>{bridge.upstreamConnected ? `Connect Mission Planner to TCP 127.0.0.1:${relayPort}${destination ? ` or UDP ${destination.port}` : ""}; it appears here after its first heartbeat.` : "Ground stations appear here after SITL telemetry starts and they send a heartbeat."}</span>}
    </div> : null}
    {bridge?.warnings?.map((warning) => <p className="panel-warning" role="status" key={warning}>{warning}</p>)}
    {udpOutputs.length ? <ul className="connection-output-list">{udpOutputs.map((output) => <li key={`${output.host}:${output.port}`}><code>{output.host}:{output.port}</code> · sent {output.sentPackets ?? 0}, received {output.receivedPackets ?? 0}{output.error ? ` · ${output.error}` : ""}</li>)}</ul> : null}
    {bridgeError ? <p className="panel-error" role="alert">{bridgeError}{bridge.errorCode ? ` (${bridge.errorCode})` : ""}{bridge.errorAt ? ` · ${new Date(bridge.errorAt).toLocaleTimeString()}` : ""}</p> : null}
    {bridge?.active && !bridge.upstreamConnected ? <p className="panel-footnote">TCP is available, but Mission Planner will not receive vehicle data until a SITL heartbeat reaches the lab UDP listener.</p> : null}
    <p>Give each ground station its own UDP port. The lab UDP reader uses a separate port; the API port serves the web app.</p>
  </section>;
}
