import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.UAV_LAB_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
let liveTelemetry = true;
await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
// Save .saq also updates the server design library; keep test saves out of the user's library.
await page.route("**/api/designs**", async (route) => {
  if (route.request().method() === "POST") await route.fulfill({ json: { design: route.request().postDataJSON() } });
  else await route.fulfill({ json: { designs: [] } });
});

await page.route("**/api/telemetry", async (route) => {
  await route.fulfill({ json: {
    listener: { active: liveTelemetry, host: "127.0.0.1", port: 14552, packetCount: 5, byteCount: 90 },
    vehicles: liveTelemetry ? [{ id: "1:1", sysid: 1, compid: 1, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
      messageCount: 5, attitude: { rollDeg: 12, pitchDeg: -4, yawDeg: 37 },
      vfrHud: { airspeedMps: 14.5, groundspeedMps: 12, climbMps: 1.2, throttlePercent: 43 } }] : []
  } });
});

async function downloadWorkspace() {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .saq", exact: true }).click();
  return JSON.parse(await readFile(await (await pending).path(), "utf8"));
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const acceptanceIssue = page.getByRole("button", { name: "Review / resolve", exact: true });
  await acceptanceIssue.click();
  const issueDialog = page.locator("dialog.issue-review-dialog");
  const issueAutoFix = issueDialog.getByRole("button", { name: "Auto-fix wiring harness", exact: true });
  await issueAutoFix.waitFor();
  await issueAutoFix.click();
  await issueDialog.getByText("Resolved in the current design", { exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Component library", exact: true }).click();
  const library = page.getByRole("complementary", { name: "Component library" });
  assert.equal(await library.getByText("Add components freely", { exact: true }).count(), 1);
  assert.equal(await library.getByLabel("Optional design guide").getAttribute("open"), null);
  await library.getByLabel("Search component library").fill("camera");
  await library.locator(".catalog-item", { hasText: "Camera" }).click();
  await page.locator('.react-flow__node.selected[data-id^="camera-"]').waitFor();
  await library.getByRole("button", { name: "Remove selected", exact: true }).click();
  assert.equal(await page.locator('.react-flow__node[data-id^="camera-"]').count(), 0);
  await library.getByLabel("Optional design guide").locator("summary").click();
  assert.equal(await library.getByLabel("Optional design guide").getAttribute("open"), "");
  await library.getByRole("button", { name: "Close component library", exact: true }).click();

  await page.getByRole("tab", { name: "3D Lab", exact: true }).click();
  const dynamics = page.getByRole("status", { name: "Flight dynamics" });
  await dynamics.getByText("Live flight dynamics", { exact: true }).waitFor();
  await dynamics.getByText("12.0°", { exact: true }).waitFor();
  await dynamics.getByText("14.5 m/s", { exact: true }).waitFor();
  liveTelemetry = false;
  await dynamics.getByText("Concept aero model", { exact: true }).waitFor({ timeout: 7000 });
  await page.getByRole("tab", { name: "2D Design", exact: true }).click();

  const workspace = await downloadWorkspace();
  const beforeEdges = workspace.design.edges.length;
  workspace.design.edges = workspace.design.edges.filter((edge) => edge.id !== "e-pm-gps-power");
  assert.equal(workspace.design.edges.length, beforeEdges - 1);
  await page.getByLabel("Load workspace file", { exact: true }).setInputFiles({
    name: "acceptance-auto-fix.saq", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workspace))
  });
  const autoFix = page.getByRole("button", { name: /Auto-fix \d+ safe connection/ });
  await autoFix.waitFor();
  await autoFix.click();
  const repaired = await downloadWorkspace();
  assert.equal(repaired.design.edges.length, beforeEdges);
  assert.ok(repaired.design.edges.some((edge) => edge.source === "pm-1" && edge.target === "gps-1" && edge.targetHandle === "power-in"));
  assert.deepEqual(pageErrors, []);
  console.log("Workbench improvements passed: free-form add/remove, optional guide, live/concept dynamics, and acceptance auto-fix.");
} finally {
  await browser.close();
}
