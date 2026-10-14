# Firmware Lab

Firmware Lab accepts `.apj`, `.bin`, `.hex`, and `.elf` files through a bounded `application/octet-stream` upload. Choose a file or drop one onto the upload area. The default limit is 16 MiB and can be changed with `FIRMWARE_UPLOAD_LIMIT_BYTES` (1 KiB to 64 MiB). Invalid server configuration falls back to the default limit.

The server:

- rejects unsafe names, traversal, unsupported extensions, empty files, and oversized bodies;
- assigns a UUID filename under `data/firmware/`;
- stores binary content and JSON metadata separately;
- computes SHA-256 server-side;
- inspects allowlisted APJ metadata fields without decoding or executing the embedded image;
- validates stored record IDs, filename extensions, hashes, and metadata shape, with a 64 KiB metadata read limit;
- never returns a filesystem path to the browser.

Select a flight controller before uploading to attach the record immediately. Files uploaded without a flight controller remain in the library; **Attach to …** links an existing record to the current flight controller and saves the updated association and compatibility result. **Refresh firmware library** picks up records changed by another browser. Removing a record clears matching references in the open workspace.

Compatibility is advisory. Recognized vehicle mismatches and non-controller targets are incompatible. An APJ board ID is matched only to an explicit identifier such as `Board 140` or `140`, never a substring of a product name. A matching vehicle alone still requires board review. APJ image size is the container's declared byte count; encoded string length is not reported as an image size. Malformed APJ content is stored with an inspection warning so it can be reviewed without executing it.

The visual state sequence is:

`VALIDATING → READY → ERASING → FLASHING → VERIFYING → BOOTING → RUNNING`

It is explicitly labeled **workflow simulation**. It is not a hardware flash and uploaded bytes are never passed to a process. Before advancing, the server checks that stored bytes still match the recorded size and SHA-256. Missing or modified content moves the workflow to `FAILED` with an actionable explanation. Known incompatible targets cannot start. This validates storage integrity only; it does not establish whether firmware is safe or valid for hardware.

`STOPPED` is available from the UI and repeated stops do not duplicate events. A workflow can be restarted after stopping or completing. Changing the attached target requires stopping an active simulation. Each workflow retains at most 100 events; the server retains at most 100 workflows, evicting the oldest inactive workflow when needed. When every slot is active, stop a simulation before starting another. Deletion and server shutdown cancel pending timers. Workflow state is temporary and resets after a server restart.

Actual autopilot behavior is provided only by the existing ArduPilot SITL launcher. Firmware Lab shows active SITL processes and merges bounded SITL lifecycle, visual workflow, MAVLink heartbeat, mission, command, ACK, and status-text events into one origin-labeled timeline.

Status requests run without overlapping polling cycles. SITL, telemetry, and firmware status update independently, and a visible message identifies unavailable status sources. The unified timeline retains the latest 60 events displayed from the bounded server sources.

Firmware references saved in `.saq` contain metadata and the hash, not binary content. A reference can therefore outlive a local server record; the workspace remains loadable in that case.

Run the focused parsing, storage-security, integrity, attachment, capacity, and state-transition checks with `node --test server/firmware.test.js`.
