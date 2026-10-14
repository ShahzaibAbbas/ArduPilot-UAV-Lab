import { runOwnedFile } from "./processLifecycle.js";

const displayMarker = "UAV_LAB_DISPLAY=";

// wx.App without a Frame verifies the same GTK/X11/Wayland connection used by
// MAVProxy. It never opens a diagnostic window or relies on DISPLAY alone.
export const runtimeDisplayProbeScript = String.raw`
import importlib, json, os, sys
result = {'available': False, 'wx': False,
          'display': os.environ.get('DISPLAY', '')[:160],
          'waylandDisplay': os.environ.get('WAYLAND_DISPLAY', '')[:160]}
try:
    wx = importlib.import_module('wx')
    result['wx'] = True
    if sys.platform.startswith('linux') and not (result['display'] or result['waylandDisplay']):
        result['reason'] = 'No X11 or Wayland display is configured in the launch environment.'
    else:
        app = wx.App(False)
        result['available'] = True
        app.Destroy()
except (Exception, SystemExit):
    result['reason'] = ('wxPython cannot connect to the configured GUI display.' if result['wx']
                        else 'wxPython is not available in the SITL Python environment.')
print('UAV_LAB_DISPLAY=' + json.dumps(result), flush=True)
`;

export async function runtimeDisplayStatus(runtime, launcher, run = runOwnedFile) {
  if (!runtime.available) return { available: false, wx: false, reason: "Locate an ArduPilot runtime before checking external windows." };
  try {
    const { stdout } = await run(launcher.command, [...launcher.prefixArgs, "-c", runtimeDisplayProbeScript], {
      cwd: launcher.hostCwd, windowsHide: true, timeout: 10000, maxBuffer: 128 * 1024
    });
    const line = String(stdout).split(/\r?\n/).find((entry) => entry.startsWith(displayMarker));
    const result = JSON.parse(line?.slice(displayMarker.length) ?? "null");
    if (!result || typeof result.available !== "boolean" || typeof result.wx !== "boolean") throw new Error("Invalid display probe response");
    return {
      available: result.available, wx: result.wx,
      display: String(result.display || "").slice(0, 160),
      waylandDisplay: String(result.waylandDisplay || "").slice(0, 160),
      reason: result.available ? undefined : result.reason === "No X11 or Wayland display is configured in the launch environment."
        ? result.reason : result.wx
        ? "wxPython cannot connect to the configured GUI display."
        : "wxPython is not available in the SITL Python environment."
    };
  } catch {
    return { available: false, wx: false, reason: "The GUI display probe failed. Check wxPython and the display connection in the selected SITL environment." };
  }
}

export function requireRuntimeDisplay(runtime, display) {
  if (display.available) return;
  const environment = runtime.source === "wsl" ? `WSL ${runtime.distro}` : runtime.source === "cygwin" ? "Cygwin" : "the selected SITL environment";
  throw Object.assign(new Error(`External SITL windows are unavailable in ${environment}. ${display.reason} Run Ports & setup diagnostics, repair the GUI display, or enable Run without external windows.`), { statusCode: 409 });
}
