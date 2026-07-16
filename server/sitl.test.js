import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSystemStatus, parseWslDistros, windowsPathToWslPath } from "./sitl.js";

test("parses WSL distro output and ignores Docker's internal distro", () => {
  const output = "\uFEFFU\0b\0u\0n\0t\0u\0\r\n\0d\0o\0c\0k\0e\0r\0-\0d\0e\0s\0k\0t\0o\0p\0\r\n\0";
  assert.deepEqual(parseWslDistros(output), ["Ubuntu"]);
});

test("converts Windows files to the default WSL mount path without shell interpolation", () => {
  assert.equal(windowsPathToWslPath("C:\\Users\\Pilot Name\\mission.param"), "/mnt/c/Users/Pilot Name/mission.param");
});

test("accepts an exact native sim_vehicle.py path or ArduPilot checkout", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "uav-lab-sitl-"));
  const autotest = path.join(temporaryRoot, "Tools", "autotest");
  const simVehicle = path.join(autotest, "sim_vehicle.py");
  await mkdir(autotest, { recursive: true });
  await writeFile(simVehicle, "#!/usr/bin/env python3\n", "utf8");

  try {
    const byFile = await getSystemStatus(simVehicle);
    const byCheckout = await getSystemStatus(temporaryRoot);
    assert.equal(byFile.sitl.available, true);
    assert.equal(byFile.sitl.source, "native");
    assert.equal(byFile.sitl.path, simVehicle);
    assert.equal(byCheckout.sitl.path, simVehicle);
    assert.equal(byCheckout.sitl.root, temporaryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
