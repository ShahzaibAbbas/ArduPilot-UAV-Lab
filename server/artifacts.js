import { buildSwarmLayout, generateParamContent } from "./sitl.js";
import { createZip } from "./zip.js";
import { simulatorFrameForFrame } from "./airframes.js";
import { batteryMetrics } from "./batteryModel.js";

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

function nodesOf(design, componentType) {
  return Array.isArray(design.nodes) ? design.nodes.filter((node) => node?.data?.componentType === componentType) : [];
}

function propertyNumber(node, key, fallback = 0) {
  return numberValue(node?.data?.properties?.[key], fallback);
}

function batteryForBom(node) {
  const metrics = batteryMetrics(node?.data?.properties ?? {});
  const errors = metrics.issues.filter((issue) => issue.severity === "error");
  if (errors.length) throw Object.assign(new Error(`Battery ${node?.data?.label || "configuration"}: ${errors.map((issue) => issue.message).join(" ")}`), { statusCode: 400 });
  return metrics;
}

function componentMassG(node) {
  if (node?.data?.componentType === "battery") return batteryForBom(node).massG;
  const specMass = propertyNumber(node, "specMassG", 0);
  if (specMass > 0) {
    return specMass;
  }
  if (node?.data?.componentType === "frame") {
    return propertyNumber(node, "massKg", 1.35) * 1000;
  }
  if (node?.data?.componentType === "camera") {
    return propertyNumber(node, "massG", 45);
  }
  const estimates = {
    "adsb-remote-id": 35,
    "airspeed-sensor": 18,
    buzzer: 10,
    "companion-computer": 95,
    "flight-controller": 42,
    battery: 520,
    camera: 45,
    compass: 12,
    esc: 35,
    frame: 1350,
    gimbal: 180,
    gps: 28,
    motor: 68,
    "optical-flow": 24,
    parachute: 180,
    "power-module": 26,
    rangefinder: 18,
    "telemetry-radio": 22,
    "virtual-telemetry": 8
  };
  return estimates[node?.data?.componentType] ?? 30;
}

function bomRows(design) {
  const nodes = Array.isArray(design.nodes) ? design.nodes : [];
  return nodes.map((node) => {
    const properties = node?.data?.properties ?? {};
    const battery = node?.data?.componentType === "battery" ? batteryForBom(node) : undefined;
    const batteryNotes = battery
      ? `${battery.chemistry} ${battery.seriesCells}S${battery.parallelCells}P; ${battery.capacityMah} mAh total pack; ${battery.nominalVoltageV.toFixed(2)} V nominal / ${battery.fullVoltageV.toFixed(2)} V full; ${battery.energyWh.toFixed(2)} Wh; ${battery.continuousCurrentA.toFixed(2)} A continuous planning limit; ${battery.massSource === "spec" ? "recorded" : "estimated"} mass`
      : "";
    return {
      id: node?.id ?? "",
      componentType: node?.data?.componentType ?? "",
      label: node?.data?.label ?? "",
      manufacturer: properties.specManufacturer ?? "",
      model: properties.specModel || properties.model || properties.board || "",
      partNumber: properties.specPartNumber ?? "",
      massG: Math.round((battery?.massG ?? componentMassG(node)) * 10) / 10,
      unitCostUsd: Math.round(numberValue(properties.specUnitCostUsd, 0) * 100) / 100,
      notes: [properties.specNotes, batteryNotes].filter(Boolean).join("; ")
    };
  });
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function htmlValue(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function generateBomCsvArtifact(design) {
  const rows = bomRows(design);
  const header = ["id", "componentType", "label", "manufacturer", "model", "partNumber", "massG", "unitCostUsd", "notes"];
  const lines = [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvValue(row[key])).join(",")),
    "",
    `total,,,,,,${rows.reduce((sum, row) => sum + row.massG, 0).toFixed(1)},${rows.reduce((sum, row) => sum + row.unitCostUsd, 0).toFixed(2)},`
  ];

  return {
    fileName: `${safeFileName(design.name)}-bill-of-materials.csv`,
    mimeType: "text/csv",
    content: `${lines.join("\n")}\n`
  };
}

export function generateBomHtmlArtifact(design) {
  const rows = bomRows(design);
  const totalMassG = rows.reduce((sum, row) => sum + row.massG, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.unitCostUsd, 0);
  const bodyRows = rows
    .map(
      (row) => `<tr>
  <td>${htmlValue(row.label)}</td>
  <td>${htmlValue(row.componentType)}</td>
  <td>${htmlValue(row.manufacturer)}</td>
  <td>${htmlValue(row.model)}</td>
  <td>${htmlValue(row.partNumber)}</td>
  <td class="num">${row.massG.toFixed(1)}</td>
  <td class="num">${row.unitCostUsd.toFixed(2)}</td>
  <td>${htmlValue(row.notes)}</td>
</tr>`
    )
    .join("\n");
  const content = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${htmlValue(design.name)} Bill of Materials</title>
  <style>
    body { font-family: Inter, Segoe UI, Arial, sans-serif; margin: 32px; color: #1e2930; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    p { margin: 0 0 24px; color: #65747e; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d8e0df; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f4f6f3; }
    .num { text-align: right; white-space: nowrap; }
    .totals { display: flex; gap: 24px; margin: 18px 0; font-weight: 800; }
  </style>
</head>
<body>
  <h1>${htmlValue(design.name)} Bill of Materials</h1>
  <p>Generated by ArduPilot UAV Lab. Print this page to PDF when a PDF copy is needed.</p>
  <div class="totals">
    <span>Total mass: ${(totalMassG / 1000).toFixed(2)} kg</span>
    <span>Total listed cost: $${totalCost.toFixed(2)}</span>
  </div>
  <table>
    <thead>
      <tr><th>Component</th><th>Type</th><th>Manufacturer</th><th>Model</th><th>Part</th><th>Mass (g)</th><th>Cost (USD)</th><th>Notes</th></tr>
    </thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
</body>
</html>
`;

  return {
    fileName: `${safeFileName(design.name)}-bill-of-materials.html`,
    mimeType: "text/html",
    content
  };
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

// Serialized into the standalone export: keep dependencies inside the function
// or pass them explicitly so the downloaded file also runs outside this project.
async function runJsonBridge(configuration, dgram) {
  const bindHost = process.env.UAV_LAB_JSON_BRIDGE_HOST ?? configuration.bindHost;
  const portValue = process.env.UAV_LAB_JSON_BRIDGE_PORT ?? "9002";
  const basePort = /^\d+$/.test(portValue) ? Number(portValue) : NaN;
  if (!Number.isInteger(basePort) || basePort < 1024
    || basePort + (configuration.vehicles.length - 1) * 10 > 65535) {
    throw new Error("JSON bridge base port must keep every instance port between 1024 and 65535.");
  }

  const sockets = [];
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const socket of sockets) {
      try { socket.close(); } catch (error) {
        if (error.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") throw error;
      }
    }
  }
  function socketError(error) {
    console.error("JSON bridge socket error:", error.message);
    process.exitCode = 1;
    stop();
  }
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  function decodeControls(message) {
    if (message.length !== 40 && message.length !== 72) return undefined;
    const channels = message.readUInt16LE(0) === 18458 ? 16 : message.readUInt16LE(0) === 29569 ? 32 : 0;
    if (!channels || message.length !== 8 + channels * 2) return undefined;
    const frameRate = message.readUInt16LE(2);
    if (!frameRate) return undefined;
    return {
      frameRate,
      frameCount: message.readUInt32LE(4),
      pwm: Array.from({ length: channels }, (_unused, index) => message.readUInt16LE(8 + index * 2))
    };
  }

  function sensorFrame(vehicle, timestamp, controls) {
    // Stationary bench model at ground level. Replace this function with a physics
    // step using controls.pwm before evaluating flight dynamics or failure recovery.
    return {
      timestamp,
      imu: { gyro: [0, 0, 0], accel_body: [0, 0, -9.80665] },
      position: [vehicle.x, vehicle.y, 0],
      attitude: [0, 0, vehicle.heading * Math.PI / 180],
      velocity: [0, 0, 0]
    };
  }

  try {
    for (const [index, vehicle] of configuration.vehicles.entries()) {
      if (stopping) return;
      const socket = dgram.createSocket("udp4");
      const port = basePort + index * 10;
      sockets.push(socket);
      let peer;
      socket.on("message", (message, remote) => {
        if (stopping) return;
        const controls = decodeControls(message);
        if (!controls) return;
        const endpoint = remote.address + ":" + remote.port;
        const now = Date.now();
        // One active peer per configured instance; reconnect after five seconds
        // without valid controls. Arbitrary senders cannot grow a peer table.
        if (peer && peer.endpoint !== endpoint && now - peer.lastSeenAt < 5000) return;
        if (!peer || peer.endpoint !== endpoint) peer = { endpoint, timestamp: 0 };
        peer.lastSeenAt = now;
        if (peer.frameCount !== controls.frameCount) {
          if (peer.frameCount !== undefined) {
            const elapsedFrames = (controls.frameCount - peer.frameCount) >>> 0;
            // Unsigned wrap advances normally; a backwards count marks a SITL restart.
            peer.timestamp = elapsedFrames < 0x80000000 ? peer.timestamp + elapsedFrames / controls.frameRate : 0;
          }
          peer.frameCount = controls.frameCount;
          peer.payload = Buffer.from("\n" + JSON.stringify(sensorFrame(vehicle, peer.timestamp, controls)) + "\n");
        }
        // Retransmitted controls receive the identical timestamp and sensor values.
        socket.send(peer.payload, remote.port, remote.address, (error) => { if (error && !stopping) socketError(error); });
      });
      await new Promise((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(port, bindHost, () => {
          socket.off("error", reject);
          socket.on("error", socketError);
          resolve();
        });
      });
      console.log("JSON bridge instance " + index + " / SYS " + vehicle.sysid + " listening on " + bindHost + ":" + port);
    }
    console.log("JSON bridge ready: stationary bench model; PWM dynamics and Gazebo sensor topics require a physics adapter.");
  } catch (error) {
    stop();
    throw error;
  }
}

export function generateJsonBridgeArtifact(design) {
  const settings = design.settings ?? {};
  const swarm = buildSwarmLayout(settings);
  const fileName = `${safeFileName(design.name)}-json-bridge.mjs`;
  const configuration = { bindHost: String(settings.jsonHost || "127.0.0.1"), vehicles: swarm.vehicles };
  const content = `// Generated by ArduPilot UAV Lab
// Standalone stationary bench model for the ArduPilot JSON UDP protocol.
// Run with: node ${fileName}
// Bind ports: 9002 + 10 * instance. Optional environment overrides:
// UAV_LAB_JSON_BRIDGE_HOST and UAV_LAB_JSON_BRIDGE_PORT (base port).
// Protocol: https://github.com/ArduPilot/ardupilot/tree/master/libraries/SITL/examples/JSON
// Flight dynamics, GPS dropout and compass faults require an external physics/sensor adapter.

import dgram from "node:dgram";

const configuration = ${JSON.stringify(configuration, null, 2)};
(${runJsonBridge.toString()})(configuration, dgram).catch((error) => {
  console.error("JSON bridge could not start:", error.message);
  process.exitCode = 1;
});
`;
  return { fileName, mimeType: "text/javascript", content };
}

export function generateGazeboWorldArtifact(design) {
  const settings = design.settings ?? {};
  const windSpeed = numberValue(settings.windSpeedMps, 0);
  const gustSpeed = numberValue(settings.windGustMps, 0);
  const swarm = buildSwarmLayout(settings);
  const sensorFailureEnabled = settings.testScenario === "sensor-failure" || settings.testScenario === "gps-denied";
  const payloadMassKg = nodesOf(design, "camera")
    .concat(nodesOf(design, "gimbal"))
    .reduce((sum, node) => sum + componentMassG(node) / 1000, 0);
  const gpsNoiseM = settings.testScenario === "gps-denied" ? 25 : settings.testScenario === "sensor-failure" ? 8 : 0;
  const sensorDelayMs = settings.testScenario === "sensor-failure" ? 180 : settings.testScenario === "gps-denied" ? 90 : 0;
  const windRampSec = windSpeed > 0 || gustSpeed > 0 ? 20 : 0;
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

    <plugin name="uav_lab::UavLabWindProfilePlugin" filename="libuav_lab_wind_profile_plugin.so">
      <windVelocityMean>${windSpeed} 0 0</windVelocityMean>
      <windVelocityMax>${Math.max(windSpeed, gustSpeed)} 0 0</windVelocityMax>
      <windVelocityVariance>${Math.max(0, gustSpeed - windSpeed)}</windVelocityVariance>
      <windRampSec>${windRampSec}</windRampSec>
    </plugin>

    <plugin name="uav_lab::UavLabSensorFailurePlugin" filename="libuav_lab_sensor_failure_plugin.so">
      <enabled>${sensorFailureEnabled}</enabled>
      <scenario>${settings.testScenario || "nominal"}</scenario>
      <gpsDropoutAfterSec>${sensorFailureEnabled ? 30 : 0}</gpsDropoutAfterSec>
      <compassBiasDeg>${sensorFailureEnabled ? 18 : 0}</compassBiasDeg>
      <rangefinderNoiseM>${settings.testScenario === "gps-denied" ? 0.35 : 0}</rangefinderNoiseM>
      <gpsNoiseM>${gpsNoiseM}</gpsNoiseM>
      <sensorDelayMs>${sensorDelayMs}</sensorDelayMs>
      <payloadMassKg>${payloadMassKg.toFixed(3)}</payloadMassKg>
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

function simulatorReadme(design) {
  const settings = design.settings ?? {};
  const safeName = safeFileName(design.name);
  const worldName = generateGazeboWorldArtifact(design).fileName;
  const missionName = generateMissionArtifact(design).fileName;
  const simFrame = settings.physicsBackend === "json" ? `JSON:${settings.jsonHost || "127.0.0.1"}` : simulatorFrameForFrame(settings.frame || "quad-x");
  return `# ${design.name} Simulator Bundle

Generated by ArduPilot UAV Lab.

## Contents

- design/${safeName}.uav.json: source workspace design
- ardupilot/${safeName}.param: ArduPilot starter parameters
- mission/${missionName}: QGC WPL mission for the selected scenario
- scenario/${generatePrearmArtifact(design).fileName}: pre-arm and scenario checklist
- json-bridge/${generateJsonBridgeArtifact(design).fileName}: standalone Node.js JSON UDP stationary bench model
- gazebo/worlds/${worldName}: Gazebo world with swarm offsets and scenario plugins
- gazebo/plugins: CMake project for UAV Lab Gazebo helper plugins

## SITL

Use the generated parameter file with sim_vehicle.py:

\`\`\`sh
sim_vehicle.py -v ${settings.vehicle || "ArduCopter"} -f ${simFrame} --add-param-file ardupilot/${safeName}.param
\`\`\`

## Gazebo Plugins

From the bundle root:

\`\`\`sh
cd gazebo/plugins
cmake -S . -B build
cmake --build build --config Release
export GAZEBO_PLUGIN_PATH="$PWD/build:$GAZEBO_PLUGIN_PATH"
\`\`\`

The in-app Gazebo helper runs these commands directly when CMake, pkg-config, a C++ compiler, and a supported Gazebo package are available.

## Model and sensor integration limits

The JSON bridge decodes 16/32-channel servo packets and returns newline-framed stationary sensor data. It listens on UDP 9002 + 10 * instance for the configured vehicles. Set UAV_LAB_JSON_BRIDGE_HOST to a local bind address when the JSON backend host is remote. The exported model holds each vehicle at ground level; motor outputs do not drive dynamics.

The Gazebo helper plugins currently report scenario configuration only. The world contains layout models without vehicle geometry, sensor topics, actuator dynamics, or an ArduPilot transport connection. GPS dropout, compass bias, rangefinder noise, delays, wind forces, and payload effects require a real vehicle model and simulator-specific adapters before they can be evaluated.
`;
}

function pluginCmakeFile() {
  return `cmake_minimum_required(VERSION 3.16)
project(uav_lab_gazebo_plugins VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

find_package(PkgConfig REQUIRED)

set(UAV_LAB_GAZEBO_PACKAGE "" CACHE STRING "pkg-config package: gazebo, gz-sim9, gz-sim8, gz-sim7, gz-sim6, or ignition-gazebo6")
set(UAV_LAB_GAZEBO_TARGET "" CACHE STRING "classic or gz-sim")

if(UAV_LAB_GAZEBO_PACKAGE)
  pkg_check_modules(UAV_LAB_GAZEBO REQUIRED \${UAV_LAB_GAZEBO_PACKAGE})
  if(NOT UAV_LAB_GAZEBO_TARGET)
    if(UAV_LAB_GAZEBO_PACKAGE STREQUAL "gazebo")
      set(UAV_LAB_GAZEBO_TARGET "classic")
    else()
      set(UAV_LAB_GAZEBO_TARGET "gz-sim")
    endif()
  endif()
else()
  pkg_check_modules(UAV_LAB_GAZEBO gazebo QUIET)
  if(UAV_LAB_GAZEBO_FOUND)
    set(UAV_LAB_GAZEBO_PACKAGE "gazebo")
    set(UAV_LAB_GAZEBO_TARGET "classic")
  else()
    foreach(candidate gz-sim9 gz-sim8 gz-sim7 gz-sim6 ignition-gazebo6)
      pkg_check_modules(UAV_LAB_GAZEBO \${candidate} QUIET)
      if(UAV_LAB_GAZEBO_FOUND)
        set(UAV_LAB_GAZEBO_PACKAGE "\${candidate}")
        set(UAV_LAB_GAZEBO_TARGET "gz-sim")
        break()
      endif()
    endforeach()
  endif()
endif()

if(NOT UAV_LAB_GAZEBO_FOUND)
  message(FATAL_ERROR "No supported Gazebo development package found. Install gazebo/gz-sim dev packages and pkg-config metadata.")
endif()

if(UAV_LAB_GAZEBO_TARGET STREQUAL "classic")
  set(UAV_LAB_PLUGIN_SOURCE src/uav_lab_classic_plugins.cc)
else()
  set(UAV_LAB_PLUGIN_SOURCE src/uav_lab_gz_sim_plugins.cc)
endif()

function(add_uav_lab_plugin target)
  add_library(\${target} SHARED \${UAV_LAB_PLUGIN_SOURCE})
  target_include_directories(\${target} PRIVATE \${UAV_LAB_GAZEBO_INCLUDE_DIRS})
  target_link_directories(\${target} PRIVATE \${UAV_LAB_GAZEBO_LIBRARY_DIRS})
  target_link_libraries(\${target} PRIVATE \${UAV_LAB_GAZEBO_LIBRARIES})
  target_compile_options(\${target} PRIVATE \${UAV_LAB_GAZEBO_CFLAGS_OTHER})
endfunction()

add_uav_lab_plugin(uav_lab_wind_profile_plugin)
add_uav_lab_plugin(uav_lab_sensor_failure_plugin)

message(STATUS "Building UAV Lab Gazebo plugins for \${UAV_LAB_GAZEBO_PACKAGE} (\${UAV_LAB_GAZEBO_TARGET})")
`;
}

function classicPluginSource() {
  return `#include <gazebo/gazebo.hh>
#include <gazebo/physics/World.hh>
#include <sdf/sdf.hh>
#include <iostream>
#include <string>

namespace
{
template <typename T>
T readElement(const sdf::ElementPtr &sdf, const std::string &name, const T &fallback)
{
  if (sdf && sdf->HasElement(name))
  {
    return sdf->Get<T>(name);
  }
  return fallback;
}

std::string readText(const sdf::ElementPtr &sdf, const std::string &name, const std::string &fallback)
{
  if (sdf && sdf->HasElement(name))
  {
    return sdf->Get<std::string>(name);
  }
  return fallback;
}
}

class UavLabWindProfilePlugin : public gazebo::WorldPlugin
{
public:
  void Load(gazebo::physics::WorldPtr, sdf::ElementPtr sdf) override
  {
    const auto mean = readText(sdf, "windVelocityMean", "0 0 0");
    const auto max = readText(sdf, "windVelocityMax", mean);
    const auto variance = readElement<double>(sdf, "windVelocityVariance", 0.0);
    const auto windRampSec = readElement<double>(sdf, "windRampSec", 0.0);
    std::cout << "[UAV Lab] Wind profile loaded mean=" << mean << " max=" << max << " variance=" << variance
              << " rampSec=" << windRampSec << std::endl;
  }
};

class UavLabSensorFailurePlugin : public gazebo::WorldPlugin
{
public:
  void Load(gazebo::physics::WorldPtr, sdf::ElementPtr sdf) override
  {
    const auto enabled = readElement<bool>(sdf, "enabled", false);
    const auto scenario = readText(sdf, "scenario", "nominal");
    const auto gpsDropoutAfterSec = readElement<double>(sdf, "gpsDropoutAfterSec", 0.0);
    const auto compassBiasDeg = readElement<double>(sdf, "compassBiasDeg", 0.0);
    const auto rangefinderNoiseM = readElement<double>(sdf, "rangefinderNoiseM", 0.0);
    const auto gpsNoiseM = readElement<double>(sdf, "gpsNoiseM", 0.0);
    const auto sensorDelayMs = readElement<double>(sdf, "sensorDelayMs", 0.0);
    const auto payloadMassKg = readElement<double>(sdf, "payloadMassKg", 0.0);
    std::cout << "[UAV Lab] Sensor scenario loaded enabled=" << enabled
              << " scenario=" << scenario
              << " gpsDropoutAfterSec=" << gpsDropoutAfterSec
              << " compassBiasDeg=" << compassBiasDeg
              << " rangefinderNoiseM=" << rangefinderNoiseM
              << " gpsNoiseM=" << gpsNoiseM
              << " sensorDelayMs=" << sensorDelayMs
              << " payloadMassKg=" << payloadMassKg << std::endl;
  }
};

GZ_REGISTER_WORLD_PLUGIN(UavLabWindProfilePlugin)
GZ_REGISTER_WORLD_PLUGIN(UavLabSensorFailurePlugin)
`;
}

function gzSimPluginSource() {
  return `#include <gz/plugin/Register.hh>
#include <gz/sim/System.hh>
#include <sdf/Element.hh>
#include <iostream>
#include <memory>
#include <string>

namespace uav_lab
{
template <typename T>
T readElement(const std::shared_ptr<const sdf::Element> &sdf, const std::string &name, const T &fallback)
{
  if (sdf && sdf->HasElement(name))
  {
    return sdf->Get<T>(name);
  }
  return fallback;
}

std::string readText(const std::shared_ptr<const sdf::Element> &sdf, const std::string &name, const std::string &fallback)
{
  if (sdf && sdf->HasElement(name))
  {
    return sdf->Get<std::string>(name);
  }
  return fallback;
}

class UavLabWindProfilePlugin : public gz::sim::System, public gz::sim::ISystemConfigure
{
public:
  void Configure(const gz::sim::Entity &, const std::shared_ptr<const sdf::Element> &sdf, gz::sim::EntityComponentManager &, gz::sim::EventManager &) override
  {
    const auto mean = readText(sdf, "windVelocityMean", "0 0 0");
    const auto max = readText(sdf, "windVelocityMax", mean);
    const auto variance = readElement<double>(sdf, "windVelocityVariance", 0.0);
    const auto windRampSec = readElement<double>(sdf, "windRampSec", 0.0);
    std::cout << "[UAV Lab] Wind profile loaded mean=" << mean << " max=" << max << " variance=" << variance
              << " rampSec=" << windRampSec << std::endl;
  }
};

class UavLabSensorFailurePlugin : public gz::sim::System, public gz::sim::ISystemConfigure
{
public:
  void Configure(const gz::sim::Entity &, const std::shared_ptr<const sdf::Element> &sdf, gz::sim::EntityComponentManager &, gz::sim::EventManager &) override
  {
    const auto enabled = readElement<bool>(sdf, "enabled", false);
    const auto scenario = readText(sdf, "scenario", "nominal");
    const auto gpsDropoutAfterSec = readElement<double>(sdf, "gpsDropoutAfterSec", 0.0);
    const auto compassBiasDeg = readElement<double>(sdf, "compassBiasDeg", 0.0);
    const auto rangefinderNoiseM = readElement<double>(sdf, "rangefinderNoiseM", 0.0);
    const auto gpsNoiseM = readElement<double>(sdf, "gpsNoiseM", 0.0);
    const auto sensorDelayMs = readElement<double>(sdf, "sensorDelayMs", 0.0);
    const auto payloadMassKg = readElement<double>(sdf, "payloadMassKg", 0.0);
    std::cout << "[UAV Lab] Sensor scenario loaded enabled=" << enabled
              << " scenario=" << scenario
              << " gpsDropoutAfterSec=" << gpsDropoutAfterSec
              << " compassBiasDeg=" << compassBiasDeg
              << " rangefinderNoiseM=" << rangefinderNoiseM
              << " gpsNoiseM=" << gpsNoiseM
              << " sensorDelayMs=" << sensorDelayMs
              << " payloadMassKg=" << payloadMassKg << std::endl;
  }
};
}

GZ_ADD_PLUGIN(uav_lab::UavLabWindProfilePlugin, gz::sim::System, uav_lab::UavLabWindProfilePlugin::ISystemConfigure)
GZ_ADD_PLUGIN_ALIAS(uav_lab::UavLabWindProfilePlugin, "uav_lab::UavLabWindProfilePlugin")

GZ_ADD_PLUGIN(uav_lab::UavLabSensorFailurePlugin, gz::sim::System, uav_lab::UavLabSensorFailurePlugin::ISystemConfigure)
GZ_ADD_PLUGIN_ALIAS(uav_lab::UavLabSensorFailurePlugin, "uav_lab::UavLabSensorFailurePlugin")
`;
}

function buildScriptSh() {
  return `#!/usr/bin/env bash
set -euo pipefail
cmake -S . -B build "$@"
cmake --build build --config Release
echo "Add this folder to Gazebo's plugin path:"
echo "export GAZEBO_PLUGIN_PATH=\\"$PWD/build:$GAZEBO_PLUGIN_PATH\\""
`;
}

function buildScriptPs1() {
  return `$ErrorActionPreference = "Stop"
cmake -S . -B build @args
cmake --build build --config Release
Write-Host "Add this folder to Gazebo's plugin path:"
Write-Host "$PWD\\build"
`;
}

function pluginReadme(design) {
  return `# UAV Lab Gazebo Plugins

Design: ${design.name}

This project builds two helper plugins referenced by the generated world:

- libuav_lab_wind_profile_plugin
- libuav_lab_sensor_failure_plugin

These helpers currently log the configured settings. They do not apply wind forces, alter sensor messages, inject delays or dropouts, or change payload mass. The generated world supplies swarm layout placeholders; connect real vehicle models, sensor topics, actuator dynamics, and the ArduPilot interface before testing those effects. Successful compilation verifies the helper build only.

Supported direct builds use CMake, pkg-config, a C++ compiler, and one of these pkg-config packages: gazebo, gz-sim9, gz-sim8, gz-sim7, gz-sim6, ignition-gazebo6.

Run ./build.sh on Linux/macOS or .\\build.ps1 on Windows shells with a configured compiler environment.
`;
}

export function generateGazeboPluginFiles(design) {
  return [
    { name: "CMakeLists.txt", content: pluginCmakeFile() },
    { name: "README.md", content: pluginReadme(design) },
    { name: "build.sh", content: buildScriptSh() },
    { name: "build.ps1", content: buildScriptPs1() },
    { name: "src/uav_lab_classic_plugins.cc", content: classicPluginSource() },
    { name: "src/uav_lab_gz_sim_plugins.cc", content: gzSimPluginSource() }
  ];
}

export function generateSimulatorBundleArtifact(design) {
  const safeName = safeFileName(design.name);
  const mission = generateMissionArtifact(design);
  const prearm = generatePrearmArtifact(design);
  const bridge = generateJsonBridgeArtifact(design);
  const gazebo = generateGazeboWorldArtifact(design);
  const bomCsv = generateBomCsvArtifact(design);
  const bomHtml = generateBomHtmlArtifact(design);
  const files = [
    { name: "README.md", content: simulatorReadme(design) },
    { name: `design/${safeName}.uav.json`, content: `${JSON.stringify(design, null, 2)}\n` },
    { name: `ardupilot/${safeName}.param`, content: generateParamContent(design) },
    { name: `mission/${mission.fileName}`, content: mission.content },
    { name: `bom/${bomCsv.fileName}`, content: bomCsv.content },
    { name: `bom/${bomHtml.fileName}`, content: bomHtml.content },
    { name: `scenario/${prearm.fileName}`, content: prearm.content },
    { name: `json-bridge/${bridge.fileName}`, content: bridge.content },
    { name: `gazebo/worlds/${gazebo.fileName}`, content: gazebo.content },
    ...generateGazeboPluginFiles(design).map((file) => ({
      name: `gazebo/plugins/${file.name}`,
      content: file.content
    }))
  ];

  return {
    fileName: `${safeName}-simulator-bundle.zip`,
    mimeType: "application/zip",
    files: files.map((file) => file.name),
    content: createZip(files)
  };
}
