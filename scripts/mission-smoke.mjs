import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.setDefaultTimeout(15000);
const pageErrors = [];
const unexpectedActions = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const missionFile = (rows = []) => `QGC WPL 110\n${rows.join("\n")}\n`;
const row = (seq, frame = 3, x = 33.5, y = 73.25) => `${seq}\t${seq ? 0 : 1}\t${frame}\t16\t0\t0\t0\t0\t${x}\t${y}\t40\t1`;
const generatedText = missionFile([row(0), row(1, 3, 33.51)]);
let mission = { active: false, message: "Mission sync idle", uploadedCount: 0, downloadedCount: 0, expectedCount: 0 };
let listenerActive = true;
let holdNextPoll = false;
let releasePoll;
let releaseExport;
let exportStarted = false;
let polls = 0;
let uploads = 0;
let uploadedText;
await page.addInitScript(() => { window.showSaveFilePicker = undefined; });

// All network activity is synthetic: this check never contacts a vehicle or changes lab data.
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === "/api/mission/status") {
    polls += 1;
    const snapshot = structuredClone(mission);
    if (holdNextPoll) {
      holdNextPoll = false;
      await new Promise((resolve) => { releasePoll = resolve; });
    }
    return route.fulfill({ json: { mission: snapshot } });
  }
  if (pathname === "/api/telemetry") return route.fulfill({ json: {
    listener: { active: listenerActive, host: "127.0.0.1", port: 14552 },
    vehicles: [{ id: "241:1", sysid: 241, compid: 1, link: { host: "127.0.0.1", port: 14560 } }]
  } });
  if (pathname === "/api/export/mission") {
    exportStarted = true;
    await new Promise((resolve) => { releaseExport = resolve; });
    return route.fulfill({ json: { fileName: "generated.waypoints", mimeType: "text/plain", content: generatedText } });
  }
  if (pathname === "/api/mission/upload") {
    uploads += 1;
    uploadedText = request.postDataJSON().missionText;
    mission = { ...mission, active: true, direction: "upload", message: "Synthetic upload started", expectedCount: 2 };
    return route.fulfill({ json: { mission } });
  }
  if (pathname === "/api/system") return route.fulfill({ json: { sitl: { available: false, notes: [] } } });
  if (pathname === "/api/components/custom") return route.fulfill({ json: { components: [] } });
  if (pathname === "/api/gazebo/status") return route.fulfill({ json: { notes: [], installations: [] } });
  if (pathname === "/api/logs") return route.fulfill({ json: { logs: [] } });
  if (request.method() !== "GET") unexpectedActions.push(`${request.method()} ${pathname}`);
  return route.fulfill({ status: 409, json: { error: "Unsupported synthetic mission test request." } });
});

async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(message);
    await page.waitForTimeout(50);
  }
}
const button = (name) => page.getByRole("button", { name, exact: true });
const importFile = (name, content) => page.getByLabel("Import mission file", { exact: true }).setInputFiles({
  name, mimeType: "text/plain", buffer: Buffer.from(content)
});

try {
  await page.goto(process.env.UAV_LAB_URL || "http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.getByRole("navigation", { name: "Workspace tools", exact: true }).getByRole("button", { name: "Mission", exact: true }).click();
  await until(async () => await button("Upload generated").isEnabled(), "Synthetic vehicle did not become available.");

  await importFile("single.waypoints", missionFile([row(0)]));
  await until(async () => (await page.locator(".mission-brief-card").innerText()).includes("single.waypoints · 1 items"), "Single-point mission was not imported.");
  assert.equal(await button("Upload imported").isEnabled(), true);
  await importFile("invalid.waypoints", missionFile([row(0), "malformed row"]));
  await until(async () => (await page.locator(".statusbar").innerText()).includes("12 QGC WPL fields"), "Malformed mission was not rejected.");
  assert.match(await page.locator(".mission-brief-card").innerText(), /single\.waypoints/);
  console.log("PASS single-point mission import and atomic malformed-file rejection");

  await importFile("local.waypoints", missionFile([row(0, 1, 5.25, -4.5)]));
  await until(async () => (await page.locator(".mission-brief-card").innerText()).includes("global route distance is unavailable"), "Local coordinates were treated as latitude/longitude.");
  await importFile("empty.waypoints", missionFile());
  await button("Upload empty mission").waitFor();
  assert.match(await page.locator(".mission-brief-card").innerText(), /clears the vehicle route/);
  await button("Use generated route").click();
  await button("Upload generated").waitFor();
  console.log("PASS local and empty missions are explicit; generated route can be restored");

  holdNextPoll = true;
  await until(() => Boolean(releasePoll), "Did not capture a delayed mission status poll.");
  const pollsBefore = polls;
  await page.waitForTimeout(2200);
  assert.equal(polls, pollsBefore, "Mission status requests overlapped while a response was delayed.");
  await button("Upload generated").click();
  await until(() => exportStarted, "Generated mission export did not begin.");
  assert.equal(await button("Starting upload…").isDisabled(), true);
  assert.equal(await button("Download").isDisabled(), true);
  assert.equal(await button("Import route").isDisabled(), true);
  releaseExport();
  await until(async () => (await page.locator(".mission-status-card").innerText()).includes("Synthetic upload started"), "Upload did not start.");
  releasePoll();
  await page.waitForTimeout(300);
  assert.match(await page.locator(".mission-status-card").innerText(), /Synthetic upload started/);
  assert.equal(await button("Upload generated").isDisabled(), true);
  assert.equal(uploads, 1);
  assert.equal(uploadedText, generatedText);
  console.log("PASS single pending transfer, serialized polling, and stale-response protection");

  mission = { ...mission, active: false, direction: "download", message: "Synthetic download complete", downloadedCount: 2, missionText: generatedText };
  await button("Save Downloaded Mission").waitFor();
  const downloaded = page.waitForEvent("download");
  await button("Save Downloaded Mission").click();
  assert.equal(await readFile(await (await downloaded).path(), "utf8"), generatedText);
  listenerActive = false;
  await until(async () => await button("Upload generated").isDisabled(), "Stopped listener left transfer actions enabled.");
  assert.equal(await button("Download").isDisabled(), true);
  console.log("PASS downloaded mission export and stopped-listener action gating");

  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/mission-sync.png", fullPage: true });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedActions, []);
} finally {
  releasePoll?.();
  releaseExport?.();
  await browser.close();
}
