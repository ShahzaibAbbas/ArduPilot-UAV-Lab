import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const baseUrl = process.env.UAV_LAB_URL || "http://127.0.0.1:5173/";
const outputDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test-results");
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(15000);
const pageErrors = [];
const unexpectedActions = [];
let battery = { voltageV: 16.8, remainingPercent: 100, chargeState: 1, faultBitmask: 0 };
let armed = true;
let fixtureRevision = 0;
let servedRevision = -1;
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (request.method() !== "GET") {
    unexpectedActions.push(`${request.method()} ${pathname}`);
    await route.fulfill({ status: 409, json: { error: "Battery smoke uses synthetic telemetry and never operates a vehicle." } });
    return;
  }
  if (pathname === "/api/telemetry") {
    const timestamp = new Date().toISOString();
    await route.fulfill({ json: {
      listener: { active: true, host: "127.0.0.1", port: 14552, packetCount: fixtureRevision + 1, byteCount: 90 },
      vehicles: [{ id: "241:1", sysid: 241, compid: 1, firstSeenAt: timestamp, lastSeenAt: timestamp, messageCount: fixtureRevision + 1,
        heartbeat: { armed, type: 2, autopilot: 3, baseMode: armed ? 128 : 0, customMode: 0, typeName: "Quadrotor", systemStatusName: "Standby" },
        battery: { ...battery, id: 0, source: "BATTERY_STATUS", receivedAt: timestamp },
        link: { host: "127.0.0.1", port: 65530, localPort: 14552, lastPacketAt: timestamp } }]
    } });
    servedRevision = fixtureRevision;
    return;
  }
  return route.continue();
});

const dialog = page.locator(".telemetry-alert-dialog");
const activeDialog = page.locator(".telemetry-alert-dialog[open]");
async function sample(nextBattery, nextArmed = true) {
  battery = nextBattery;
  armed = nextArmed;
  const requestedRevision = ++fixtureRevision;
  const deadline = Date.now() + 15000;
  while (servedRevision < requestedRevision) {
    if (Date.now() >= deadline) throw new Error("The UI did not poll the synthetic battery fixture.");
    await page.waitForTimeout(50);
  }
  // Allow the fulfilled response to commit to React before checking absence.
  await page.waitForTimeout(250);
}
async function expectAlert(title, detail, action) {
  await activeDialog.getByRole("heading", { name: title, exact: true }).waitFor();
  assert.match(await activeDialog.locator(".telemetry-alert-detail").innerText(), detail);
  if (action) await activeDialog.getByRole("button", { name: `Send ${action}`, exact: true }).waitFor();
  else assert.equal(await activeDialog.getByRole("button", { name: /^Send / }).count(), 0);
}
async function dismiss() {
  await activeDialog.getByRole("button", { name: "Dismiss alert", exact: true }).click();
  await activeDialog.waitFor({ state: "hidden" });
}
async function expectClosed() {
  await activeDialog.waitFor({ state: "hidden" });
  assert.equal(await dialog.evaluate((element) => element.open), false);
}
function passed(name) {
  console.log(`PASS ${name}`);
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByText("4S Battery", { exact: true }).click();
  const details = page.getByTestId("battery-details");
  await details.waitFor();
  assert.match(await details.innerText(), /14\.0 \/ 13\.2 V/);

  await sample({ voltageV: 13.8, remainingPercent: undefined });
  await expectAlert("Battery reserve low", /low voltage 14\.0 V/, "RTL");
  await dismiss();
  await sample({ voltageV: 13.7, remainingPercent: undefined });
  await expectClosed();
  await sample({ voltageV: 13.0, remainingPercent: undefined });
  await expectAlert("Battery critically low", /critical voltage 13\.2 V/, "Land");
  passed("voltage-only battery alerts work with unknown capacity; dismissal survives readings and critical voltage escalates");

  await sample({ voltageV: 20, remainingPercent: 100 });
  await expectClosed();
  const preset = page.getByLabel("Battery product preset", { exact: true });
  await preset.selectOption("preset-maxamps-6s2p-9000-li-ion");
  const text = await details.innerText();
  assert.match(text, /21\.6 \/ 25\.2 V/);
  assert.match(text, /194\.4 Wh/);
  assert.match(text, /9\.00 Ah \(6S2P\)/);
  assert.match(text, /90\.0 \/ 90\.0 A/);
  assert.match(text, /874\.0 g \(spec\)/);
  assert.match(text, /21\.0 \/ 19\.8 V/);
  await expectAlert("Battery reserve low", /low voltage 21\.0 V/, "RTL");
  await sample({ voltageV: 25.2, remainingPercent: 100 });
  await expectClosed();
  await page.getByRole("navigation", { name: "Engineering domains", exact: true }).getByRole("button", { name: /^Safety/ }).click();
  const failsafeCheck = page.locator('[data-check-id="battery-failsafe"]');
  await failsafeCheck.waitFor();
  assert.equal(await failsafeCheck.getAttribute("class"), "passed");
  assert.match(await failsafeCheck.innerText(), /low 21 V \/ critical 19\.8 V/);
  passed("4S to 6S replacement updates researched pack arithmetic, voltage alerts and live engineering acceptance");

  await page.getByRole("button", { name: "SITL", exact: true }).click();
  await page.getByLabel(/^Low reserve/).fill("30");
  await page.getByLabel(/^Critical reserve/).fill("18");
  await page.getByLabel("Low action", { exact: true }).selectOption("RTL");
  await page.getByLabel("Critical action", { exact: true }).selectOption("Land");
  await sample({ voltageV: 25.2, remainingPercent: 25 });
  await expectAlert("Battery reserve low", /low reserve 30%/, "RTL");
  await dismiss();
  await sample({ voltageV: 25.2, remainingPercent: 24 });
  await expectClosed();
  await sample({ voltageV: 25.2, remainingPercent: 17 });
  await expectAlert("Battery critically low", /critical reserve 18%/, "Land");
  await page.screenshot({ path: path.join(outputDirectory, "battery-failsafe.png"), fullPage: true });
  passed("configured 30% low and 18% critical reserves control live alerts; critical escalation opens after dismissal");

  await sample({ voltageV: 25.2, remainingPercent: 100 });
  await expectClosed();
  await sample({ voltageV: 25.2, remainingPercent: 29 });
  await expectAlert("Battery reserve low", /low reserve 30%/, "RTL");
  await sample({ voltageV: 25.2, remainingPercent: 100 });
  await expectClosed();
  passed("a recovered battery clears the incident and a new low condition opens a fresh alert");

  await sample({ voltageV: 25.2, remainingPercent: 100, chargeState: 6, faultBitmask: 4 }, false);
  await expectAlert("Battery fault reported", /100% remaining/, undefined);
  assert.match(await activeDialog.innerText(), /Keep the vehicle disarmed/);
  passed("a disarmed unhealthy battery recommends inspection without offering a flight command");

  assert.deepEqual(pageErrors, [], pageErrors.join("\n"));
  assert.deepEqual(unexpectedActions, [], "Battery regression attempted a server mutation.");
  console.log("Battery browser smoke passed: preset calculations, replacement engineering, voltage and reserve triggers, dismissal/recovery, and disarmed faults.");
} catch (error) {
  await page.screenshot({ path: path.join(outputDirectory, "battery-smoke-failure.png"), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}

