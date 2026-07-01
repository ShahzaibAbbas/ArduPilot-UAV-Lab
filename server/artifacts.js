import { buildSwarmLayout } from "./sitl.js";

function safeFileName(value, fallback = "uav-design") {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function missionCoordinates(settings = {}) {
  const distanceKm = clamp(numberValue(settings.missionDistanceKm, 2), 0.2, 500);
  const sideKm = Math.max(0.08, distanceKm / 4);
  const baseLat = 24.8607;
  const baseLon = 67.0011;
  const latStep = sideKm / 111.32;
  const lonStep = sideKm / (111.32 * Math.cos((baseLat * Math.PI) / 180));

  return [
    { lat: baseLat, lon: baseLon, alt: 20 },
    { lat: baseLat + latStep, lon: baseLon, alt: 35 },
    { lat: baseLat + latStep, lon: baseLon + lonStep, alt: 35 },
    { lat: baseLat, lon: baseLon + lonStep, alt: 35 }
  ];
}

function scenarioActions(settings = {}) {
  if (settings.testScenario === "wind-gust") {
    return [
      `Set wind speed to ${numberValue(settings.windSpeedMps, 0)} m/s.`,
      `Inject gusts up to ${numberValue(settings.windGustMps, 0)} m/s.`,
      "Verify position hold, attitude recovery, and mission tracking error."
    ];
  }
  if (settings.testScenario === "low-battery") {
    return [
      `Set low reserve to ${numberValue(settings.batteryLowPercent, 20)}%.`,
      `Expect ${settings.batteryFailsafeAction || "RTL"} before critical reserve.`,
      `Expect ${settings.batteryCriticalAction || "Land"} at critical reserve.`
    ];
  }
  if (settings.testScenario === "gps-denied") {
    return [
      "Disable or degrade GPS in the simulator.",
      "Verify optical-flow/rangefinder coverage before arming.",
      "Confirm EKF position-source transition and failsafe behavior."
    ];
  }
  if (settings.testScenario === "sensor-failure") {
    return [
      "Start with nominal sensor data for arming.",
      "Degrade GPS, compass, or rangefinder after takeoff.",
      "Verify failsafe annunciation, mode change, and recovery action."
    ];
  }
  if (settings.testScenario === "payload-endurance") {
    return [
      "Enable payload and companion-computer loads.",
      "Fly the full mission distance profile.",
      "Verify reserve margin remains above the configured low-battery threshold."
    ];
  }
  return ["Run nominal arming, takeoff, route tracking, and return-to-launch checks."];
}

export function generateMissionArtifact(design) {
  const settings = design.settings ?? {};
  const fileName = `${safeFileName(design.name)}-${safeFileName(settings.testScenario || "mission")}.waypoints`;
  const waypoints = missionCoordinates(settings);
  const lines = ["QGC WPL 110"];
  let sequence = 0;

  lines.push(`${sequence++}\t1\t0\t16\t0\t0\t0\t0\t${waypoints[0].lat.toFixed(7)}\t${waypoints[0].lon.toFixed(7)}\t0\t1`);
  lines.push(`${sequence++}\t0\t3\t22\t0\t0\t0\t0\t${waypoints[0].lat.toFixed(7)}\t${waypoints[0].lon.toFixed(7)}\t25\t1`);

  for (const waypoint of waypoints.slice(1)) {
    lines.push(`${sequence++}\t0\t3\t16\t0\t0\t0\t0\t${waypoint.lat.toFixed(7)}\t${waypoint.lon.toFixed(7)}\t${waypoint.alt}\t1`);
  }

  lines.push(`${sequence++}\t0\t3\t20\t0\t0\t0\t0\t0\t0\t0\t1`);

  return {
    fileName,
    mimeType: "text/plain",
    content: `${lines.join("\n")}\n`
  };
}

export function generatePrearmArtifact(design) {
  const settings = design.settings ?? {};
  const requiredComponents = ["frame", "flight-controller", "battery", "power-module"];
  const nodes = Array.isArray(design.nodes) ? design.nodes : [];
  const componentCounts = nodes.reduce((counts, node) => {
    const type = node?.data?.componentType;
    if (type) {
      counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
  }, {});
  const checks = [
    ...requiredComponents.map((type) => ({
      id: `component-${type}`,
      title: `${type.replaceAll("-", " ")} present`,
      expected: Boolean(componentCounts[type]),
      severity: componentCounts[type] ? "pass" : "blocker"
    })),
    {
      id: "battery-threshold-order",
      title: "Battery reserve order",
      expected: numberValue(settings.batteryCriticalPercent, 10) < numberValue(settings.batteryLowPercent, 20),
      severity:
        numberValue(settings.batteryCriticalPercent, 10) < numberValue(settings.batteryLowPercent, 20) ? "pass" : "blocker"
    },
    {
      id: "mission-distance",
      title: "Mission distance configured",
      expected: numberValue(settings.missionDistanceKm, 0) > 0,
      severity: numberValue(settings.missionDistanceKm, 0) > 0 ? "pass" : "warning"
    }
  ];

  const payload = {
    generatedBy: "ArduPilot UAV Lab",
    generatedAt: new Date().toISOString(),
    design: design.name,
    scenario: settings.testScenario || "nominal",
    actions: scenarioActions(settings),
    checks
  };

  return {
    fileName: `${safeFileName(design.name)}-prearm-${safeFileName(settings.testScenario || "nominal")}.json`,
    mimeType: "application/json",
    content: `${JSON.stringify(payload, null, 2)}\n`
  };
}

export function generateJsonBridgeArtifact(design) {
  const settings = design.settings ?? {};
  const swarm = buildSwarmLayout(settings);
  const port = 9002;
  const content = `// Generated by ArduPilot UAV Lab
// Minimal JSON physics bridge process template for ${design.name}
// Run with: node ${safeFileName(design.name)}-json-bridge.js

import dgram from "node:dgram";

const bindHost = "${settings.jsonHost || "127.0.0.1"}";
const bindPort = ${port};
const vehicles = ${JSON.stringify(swarm.vehicles, null, 2)};
const socket = dgram.createSocket("udp4");

function sensorFrame(vehicle) {
  return {
    timestamp: Date.now() / 1000,
    vehicle: vehicle.sysid,
    position: { x: vehicle.x, y: vehicle.y, z: -10 },
    attitude: { roll: 0, pitch: 0, yaw: (vehicle.heading * Math.PI) / 180 },
    velocity: { x: 0, y: 0, z: 0 },
    gyro: { x: 0, y: 0, z: 0 },
    accel: { x: 0, y: 0, z: -9.80665 }
  };
}

socket.on("message", (message, remote) => {
  const text = message.toString("utf8");
  console.log("SITL command", remote.address + ":" + remote.port, text.slice(0, 160));
  for (const vehicle of vehicles) {
    const payload = Buffer.from(JSON.stringify(sensorFrame(vehicle)));
    socket.send(payload, remote.port, remote.address);
  }
});

socket.bind(bindPort, bindHost, () => {
  console.log("JSON bridge listening on " + bindHost + ":" + bindPort);
  console.log("Vehicles:", vehicles.map((vehicle) => "#" + vehicle.sysid + "(" + vehicle.x + "," + vehicle.y + ")").join(" "));
});
`;

  return {
    fileName: `${safeFileName(design.name)}-json-bridge.js`,
    mimeType: "text/javascript",
    content
  };
}

export function generateGazeboWorldArtifact(design) {
  const settings = design.settings ?? {};
  const windSpeed = numberValue(settings.windSpeedMps, 0);
  const gustSpeed = numberValue(settings.windGustMps, 0);
  const swarm = buildSwarmLayout(settings);
  const sensorFailureEnabled = settings.testScenario === "sensor-failure" || settings.testScenario === "gps-denied";
  const models = swarm.vehicles
    .map(
      (vehicle) => `    <model name="uav_${vehicle.sysid}">
      <pose>${vehicle.x} ${vehicle.y} 0 0 0 ${(vehicle.heading * Math.PI) / 180}</pose>
      <static>false</static>
    </model>`
    )
    .join("\n");
  const content = `<?xml version="1.0" ?>
<sdf version="1.7">
  <world name="${safeFileName(design.name)}_${safeFileName(settings.testScenario || "nominal")}">
    <gravity>0 0 -9.80665</gravity>
    <atmosphere type="adiabatic"/>
    <scene>
      <ambient>0.55 0.58 0.62 1</ambient>
      <background>0.82 0.88 0.90 1</background>
    </scene>

${models}

    <plugin name="uav_lab_wind_profile" filename="libgazebo_wind_plugin.so">
      <windVelocityMean>${windSpeed} 0 0</windVelocityMean>
      <windVelocityMax>${Math.max(windSpeed, gustSpeed)} 0 0</windVelocityMax>
      <windVelocityVariance>${Math.max(0, gustSpeed - windSpeed)}</windVelocityVariance>
    </plugin>

    <plugin name="uav_lab_sensor_failure_scenario" filename="libuav_lab_sensor_failure_plugin.so">
      <enabled>${sensorFailureEnabled}</enabled>
      <scenario>${settings.testScenario || "nominal"}</scenario>
      <gpsDropoutAfterSec>${sensorFailureEnabled ? 30 : 0}</gpsDropoutAfterSec>
      <compassBiasDeg>${sensorFailureEnabled ? 18 : 0}</compassBiasDeg>
      <rangefinderNoiseM>${settings.testScenario === "gps-denied" ? 0.35 : 0}</rangefinderNoiseM>
    </plugin>
  </world>
</sdf>
`;

  return {
    fileName: `${safeFileName(design.name)}-${safeFileName(settings.testScenario || "gazebo")}.world`,
    mimeType: "application/xml",
    content
  };
}
