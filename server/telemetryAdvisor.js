const MAVLINK_SEVERITY = {
  0: "Emergency",
  1: "Alert",
  2: "Critical",
  3: "Error",
  4: "Warning",
  5: "Notice",
  6: "Info",
  7: "Debug"
};

function normalized(text) {
  return String(text ?? "").trim().toLowerCase();
}

/**
 * Convert an ArduPilot STATUSTEXT into a bounded, explainable operator hint.
 * The action is a recommendation; the UI must still require an explicit click
 * before sending a flight command.
 */
export function adviseTelemetryMessage({ severity, text, battery } = {}) {
  const numericSeverity = Number.isInteger(severity) ? severity : 6;
  const message = String(text ?? "").trim();
  const value = normalized(message);
  const remaining = typeof battery?.remainingPercent === "number" ? battery.remainingPercent : NaN;
  const batteryContext = value.includes("battery") || value.includes("voltage") || value.includes("cell") || value.includes("power");
  const lowBattery = batteryContext && (value.includes("low") || value.includes("failsafe") || value.includes("critical") || value.includes("below"));
  const batteryCritical = batteryContext && (value.includes("critical") || (Number.isFinite(remaining) && remaining >= 0 && remaining <= 10));
  const failsafe = value.includes("failsafe") || value.includes("rtl") || value.includes("land");

  const badBattery = batteryContext && /\b(?:bad|unhealthy|unavailable|missing)\b|not healthy|not providing data/.test(value);
  const preArmBattery = batteryContext && (/\bpre[- ]?arm\b/.test(value) || value.includes("arming"));
  if (badBattery || preArmBattery) {
    return {
      category: "battery",
      title: badBattery ? "Battery monitor or pack fault" : "Battery arming check failed",
      summary: badBattery ? "Verify the battery monitor and power connections before arming." : "The vehicle cannot arm with its current battery reading or failsafe settings.",
      steps: [
        "Keep the vehicle disarmed while checking the pack and power-module connection.",
        "Verify voltage/current calibration, battery capacity, and low/critical threshold ordering.",
        "For SITL, stop and relaunch after a pack change so simulator voltage and capacity match the design."
      ],
      recommendedAction: undefined,
      severityLabel: MAVLINK_SEVERITY[numericSeverity] ?? `Severity ${numericSeverity}`
    };
  }

  if (lowBattery || batteryCritical) {
    return {
      category: "battery",
      title: batteryCritical ? "Critical battery condition" : "Battery warning",
      summary: batteryCritical
        ? "Battery reserve is critical. Reduce load and land or return immediately."
        : "Battery reserve is low. Confirm the reading and plan a controlled return.",
      steps: [
        "Verify voltage and remaining percentage against a calibrated power module.",
        batteryCritical ? "Use Land when a safe landing area is available." : "Use RTL and avoid high throttle or payload changes.",
        "Inspect the pack, connector, wiring, and failsafe thresholds after recovery."
      ],
      recommendedAction: batteryCritical ? "land" : "rtl",
      severityLabel: MAVLINK_SEVERITY[numericSeverity] ?? `Severity ${numericSeverity}`
    };
  }

  if (failsafe) {
    return {
      category: "failsafe",
      title: "Failsafe condition",
      summary: "The vehicle reported a failsafe. Stabilize the situation before continuing the mission.",
      steps: [
        "Keep the vehicle disarmed on the bench or maintain visual line of sight in flight.",
        "Check RC, telemetry, GPS, and battery links for the source of the failsafe.",
        "Use RTL or Land only after confirming that the mode is safe for this vehicle and location."
      ],
      recommendedAction: "rtl",
      severityLabel: MAVLINK_SEVERITY[numericSeverity] ?? `Severity ${numericSeverity}`
    };
  }

  return {
    category: "general",
    title: numericSeverity <= 2 ? "Critical vehicle message" : "Vehicle message",
    summary: "Review the message and current vehicle state before taking action.",
    steps: [
      "Check the Live vehicle card for battery, GPS, mode, and link state.",
      "Review the Packet Trace for the surrounding MAVLink messages.",
      "Use the command controls only after the vehicle is in a safe state."
    ],
    recommendedAction: undefined,
    severityLabel: MAVLINK_SEVERITY[numericSeverity] ?? `Severity ${numericSeverity}`
  };
}

export function severityLabel(severity) {
  return MAVLINK_SEVERITY[severity] ?? `Severity ${severity}`;
}
