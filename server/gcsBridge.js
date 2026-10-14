import { lookup } from "node:dns/promises";
import { createServer, isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";

const MAX_CLIENTS = 4;
const MAX_OUTPUTS = 16;
const MAX_TCP_PENDING_BYTES = 64 * 1024;
// A full parameter download is a burst of roughly 50 KB. Skip frames for a slow
// TCP reader instead of disconnecting it mid-download; the idle timeout still
// removes a client that never reads.
const MAX_TCP_CLIENT_BACKLOG_BYTES = 512 * 1024;
const MAX_UDP_PENDING = 256;
const MAX_DYNAMIC_CLIENTS = 4;
const UPSTREAM_TIMEOUT_MS = 15000;
const GCS_LINK_TIMEOUT_MS = 5000;
const DYNAMIC_CLIENT_TIMEOUT_MS = 15000;
const endpointKey = ({ host, port }) => `${host}:${port}`;
const settingError = (message) => Object.assign(new Error(message), { statusCode: 400 });
// MAV_TYPE_GCS heartbeats identify Mission Planner, QGroundControl, and MAVProxy links.
const isGcsHeartbeat = (packet) => packet.msgid === 0 && packet.checksumStatus === "valid" && packet.payload[4] === 6;
const isVehicleHeartbeat = (packet) => packet.msgid === 0 && packet.sysid > 0 && packet.payload[5] === 3 && packet.payload[4] !== 6;
const isLoopback = (host) => /^127\./.test(host);
const gcsIdentity = (packet) => ({ sysid: packet.sysid, compid: packet.compid, lastHeartbeatAt: new Date().toISOString() });

export function gcsBridgeOptions(settings = {}) {
  const port = Number(settings.gcsTcpPort ?? 5762);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw settingError("GCS TCP port must be a whole number between 1024 and 65535.");
  return { host: "127.0.0.1", port };
}

async function resolveOutputs(outputs, local) {
  if (!Array.isArray(outputs) || outputs.length > MAX_OUTPUTS) throw settingError(`Configure at most ${MAX_OUTPUTS} GCS UDP outputs.`);
  const localAddresses = new Set(["0.0.0.0", local.host, ...Object.values(networkInterfaces()).flat().filter(Boolean).map((entry) => entry.address)]);
  const resolved = [];
  const seen = new Set();
  for (const output of outputs) {
    if (typeof output?.host !== "string" || output.host.length > 253 || !Number.isInteger(output.port) || output.port < 1 || output.port > 65535) throw settingError("Each GCS output needs a host and a UDP port between 1 and 65535.");
    let timer;
    let host;
    try {
      host = (await Promise.race([
        lookup(output.host, { family: 4 }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(settingError("GCS host lookup timed out. Use an IPv4 address or check the hostname.")), 3000); })
      ])).address;
    } catch (error) {
      throw settingError(`Could not resolve GCS host ${output.host}. Use an IPv4 address or check the hostname.`);
    } finally { clearTimeout(timer); }
    if (output.port === local.port && (host.startsWith("127.") || localAddresses.has(host))) throw settingError("A GCS UDP output cannot use the lab telemetry listener's port on this computer. Use a separate GCS port such as 14550 or 14551.");
    if (host === "0.0.0.0" || host === "255.255.255.255" || Number(host.split(".")[0]) >= 224) throw settingError("GCS output must identify one computer, using a unicast IPv4 address.");
    const key = endpointKey({ host, port: output.port });
    if (!seen.has(key)) resolved.push({ id: String(output.id || "").slice(0, 80), name: String(output.name || "Ground station").slice(0, 120), host, port: output.port });
    seen.add(key);
  }
  return resolved;
}

// TCP uses the same frame parser, trace and UDP send callback as the telemetry
// listener. This module never opens a second MAVLink UDP socket.
export class GcsBridge {
  constructor({ parse, sendUdp, trace }) {
    this.parse = parse;
    this.sendUdp = sendUdp;
    this.trace = trace;
    this.clients = new Set();
    this.clientDetails = new Map();
    this.generation = 0;
    this.state = this.emptyState();
  }

  emptyState() {
    return {
      active: false,
      pid: process.pid,
      startedAt: undefined,
      stoppedAt: undefined,
      local: undefined,
      tcp: { host: "127.0.0.1", port: 5762, listening: false, clients: 0, clientDetails: [] },
      outputs: [],
      forwardedToGcs: 0,
      forwardedToSitl: 0,
      droppedFrames: 0,
      error: undefined,
      errorCode: undefined,
      errorAt: undefined
    };
  }

  status() {
    const links = [
      ...this.state.outputs.filter((output) => output.gcs).map((output) => ({ transport: "udp", host: output.host, port: output.port, name: output.name, dynamic: Boolean(output.dynamic), ...output.gcs })),
      ...(this.state.tcp.clientDetails ?? []).filter((client) => client.gcs).map((client) => ({ transport: "tcp", host: client.host, port: client.port, name: "TCP client", dynamic: false, ...client.gcs }))
    ].map((link) => ({ ...link, connected: Date.now() - Date.parse(link.lastHeartbeatAt) < GCS_LINK_TIMEOUT_MS }));
    const byIdentity = new Map();
    for (const link of links.filter((entry) => entry.connected)) {
      const key = `${link.sysid}/${link.compid}`;
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), link]);
    }
    // Mission Planner AutoConnect listens on UDP 14550 and 14551 at once, so one
    // ground station can hold two live links and send its traffic twice.
    // QGroundControl also defaults to SYS 255/190, so the same identity can be two
    // different applications; the message covers both cases.
    const warnings = [...byIdentity].filter(([, entries]) => entries.length > 1).map(([identity, entries]) => {
      const autoConnect = entries.every((entry) => entry.transport === "udp" && !entry.dynamic && [14550, 14551].includes(entry.port));
      const sameApplication = autoConnect
        ? "If these are one Mission Planner, its AutoConnect is listening on UDP 14550 and 14551 together and its traffic reaches the vehicle twice: disable one lab Ground Station output or one AutoConnect entry."
        : "If these are one ground station, it is connected more than once and its traffic reaches the vehicle twice: close the extra connection.";
      return `Ground station SYS ${identity} is live on ${entries.length} links (${entries.map((entry) => `${entry.transport.toUpperCase()} ${entry.host}:${entry.port}`).join(", ")}). ${sameApplication} If they are different ground stations, give one a different MAVLink system ID so mission and parameter replies are not mixed up.`;
    });
    return structuredClone({ ...this.state, upstreamConnected: this.upstreamConnected(), gcsLinks: links, warnings });
  }

  upstreamConnected() {
    return Boolean(this.state.active && this.state.upstream && Date.now() - Date.parse(this.state.upstream.lastPacketAt) < UPSTREAM_TIMEOUT_MS);
  }

  async start({ tcp = { host: "127.0.0.1", port: 5762 }, outputs = [] } = {}, local) {
    if (tcp.host !== "127.0.0.1" || !isIPv4(tcp.host)) throw settingError("The GCS TCP bridge must bind to 127.0.0.1.");
    const validatedTcp = gcsBridgeOptions({ gcsTcpPort: tcp.port });
    const resolvedOutputs = (await resolveOutputs(outputs, local)).map((output) => ({
      ...output,
      sentPackets: 0,
      receivedPackets: 0,
      lastSentAt: undefined,
      lastReceivedAt: undefined,
      error: undefined,
      errorCode: undefined,
      errorAt: undefined
    }));
    // Relaunching SITL on the same endpoints keeps the relay and its connected
    // ground stations. Mission Planner's TCP link then resumes with the new
    // simulator instead of dropping on every Reset SITL.
    if (this.server && this.state.active && this.state.tcp.listening && this.state.tcp.port === validatedTcp.port
      && this.state.local?.host === local.host && this.state.local?.port === local.port) {
      this.detachUpstream();
      const configured = new Set(resolvedOutputs.map(endpointKey));
      this.state.outputs = [...resolvedOutputs, ...this.state.outputs.filter((output) => output.dynamic && !configured.has(endpointKey(output)))];
      this.state.error = undefined;
      this.state.errorCode = undefined;
      this.state.errorAt = undefined;
      return this.status();
    }
    await this.stop();
    const generation = this.generation;
    this.state = {
      ...this.emptyState(),
      local: { host: local.host, port: local.port },
      tcp: { ...validatedTcp, listening: false, clients: 0, clientDetails: [] },
      outputs: resolvedOutputs
    };
    const server = createServer((client) => this.acceptClient(client, generation));
    this.server = server;
    server.on("error", (error) => {
      if (generation === this.generation) this.setError(error.code === "EADDRINUSE"
        ? `GCS TCP port ${validatedTcp.port} is already in use. Close the application using it or choose another GCS TCP port.`
        : `The GCS TCP bridge failed (${error.code || "socket error"}). Restart SITL to reconnect.`, error.code);
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(validatedTcp.port, validatedTcp.host, () => { server.off("error", reject); resolve(); });
      });
    } catch (error) {
      this.server = undefined;
      server.close();
      throw Object.assign(new Error(this.state.error), { statusCode: 409, cause: error });
    }
    this.state.active = true;
    this.state.tcp.listening = true;
    this.state.local = { host: local.host, port: local.port };
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = undefined;
    return this.status();
  }

  setError(message, code, endpoint, output) {
    const errorAt = new Date().toISOString();
    this.state.error = message;
    this.state.errorCode = code;
    this.state.errorAt = errorAt;
    if (output) {
      output.error = message;
      output.errorCode = code;
      output.errorAt = errorAt;
    }
    if (endpoint) {
      this.state.tcp.lastClientError = { ...endpoint, error: message, errorCode: code, errorAt };
    }
  }

  /** Forget the simulator endpoint after SITL exits; ground station links stay open. */
  detachUpstream() {
    delete this.state.upstream;
  }

  async stop() {
    this.generation += 1;
    const closing = this.server;
    this.server = undefined;
    for (const client of this.clients) client.destroy();
    this.clients.clear();
    this.clientDetails.clear();
    // UDP clients that registered by heartbeat belong to this bridge session only.
    this.state.outputs = this.state.outputs.filter((output) => !output.dynamic);
    this.state.active = false;
    this.state.tcp.listening = false;
    this.state.tcp.clients = 0;
    this.state.tcp.clientDetails = [];
    delete this.state.upstream;
    this.pendingUdp = 0;
    if (this.state.startedAt) this.state.stoppedAt = new Date().toISOString();
    if (closing) await new Promise((resolve) => closing.close(() => resolve()));
  }

  acceptClient(client, generation) {
    if (generation !== this.generation || this.clients.size >= MAX_CLIENTS) { client.destroy(); return; }
    this.clients.add(client);
    this.state.tcp.clients = this.clients.size;
    client.setNoDelay(true);
    client.setTimeout(120000, () => client.destroy());
    const endpoint = { host: client.remoteAddress || "127.0.0.1", port: client.remotePort };
    const clientDetail = { ...endpoint, connectedAt: new Date().toISOString(), sentPackets: 0, receivedPackets: 0, droppedFrames: 0, lastSentAt: undefined, lastReceivedAt: undefined };
    this.clientDetails.set(client, clientDetail);
    this.state.tcp.clientDetails = [...(this.state.tcp.clientDetails || []), clientDetail];
    let pending = Buffer.alloc(0);
    client.on("data", (chunk) => {
      if (generation !== this.generation) return;
      // Each read is bounded by Node's socket buffer. Only an incomplete MAVLink
      // frame (at most 279 bytes) remains between reads.
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        const offset = pending.findIndex((byte) => byte === 0xfe || byte === 0xfd);
        if (offset < 0) { pending = Buffer.alloc(0); break; }
        pending = pending.subarray(offset);
        const headerLength = pending[0] === 0xfe ? 6 : 10;
        if (pending.length < headerLength) break;
        const length = headerLength + pending[1] + 2 + (pending[0] === 0xfd && (pending[2] & 1) ? 13 : 0);
        if (pending.length < length) break;
        const frame = pending.subarray(0, length);
        const packet = this.parse(frame)[0];
        if (packet?.checksumStatus === "valid" && packet.frameLength === length) {
          clientDetail.receivedPackets += 1;
          clientDetail.lastReceivedAt = new Date().toISOString();
          if (isGcsHeartbeat(packet)) clientDetail.gcs = gcsIdentity(packet);
          // The TCP socket is a distinct endpoint from the shared MAVLink UDP
          // listener. Keep trace local/remote fields aligned with the actual
          // transport so GCS diagnostics can identify the path in use.
          this.trace("rx", packet, endpoint, this.tcpEndpoint(), "bridge:tcp");
          this.toUpstream(packet);
          pending = pending.subarray(length);
        } else {
          this.state.droppedFrames += 1;
          pending = pending.subarray(1);
        }
      }
      if (pending.length > MAX_TCP_PENDING_BYTES) {
        this.state.droppedFrames += 1;
        this.setError("A GCS TCP client sent more than the relay buffer can hold.", "TCP_BUFFER_LIMIT", endpoint);
        pending = pending.subarray(-279);
      }
      pending = Buffer.from(pending);
    });
    client.on("error", (error) => {
      this.setError(`GCS TCP client ${endpoint.host}:${endpoint.port} failed (${error.code || "socket error"}).`, error.code || "TCP_SOCKET_ERROR", endpoint);
      client.destroy();
    });
    client.on("close", () => {
      this.clients.delete(client);
      this.clientDetails.delete(client);
      this.state.tcp.clients = this.clients.size;
      this.state.tcp.clientDetails = (this.state.tcp.clientDetails || []).filter((entry) => entry !== clientDetail);
    });
  }

  send(packet, endpoint, correlation, counter) {
    if ((this.pendingUdp || 0) >= MAX_UDP_PENDING) { this.state.droppedFrames += 1; return; }
    const generation = this.generation;
    this.pendingUdp = (this.pendingUdp || 0) + 1;
    const output = this.state.outputs.find((candidate) => endpointKey(candidate) === endpointKey(endpoint));
    this.sendUdp(packet.frame, endpoint).then(() => {
      if (generation !== this.generation) return;
      if (output) {
        output.sentPackets += 1;
        output.lastSentAt = new Date().toISOString();
      }
      this.trace("tx", packet, endpoint, this.state.local, correlation);
      this.state[counter] += 1;
    }).catch((error) => {
      if (generation === this.generation) this.setError(`Could not send MAVLink to ${endpoint.host}:${endpoint.port}. Check the GCS address and network.`, error.code || "UDP_SEND_ERROR", undefined, output);
    }).finally(() => { if (generation === this.generation) this.pendingUdp -= 1; });
  }

  toUpstream(packet) {
    if (!this.upstreamConnected()) { this.state.droppedFrames += 1; return; }
    this.send(packet, this.state.upstream, "bridge:gcs-to-sitl", "forwardedToSitl");
  }

  /**
   * A ground station in client mode (Mission Planner "UDPCl", QGroundControl
   * with a server address) sends to the lab listener port instead of listening
   * on a configured output. Its GCS heartbeat registers it as a session output.
   * Only loopback senders qualify, so a listener bound for WSL does not offer
   * the vehicle to other machines on the network.
   */
  addDynamicClient(endpoint) {
    const now = Date.now();
    this.state.outputs = this.state.outputs.filter((output) => !output.dynamic || now - Date.parse(output.lastReceivedAt) < DYNAMIC_CLIENT_TIMEOUT_MS);
    if (this.state.outputs.filter((output) => output.dynamic).length >= MAX_DYNAMIC_CLIENTS) return undefined;
    const output = {
      id: `udp-client:${endpointKey(endpoint)}`, name: "UDP client", host: endpoint.host, port: endpoint.port, dynamic: true,
      connectedAt: new Date(now).toISOString(), sentPackets: 0, receivedPackets: 0, lastSentAt: undefined, lastReceivedAt: new Date(now).toISOString(),
      error: undefined, errorCode: undefined, errorAt: undefined
    };
    this.state.outputs.push(output);
    return output;
  }

  pruneDynamicClients() {
    const now = Date.now();
    if (now - (this.lastDynamicPrune ?? 0) < 1000) return;
    this.lastDynamicPrune = now;
    this.state.outputs = this.state.outputs.filter((output) => !output.dynamic || now - Date.parse(output.lastReceivedAt) < DYNAMIC_CLIENT_TIMEOUT_MS);
  }

  receive(packet, remote) {
    if (!this.state.active) return false;
    const endpoint = { host: remote.address, port: remote.port };
    const key = endpointKey(endpoint);
    const upstreamKey = this.state.upstream ? endpointKey(this.state.upstream) : undefined;
    let output = this.state.outputs.find((candidate) => endpointKey(candidate) === key);
    // A vehicle heartbeat proves this endpoint is a simulator, not a client-mode GCS.
    if (output?.dynamic && isVehicleHeartbeat(packet)) {
      this.state.outputs = this.state.outputs.filter((candidate) => candidate !== output);
      output = undefined;
    }
    if (!output && key !== upstreamKey && isGcsHeartbeat(packet) && isLoopback(endpoint.host)) output = this.addDynamicClient(endpoint);
    if (output) {
      if (packet.checksumStatus === "valid") {
        output.receivedPackets += 1;
        output.lastReceivedAt = new Date().toISOString();
        if (isGcsHeartbeat(packet)) output.gcs = gcsIdentity(packet);
        this.toUpstream(packet);
      } else this.state.droppedFrames += 1;
      return true;
    }
    if (packet.checksumStatus !== "valid") return false;
    const upstreamStale = this.state.upstream && Date.now() - Date.parse(this.state.upstream.lastPacketAt) >= UPSTREAM_TIMEOUT_MS;
    if ((!this.state.upstream || upstreamStale) && isVehicleHeartbeat(packet)) this.state.upstream = { ...endpoint, sysid: packet.sysid, lastPacketAt: new Date().toISOString() };
    if (!this.state.upstream || endpointKey(this.state.upstream) !== key) return true;
    this.state.upstream.lastPacketAt = new Date().toISOString();
    this.pruneDynamicClients();
    for (const target of this.state.outputs) this.send(packet, target, "bridge:sitl-to-gcs-udp", "forwardedToGcs");
    for (const client of this.clients) {
      if (client.destroyed) continue;
      const detail = this.clientDetails.get(client);
      if (client.writableLength + packet.frame.length > MAX_TCP_CLIENT_BACKLOG_BYTES) {
        this.state.droppedFrames += 1;
        if (detail) detail.droppedFrames += 1;
        continue;
      }
      client.write(packet.frame);
      this.state.forwardedToGcs += 1;
      if (detail) { detail.sentPackets += 1; detail.lastSentAt = new Date().toISOString(); }
      this.trace("tx", packet, { host: client.remoteAddress || "127.0.0.1", port: client.remotePort }, this.tcpEndpoint(), "bridge:sitl-to-gcs-tcp");
    }
    return false;
  }

  tcpEndpoint() {
    return { host: this.state.tcp.host, port: this.state.tcp.port };
  }
}
