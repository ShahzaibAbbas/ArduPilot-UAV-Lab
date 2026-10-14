import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "test-results");
const baseUrl = process.env.UAV_LAB_URL || "http://127.0.0.1:5173/";
// Product expectations are explicit so dropping a preset also fails this test.
const variants = [
  { frame: "fixed-wing", label: "Fixed Wing", vehicle: "ArduPlane" },
  { frame: "fixed-wing-trainer", label: "High-wing Trainer", vehicle: "ArduPlane" },
  { frame: "fixed-wing-flying-wing", label: "Flying Wing / Elevon", vehicle: "ArduPlane", screenshot: true, roundtrip: true, dimensions: [1600, 700, 180] },
  { frame: "fixed-wing-vtail", label: "V-tail Survey Plane", vehicle: "ArduPlane" },
  { frame: "fixed-wing-glider", label: "Motor Glider / Soaring", vehicle: "ArduPlane" },
  { frame: "fixed-wing-twin-boom", label: "Twin-boom Pusher", vehicle: "ArduPlane", screenshot: true },
  { frame: "quadplane", label: "QuadPlane Lift + Cruise", vehicle: "ArduPlane", screenshot: true },
  { frame: "rover", label: "Rover", vehicle: "Rover" },
  { frame: "rover-buggy", label: "Off-road Buggy", vehicle: "Rover", screenshot: true },
  { frame: "rover-skid", label: "Skid-steer 4WD", vehicle: "Rover" },
  { frame: "rover-tracked", label: "Tracked Crawler", vehicle: "Rover", screenshot: true, roundtrip: true, dimensions: [650, 900, 320] },
  { frame: "rover-6x6", label: "Six-wheel Explorer", vehicle: "Rover", screenshot: true },
  { frame: "rover-balancebot", label: "Two-wheel Balance Bot", vehicle: "Rover" }
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
page.setDefaultTimeout(15000);
const pageErrors = [];
const unexpectedActions = [];
const report = { startedAt: new Date().toISOString(), passed: false, variants: [], roundtrips: [], screenshots: [] };
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" && /THREE.WebGLProgram:|Error creating WebGL|WebGL.*(?:error|lost)/i.test(message.text())) {
    pageErrors.push(message.text());
  }
});
await page.addInitScript(() => { window.showSaveFilePicker = undefined; });

// Save downloads exercise the real serializer; the user's local design library is untouched.
await page.route("**/api/designs**", async (route) => {
  if (route.request().method() === "POST") {
    await route.fulfill({ json: { design: route.request().postDataJSON() } });
  } else await route.fulfill({ json: { designs: [] } });
});
await page.route(/\/api\/(?:sitl\/launch|telemetry\/(?:command|listener)|mission\/upload|firmware)(?:\?|$)/, async (route) => {
  if (route.request().method() === "GET") return route.continue();
  unexpectedActions.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
  await route.fulfill({ status: 409, json: { error: "This browser regression does not operate simulators or hardware." } });
});

async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(message);
    await page.waitForTimeout(100);
  }
}

async function createVariant(variant) {
  await page.getByRole("button", { name: "New", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "Start with the mission", exact: true });
  await wizard.getByLabel("Mission / project name", { exact: true }).fill(`Airframe review ${variant.label}`);
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  const family = variant.vehicle === "ArduPlane" ? "Fixed wing" : "Rover";
  await wizard.locator(".vehicle-choice-grid label").filter({ has: page.getByText(family, { exact: true }) }).getByRole("radio").check();
  const choices = wizard.locator('.airframe-choice-grid input[type="radio"]');
  assert.equal(await choices.count(), variant.vehicle === "ArduPlane" ? 7 : 6, "Vehicle family lost one of its preset choices.");
  const choice = wizard.locator(".airframe-choice-grid label").filter({ has: page.getByText(variant.label, { exact: true }) }).getByRole("radio");
  await choice.check();
  assert.equal(await choice.isChecked(), true);
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  assert.ok((await wizard.locator(".mission-review-card").textContent()).includes(variant.label));
  await wizard.getByRole("button", { name: "Create workspace", exact: true }).click();
  await wizard.waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "3D Lab", exact: true }).click();
  await page.getByTestId("three-lab-workspace").locator("canvas").waitFor();
  await until(async () => (await page.getByTestId("airframe-model-label").textContent()).split(" · ")[0] === variant.label,
    `${variant.frame} was not retained in the 3D model label.`);
  const reducedMotion = page.getByRole("button", { name: "Reduced motion", exact: true });
  if (await reducedMotion.getAttribute("aria-pressed") !== "true") await reducedMotion.click();
  await page.getByRole("button", { name: "View airframe", exact: true }).click();
  await until(async () => await page.getByLabel("Select 3D component").inputValue() === "frame-1", "View airframe did not select the actual frame.");
  assert.equal(await page.getByRole("button", { name: "Isolate", exact: true }).getAttribute("aria-pressed"), "true");
  await until(async () => await page.locator(".three-component-label").count() === 1, "View airframe did not isolate one scene object.");
  assert.equal(await page.locator(".three-component-label").textContent(), variant.label);
  assert.equal(await page.getByRole("region", { name: "Selected 3D transform" }).locator("strong").textContent(), variant.label);
  report.variants.push(variant.frame);
  console.log(`PASS wizard and isolated 3D view: ${variant.label}`);
}

async function downloadWorkspace() {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .saq", exact: true }).click();
  const download = await downloaded;
  const workspace = JSON.parse(await readFile(await download.path(), "utf8"));
  await page.getByText("Workspace saved", { exact: true }).waitFor();
  return workspace;
}

async function roundtrip(variant) {
  const position = page.getByLabel("3D position X", { exact: true });
  const yaw = page.getByLabel("3D yaw in degrees", { exact: true });
  await position.fill("1.25");
  await position.press("Enter");
  await yaw.fill("30");
  await yaw.press("Enter");
  const workspace = await downloadWorkspace();
  const design = workspace.design;
  assert.equal(design.settings.frame, variant.frame);
  assert.equal(design.settings.vehicle, variant.vehicle);
  const frame = design.nodes.find((node) => node.data.componentType === "frame");
  assert.equal(frame.data.properties.layout, variant.frame);
  assert.equal(frame.data.label, variant.label);
  assert.deepEqual([frame.data.properties.spanMm, frame.data.properties.lengthMm, frame.data.properties.heightMm], variant.dimensions);
  assert.equal(frame.presentation3d.position.x, 1.25);
  assert.ok(Math.abs(frame.presentation3d.rotation.y - Math.PI / 6) < 0.000001);
  assert.equal(design.lab.viewMode, "3d");
  assert.equal(design.lab.three.isolateSelection, true);
  const motors = design.nodes.filter((node) => node.data.componentType === "motor");
  if (variant.vehicle === "Rover") {
    assert.equal(motors.length, 2);
    assert.ok(motors.every((node) => node.data.properties.propulsionRole === "Ground drive" && node.data.properties.thrustGrams === 0));
  } else {
    assert.equal(motors.length, 1);
    assert.equal(motors[0].data.properties.propulsionRole, "Cruise");
    assert.deepEqual(design.nodes.filter((node) => node.data.componentType === "servo").map((node) => node.data.properties.function),
      ["Left Elevon", "Right Elevon"]);
  }

  // Change the real transform before loading to prove the file restores state.
  await position.fill("4");
  await position.press("Enter");
  await page.getByLabel("Load workspace file", { exact: true }).setInputFiles({
    name: `${variant.frame}.saq`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workspace))
  });
  await page.getByRole("button", { name: "View airframe", exact: true }).click();
  await until(async () => await position.inputValue() === "1.25", `${variant.label} did not restore its saved 3D transform.`);
  assert.equal(await yaw.inputValue(), "30");
  assert.equal((await page.getByTestId("airframe-model-label").textContent()).split(" · ")[0], variant.label);
  const restored = (await downloadWorkspace()).design;
  const restoredFrame = restored.nodes.find((node) => node.data.componentType === "frame");
  assert.deepEqual(restored.settings, design.settings);
  assert.deepEqual(restoredFrame.data.properties, frame.data.properties);
  assert.deepEqual(restoredFrame.presentation3d, frame.presentation3d);
  report.roundtrips.push(variant.frame);
  console.log(`PASS .saq variant and transform roundtrip: ${variant.label}`);
  await page.getByRole("button", { name: "Use automatic layout", exact: true }).click();
  await page.getByRole("button", { name: "View airframe", exact: true }).click();
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  for (const variant of variants) {
    await createVariant(variant);
    if (variant.roundtrip) await roundtrip(variant);
    if (variant.screenshot) {
      const labels = page.getByRole("button", { name: "Labels", exact: true });
      await labels.click();
      await page.waitForTimeout(400);
      const filename = `airframe-${variant.frame}.png`;
      await page.getByTestId("three-lab-workspace").screenshot({ path: path.join(outputDirectory, filename) });
      report.screenshots.push(filename);
      await labels.click();
    }
  }
  assert.deepEqual(pageErrors, [], "Browser or WebGL errors occurred while rendering airframe variants.");
  assert.deepEqual(unexpectedActions, [], "The browser attempted an unrelated simulator or hardware action.");
  assert.equal(report.variants.length, 13);
  assert.equal(report.roundtrips.length, 2);
  report.passed = true;
  console.log("Airframe browser smoke passed: 13 presets, 2 workspace roundtrips, and 6 representative screenshots.");
} catch (error) {
  report.error = error.message;
  await page.screenshot({ path: path.join(outputDirectory, "airframes-smoke-failure.png"), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  report.pageErrors = pageErrors;
  await writeFile(path.join(outputDirectory, "airframes-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
