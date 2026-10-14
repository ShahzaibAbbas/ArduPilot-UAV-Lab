export const SITL_TELEMETRY_GRACE_MS = 30_000;

/**
 * MAVProxy is running but no vehicle heartbeat has reached the lab: name the
 * likely cause instead of leaving the relay "waiting for SITL telemetry".
 * Returns undefined while telemetry is healthy or MAVProxy is still starting.
 */
export function sitlTelemetryWarning({ mavproxyStartedAt, now = Date.now(), listener, upstreamConnected, plan }) {
  if (upstreamConnected || !mavproxyStartedAt || now - Date.parse(mavproxyStartedAt) < SITL_TELEMETRY_GRACE_MS) return undefined;
  const port = plan?.telemetry?.port ?? listener?.port;
  if (!listener?.active) return `The lab telemetry reader is stopped, so SITL output to UDP ${port} is not received. Start the reader in Live or use Reset SITL.`;
  // Under WSL NAT, MAVProxy sends to the Windows host address across the virtual network.
  if (plan?.source === "wsl" && plan.telemetry?.host && plan.telemetry.host !== "127.0.0.1") {
    return `SITL and MAVProxy are running in WSL, but no vehicle heartbeat has reached the lab on UDP ${port} from ${plan.telemetry.host}. Windows Defender Firewall is probably blocking Node.js on the WSL network: allow Node.js for private networks (or enable WSL mirrored networking), then use Reset SITL.`;
  }
  return `SITL and MAVProxy are running, but no vehicle heartbeat has reached the lab on UDP ${port}. Check the MAVProxy console for errors and make sure no other program is using that port, then use Reset SITL.`;
}
