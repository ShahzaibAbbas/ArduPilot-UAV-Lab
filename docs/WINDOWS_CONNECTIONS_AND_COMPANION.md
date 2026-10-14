# Windows connections and companion Linux VM

## Mission Planner

Use **SITL → Build & Launch** first. A running web server, a firmware animation, and a live ArduPilot simulation are separate states. Wait for the telemetry packet count to increase and for the Mission Planner connection guide to report incoming SITL telemetry.

The lab relays MAVLink through its existing UDP reader. This keeps Windows ground station addresses on Windows even when ArduPilot and MAVProxy run in WSL. The default endpoints are:

| Purpose | Protocol | Default endpoint |
| --- | --- | --- |
| Lab telemetry input | UDP | port 14552; bind address selected for the SITL environment |
| QGroundControl output | UDP | 127.0.0.1:14550 |
| Mission Planner output | UDP | 127.0.0.1:14551 |
| Mission Planner / companion TCP relay | MAVLink TCP | 127.0.0.1:5762 |
| Client-mode GCS (Mission Planner UDPCl) | UDP | send to 127.0.0.1:14552 (lab telemetry input) |
| Web API | HTTP | 127.0.0.1:4310 |

In Windows Mission Planner:

1. **TCP (recommended):** select TCP, click Connect, and enter 127.0.0.1 and 5762 (or the MAVLink TCP port configured in the lab). This is the lab relay endpoint; the HTTP API port cannot carry MAVLink. The relay stays open when SITL stops or **Reset SITL** relaunches it, so Mission Planner keeps its link and resumes when the new simulator sends a heartbeat.
2. **UDP:** disable any AutoConnect listener already holding that port, select UDP, click Connect, and enter the configured Mission Planner destination port (14551 by default).
3. **UDPCl:** select UDPCl and enter 127.0.0.1 and the lab telemetry port (14552 by default). The lab registers a loopback client after its first ground-station heartbeat and relays in both directions. Clients from other computers are not registered.
4. **AutoConnect:** its defaults listen on UDP 14550 **and** 14551 at the same time. With both lab outputs enabled, one Mission Planner holds two links and its traffic reaches the vehicle twice. Keep only one of those ports enabled as a lab output, or disable one AutoConnect entry.

Do not use TCP 5760. MAVProxy owns that simulator port, so Mission Planner connects but never receives a heartbeat. Under WSL, Windows also forwards SITL's own SERIAL2 port (TCP 5763) to the simulator. It works but bypasses the lab relay, so the trace and connection status do not see that link.

**Ports & setup** and the SITL **Ground Stations** guide list each connected ground station by its heartbeat: system/component ID, transport, and endpoint. They warn when one identity is live on more than one link. QGroundControl also defaults to SYS 255/190, so give one ground station a different MAVLink system ID when running both.

If SITL and MAVProxy run for 30 seconds without a vehicle heartbeat reaching the lab, the SITL panel names the likely cause. Under WSL NAT this is usually Windows Defender Firewall blocking Node.js on the WSL network. Restarting the telemetry reader while SITL runs also restarts the relay for that simulator.

Use different UDP destination ports if Mission Planner and QGroundControl run together. Ground station output settings apply on the next SITL launch. **Reset SITL** waits for the managed simulation to exit before relaunching with the current settings. **Wipe SITL EEPROM on next launch** adds ArduPilot's wipe option once; an accepted launch clears the checkbox.

The relay carries parameter requests, mission traffic, heartbeats, and commands in both directions. Status distinguishes a listening socket from an upstream heartbeat. Port conflicts produce an actionable error. For WSL under NAT, allow the Node.js telemetry listener through Windows Firewall on the relevant private interface if Windows prompts; the TCP relay remains on loopback. The app does not change firewall rules.

Sources: [Mission Planner connection options](https://ardupilot.org/copter/docs/common-connect-mission-planner-autopilot.html), [Mission Planner AutoConnect defaults](https://github.com/ArduPilot/MissionPlanner/blob/master/ExtLibs/Utilities/AutoConnect.cs), [ArduPilot SITL connections](https://ardupilot.org/dev/docs/using-sitl-for-ardupilot-testing.html).

## Optional companion computer

Add **Companion Computer** from the component library. It appears in both the 2D design and procedural 3D workspace. Select it and open **Inspect** for Linux VM controls. GPIO input/output ports on the companion and autopilot support visual digital wiring; keep a UART or CAN data path for MAVLink. A GPIO wire alone does not provide MAVLink serial transport.

The optional Linux guest uses QEMU x86-64. A Raspberry Pi or Jetson label describes the design component; this guest is an x86-64 development VM, not a board-specific ARM emulator.

1. Install [QEMU](https://www.qemu.org/download/) on the computer running the API. Put `qemu-system-x86_64` and `qemu-img` on PATH, then restart the lab.
2. Obtain an x86-64 Linux installer ISO. In the companion inspector, enter its absolute path on the API computer, set RAM, CPU count, and the new disk capacity, then choose **Install Linux**.
3. Leave the default VNC display and connect a VNC viewer to the local console address shown in the inspector. The **Open a native QEMU window** option can request a host desktop window instead when the QEMU display backend is installed. Complete the Linux installer inside the VM.
4. Shut Linux down cleanly, stop the VM, and choose **Start Linux** to boot its saved disk without the ISO.

Each companion node has its own managed qcow2 disk under `data/companion-vms/`. Limits are four simultaneous machines, 512–8192 MB RAM, 1–4 CPUs, and 8–128 GB initial sparse disk capacity per VM. Existing disks are retained on stop and application exit; changing the new-disk size does not resize an existing disk. Installer paths are transient and are not saved in `.saq` files.

QEMU uses user networking. With SITL and its TCP relay running, guest software can use `tcp:10.0.2.2:5762` to reach the host relay at its default port. Adjust the port if changed in the lab. For example, inside the guest install MAVProxy and run `mavproxy.py --master=tcp:10.0.2.2:5762`; add an `--out` destination for another guest application when needed. The companion inspector shows the current endpoint and has **Open control window** for the VM controls and VNC connection details. The Simulation tab has an embedded MAVProxy console for the managed SITL process; it remains available when **Run without external windows** is enabled. Uncheck that setting when a native sim_vehicle/MAVProxy window is needed and the host/WSL environment has a GUI display.

The Firmware tab can inspect an uploaded `.apj`, `.bin`, `.hex`, or `.elf` file and animate an explicitly labeled flash/boot workflow. That uploaded file is never executed by the API or the companion guest. Actual autopilot behavior comes from the ArduPilot SITL process started by **Build & Launch**. GPIO wires remain design information: there is no physical GPIO passthrough or emulated autopilot GPIO bus in the VM. See [QEMU networking](https://www.qemu.org/docs/master/system/devices/net.html) and [QEMU invocation / VNC](https://www.qemu.org/docs/master/system/invocation.html).

If QEMU is missing, the inspector reports that fact and disables VM launch. VM process state does not claim Linux installation succeeded; use the VNC console to verify the guest.

## Exit and process ownership

Use **Ports & setup → Exit application** to stop lab-owned SITL, MAVProxy/WSL supervisor sessions, companion VMs, terminal/build subprocesses, the MAVLink relay, and telemetry before the API exits. The `npm run app` supervisor then closes its Vite and managed browser children. Closing the managed app window also requests cooperative cleanup. In a regular browser, closing a tab does not stop the API: use Exit application or Ctrl+C in the launcher.

Cleanup targets processes started and tracked by this lab. An unrelated Mission Planner instance, other WSL distributions, and another app holding a port are not terminated. Save the workspace and shut down the guest OS before exiting if it has unsaved changes. A forced OS kill or power loss can bypass cooperative cleanup; commands that deliberately daemonize outside their process group are outside the managed terminal contract.
