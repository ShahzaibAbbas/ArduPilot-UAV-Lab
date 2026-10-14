# Logic and reliability updates

The update preserves the existing workspace and extends its validation, mission, and process behavior.

## Engineering checks

- Competing single-feed connections are errors. Ambiguous wires cannot satisfy a required port or an acceptance check.
- One ESC cannot satisfy the drive path for multiple motors. Shared CAN/I2C buses and the controller's grouped UART interfaces retain their existing behavior.
- Overcurrent protection acceptance requires a battery-connected fuse or protected distribution board.
- Auto-wire can supply a controller from a configured regulated distribution board. It preserves existing ambiguous wiring for review.

## Mission workflows

Browser imports and backend uploads use `server/missionFiles.js`. Imports require the QGC WPL 110 header and complete rows, consecutive unique sequence numbers, supported numeric ranges, and bounded file/item counts. Invalid imports preserve the last valid route. Frame-specific coordinate scaling is shared with MAVLink transfer/export logic.

Single-point, stationary, and empty routes are valid files. Empty uploads are labeled as clearing the vehicle route. Local positions cannot produce a global-distance estimate. Distances are straight-line horizontal estimates, not simulated flight trajectories or full mission-command execution.

The Mission panel exposes import and generated-route selection directly. It disables transfer actions when the listener is unavailable and locks actions while generation or transfer starts. Polling is serialized, aborts on unmount, times out stalled requests, and discards responses from before a transfer began.

Uploads ignore premature success acknowledgments and reject invalid sequence requests. Downloads validate received fields, retain float precision in exports, and acknowledge retransmitted final responses for a bounded recovery window. Tests use synthetic loopback UDP peers.

## JSON simulator export

The exported bridge is a standalone `.mjs` file with the ArduPilot sensor schema, newline framing, 16/32-channel servo decoding, and one UDP socket per configured instance (`9002 + 10 * instance`). Each instance has an independent simulation clock. Duplicate control packets receive the same cached reply; restart counts reset the clock. Active peers are bounded and startup failures release previously opened sockets.

Design names and host settings are serialized safely. The generated file is executed in temporary directories by tests, including swarm routing and malformed-packet cases. It remains a stationary bench model: PWM-driven vehicle dynamics and sensor faults require a real physics adapter.

## Process and test reliability

Owned commands stop their process trees before reporting timeout, output overflow, or cancellation. Concurrent stops share cleanup. Failed spawns resolve exit waits, and launcher children terminated by a signal report failure. Unix descendant cleanup starts when the leader exits, including when inherited output pipes remain open.

Firmware workflow tests use controlled timers instead of short sleeps. API startup tests allow bounded headroom under concurrent load and register cleanup on failure. The validation browser fixture now uses a real analog output when testing a signal mismatch.

Airframe browser checks verify the selected model independently of renderer/dynamics status text, then confirm geometry selection and workspace round trips.

Local `.jetro` daemon state is ignored by Git and source packaging; packaging tests cover nested local state too.

## Verification

```powershell
npm test
npm run build
# With the app running:
npm run test:mission
npm run test:validation
npm run test:improvements
npm run test:smoke
npm run test:airframes
```

Use `UAV_LAB_URL` to target another client port. Mission browser checks mock all API traffic. Validation and improvement checks isolate workspace edits; the main smoke check creates and removes its own temporary visual firmware record. Ordinary unit tests skip opt-in WSL integration and the Unix-only process case on Windows.

Verified on this Windows checkout: 178 unit/integration tests passed, four platform/environment cases skipped, and the production build passed. Mission, validation, improvement, main workspace, and all 13 airframe browser checks passed; airframe checks include two complete save/load round trips. The Three.js vendor chunk retains Vite's existing size advisory. Unix runtime execution was unavailable because the installed WSL distribution has no Node runtime.

## October 2026 review fixes

- A bare simulator model name (`quad`, `hexa`, `octa`) now selects that model's native airframe. `quad` previously resolved to Dual Rotor because both share the `quad` SITL model.
- Performance estimates apply hover throttle and the 1.35:1 thrust-to-weight rule only to multirotors and QuadPlane lift motors. Fixed-wing aircraft are checked against cruise thrust (minimum 0.3:1, scored against 0.8:1).
- Unknown MAVLink values (`hdg`, `vel` = UINT16_MAX, satellites = UINT8_MAX) are reported as unavailable instead of 655.35° or 655.35 m/s.
- Stopping SITL reports success once the process tree stops, even if GCS bridge cleanup fails. Only a failed process stop returns the process to running, and that path restores the previous console state.
- Update Software claims its lock before the first await, so two quick requests cannot both run.
- Custom component saves and deletes are serialized and written atomically. A damaged library returns a clear 422 instead of an opaque 500.
- The SITL low-battery note reports the failsafe actions written to the parameter file.
- Low and critical battery action selects have explicit accessible names.
- The MAVProxy console follows new output inside its own log. It previously used `scrollIntoView`, which also scrolled the inspector and hid the launch settings each time the SITL panel opened.
- Generated JSON bridge tests retry an ephemeral-port collision caused by concurrently running test files.

## Mission Planner relay and SITL connection

- The TCP relay and its connected ground stations survive SITL stop and **Reset SITL**. Only the simulator upstream is released, so the relaunched simulator is pinned at its first heartbeat. The relay fully stops when the telemetry reader stops or the app exits.
- Restarting the telemetry reader while SITL runs restarts the relay for that simulator, so Mission Planner can reconnect without a relaunch.
- Client-mode ground stations (Mission Planner UDPCl) can send to the lab reader port. A loopback sender registers after its first `MAV_TYPE_GCS` heartbeat, is bounded to four clients, and expires after 15 seconds of silence. An endpoint that sends a vehicle heartbeat is never treated as a client.
- Each ground-station link reports its heartbeat identity. The relay warns when one SYS/COMP identity is live on several links, which matches Mission Planner AutoConnect listening on UDP 14550 and 14551 together.
- A slow TCP reader skips frames above a 512 KB backlog instead of being disconnected during the roughly 50 KB parameter burst.
- A watchdog reports a running MAVProxy whose vehicle heartbeat has not reached the lab after 30 seconds, with a WSL firewall diagnosis under NAT.

Live verification used ArduCopter SITL in WSL Ubuntu-24.04 (NAT) and a synthetic Mission Planner client that sends a GCS heartbeat, requests streams and `AUTOPILOT_VERSION`, downloads all parameters, and requests the mission count. TCP 5762, UDP 14551, UDPCl to 14552, and Windows TCP 5763 each received all 1,428 parameters in under one second. TCP 5760 accepted the connection and sent no data. A held TCP link received heartbeats before and after **Reset SITL** without reconnecting.

## Remaining simulator work

Gazebo helpers report configuration; they do not inject wind or sensor failures. Real sensor-topic adapters require vehicle and sensor models, explicit topic bindings, and compilation/runtime evidence against Classic or gz-sim. Those integration checks and physical flight behavior are outside this update's automated evidence.
