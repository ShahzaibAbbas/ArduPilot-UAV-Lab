# MAVLink packet trace

Packet trace extends the existing UDP listener in `server/telemetry.js`; it does not bind a second socket. Parsed RX frames and application TX command/mission frames are recorded in one `TraceBuffer`.

Defaults:

- maximum events: `1000` (`MAVLINK_TRACE_MAX_COUNT`);
- approximate memory: `1 MiB` (`MAVLINK_TRACE_MAX_BYTES`);
- raw frame preview: `96 bytes` (`MAVLINK_TRACE_PREVIEW_BYTES`);
- API result limit: `500` events; the UI displays the latest `250` matches.
- Exports include every matching event still in the buffer, regardless of the UI/API page limit.

Configuration has hard ceilings of 10,000 events, 16 MiB, and 280 preview bytes (the maximum signed MAVLink frame size). Invalid settings use defaults. Byte accounting is approximate serialized event size; when either capacity is reached, the oldest events are evicted. A single oversized event is dropped without flushing previously retained events. The dropped counter is cumulative for the lifetime of the server.

Each event includes a monotonic ID, timestamp, direction, protocol version, endpoints, datagram/frame/payload lengths, sequence, system/component/message IDs, known name, bounded summary, optional mission/command correlation, CRC status, signature presence, and capped hex preview.

CRC checks cover the supported common messages decoded by this application. A supported frame with an invalid CRC is retained for diagnosis and excluded from live vehicle and mission state. Unknown dialect messages remain visible with an unverified CRC. Signature presence is reported, but signatures are **not authenticated**. Packet tracing is not a trusted or authenticated control channel.

The parser supports concatenated MAVLink 1 and 2 frames, signed-frame boundaries, recovery after incomplete framing, and MAVLink 2 trailing-zero payload reconstruction. Unknown incompatibility flags are discarded. Wire payload lengths and previews remain exact even when decoded payloads require zero padding. The parser follows the [MAVLink serialization specification](https://mavlink.io/en/guide/serialization.html), with CRC extras and base lengths from the [official generated message definitions](https://github.com/mavlink/c_library_v2).

Routes under `/api/telemetry/trace` provide recent events, statistics, server-side pause/resume, clear, filters, and bounded JSON or CSV export. JSON exports use the `.mavtrace.json` name and do not claim to be PCAP.

Filters include `direction`, `protocol`, `systemId`/`sysid`, `componentId`/`compid`, `messageId`/`msgid`, text, and a monotonic `afterId`. Numeric filters must be decimal whole numbers; malformed filters return no matches instead of silently returning everything. Text searches include message name, summary, correlation, endpoints, checksum status, and raw hex. CSV cells are escaped and formula-like text is prefixed with an apostrophe to prevent spreadsheet execution. JSON preserves the original text.

Pause and clear apply to the shared server buffer for all clients. Pausing trace collection does not pause UDP telemetry, command handling, or SITL. Clear preserves pause state and monotonic IDs. Resume does not recover packets skipped while paused.

The UI polls a bounded 250-row view without overlapping requests, persists its filters in `.saq`, highlights key telemetry and mission messages, provides a timeline and previous/next stepping, and maps a selected packet to the design flight controller for 3D highlighting. Stale requests cannot restore rows after clear or a filter change. Selection follows the visible results when a packet expires or no longer matches. Rows support Enter/Space keyboard selection; reset filters restores the full view. Counters always describe the entire buffer.

Run `node --test server/trace.test.js` for count/byte caps, filter validation, export completeness, CSV injection protection, pause/clear transitions, CRC validation, signed/truncated frames, and loopback receive/transmit integration. The integration test sends only synthetic packets to local UDP sockets and verifies command CRCs independently of the production encoder.
