import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "test-results");
const baseUrl = process.env.UAV_LAB_URL || "http://127.0.0.1:5173/";
await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
page.setDefaultTimeout(15000);
const pageErrors = [];
const unexpectedActions = [];
const report = { startedAt: new Date().toISOString(), passed: false, checks: [] };
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.addInitScript(() => { window.showSaveFilePicker = undefined; });

// Read-only diagnostics may reach the local server. All writes are isolated from
// the user's workspace library, listeners, simulators, firmware and hardware.
await page.route("**/api/**", async (route) => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname.startsWith("/api/designs")) {
    await route.fulfill({ json: request.method() === "POST" ? { design: request.postDataJSON() } : { designs: [] } });
    return;
  }
  if (request.method() === "GET") return route.continue();
  unexpectedActions.push(`${request.method()} ${pathname}`);
  await route.fulfill({ status: 409, json: { error: "Validation regression does not operate simulators or hardware." } });
});

const dialog = page.locator(".issue-review-dialog");
const validate = () => page.getByRole("button", { name: "Validate", exact: true }).click();
const issue = (key) => page.locator(`[data-issue-key=${JSON.stringify(key)}]`);
const acceptance = (id) => page.locator(`[data-check-id=${JSON.stringify(id)}]`);
async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error(message);
    await page.waitForTimeout(100);
  }
}
function passed(name) {
  report.checks.push(name);
  console.log(`PASS ${name}`);
}
async function openWiring() {
  await page.getByRole("navigation", { name: "Engineering domains", exact: true }).getByRole("button", { name: /Wiring & Buses/ }).click();
  await acceptance("required-ports").waitFor();
}
async function downloadWorkspace() {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .saq", exact: true }).click();
  const file = await downloaded;
  return JSON.parse(await readFile(await file.path(), "utf8"));
}
async function loadWorkspace(workspace, filename) {
  await page.getByLabel("Load workspace file", { exact: true }).setInputFiles({
    name: `${filename}.saq`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workspace))
  });
  await until(async () => await page.getByLabel("Project name", { exact: true }).inputValue() === workspace.design.name, "Fixture did not load.");
}
const edgeSignature = (design) => design.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle, target, targetHandle })).sort((a, b) => a.id.localeCompare(b.id));

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "Start with the mission", exact: true });
  await wizard.getByLabel("Mission / project name", { exact: true }).fill("Validation regression baseline");
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard.getByRole("button", { name: "Next", exact: true }).click();
  await wizard.getByRole("button", { name: "Create workspace", exact: true }).click();
  await wizard.waitFor({ state: "hidden" });
  const baseline = await downloadWorkspace();
  const gps = baseline.design.nodes.find((node) => node.data.componentType === "gps");
  const gpsPower = baseline.design.edges.find((edge) => edge.target === gps.id && edge.targetHandle === "power-in");
  assert.ok(gpsPower, "A new mission must supply GPS power before a missing-wire fixture is created.");
  const missing = structuredClone(baseline);
  missing.design.name = "Validation regression missing GNSS power";
  missing.design.edges = missing.design.edges.filter((edge) => edge.id !== gpsPower.id);
  await loadWorkspace(missing, "missing-gnss-power");
  const powerIssueKey = `validation:required-${gps.id}-power-in`;

  await validate();
  await issue(powerIssueKey).waitFor();
  const issueText = await issue(powerIssueKey).innerText();
  assert.ok(issueText.includes(gps.data.label) && issueText.includes(gps.id) && issueText.includes("PWR"));
  await issue(powerIssueKey).getByRole("button", { name: "Review / resolve", exact: true }).click();
  await dialog.getByRole("heading", { name: "What is wrong", exact: true }).waitFor();
  await dialog.getByRole("heading", { name: "Where to fix it", exact: true }).waitFor();
  assert.ok((await dialog.locator(".issue-locations").innerText()).includes(`${gps.data.label} (${gps.id}) · PWR`));
  await page.screenshot({ path: path.join(outputDirectory, "validation-review.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Not now", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await issue(powerIssueKey).waitFor();
  passed("issue review identifies exact component and port; Not now preserves the failure");

  await issue(powerIssueKey).getByRole("button", { name: "Review / resolve", exact: true }).click();
  await dialog.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await issue(powerIssueKey).waitFor();
  assert.deepEqual(edgeSignature((await downloadWorkspace()).design), edgeSignature(missing.design));
  passed("Escape closes review without changing connections or clearing the error");

  await issue(powerIssueKey).getByRole("button", { name: "Review / resolve", exact: true }).click();
  const repair = dialog.getByRole("button", { name: new RegExp(`^Connect: ${gps.data.label} power from `) });
  assert.equal(await repair.count(), 1, "Expected one targeted GPS power repair.");
  await repair.click();
  await dialog.getByRole("heading", { name: "Resolved in the current design", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await until(async () => await issue(powerIssueKey).count() === 0, "Repaired validation issue remained visible.");
  await openWiring();
  await until(async () => await acceptance("required-ports").getAttribute("class") === "passed", "Required-port acceptance failed to refresh after repair.");
  assert.equal(await acceptance("required-ports").getByRole("button", { name: "Review / resolve", exact: true }).count(), 0);
  passed("targeted connection repair immediately clears validation and acceptance");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await until(async () => (await acceptance("required-ports").getAttribute("class"))?.includes("issue"), "Undo did not restore the acceptance failure.");
  await validate();
  await issue(powerIssueKey).waitFor();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await until(async () => await issue(powerIssueKey).count() === 0, "Redo did not clear the validation failure.");
  await openWiring();
  await until(async () => await acceptance("required-ports").getAttribute("class") === "passed", "Redo did not refresh acceptance.");
  passed("undo and redo restore current validation and acceptance results");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await acceptance("required-ports").getByRole("button", { name: "Review / resolve", exact: true }).click();
  await dialog.getByRole("heading", { name: "Where to fix it", exact: true }).waitFor();
  assert.ok((await dialog.innerText()).includes(gps.id));
  await dialog.getByRole("button", { name: new RegExp(`^Connect: ${gps.data.label} power from `) }).click();
  await dialog.getByRole("heading", { name: "Resolved in the current design", exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await until(async () => await acceptance("required-ports").getAttribute("class") === "passed", "Acceptance review repair did not refresh the check.");
  passed("acceptance check offers a working repair and resolves its own review dialog");

  const malformed = structuredClone(baseline);
  malformed.design.name = "Validation regression malformed connection";
  const badWire = malformed.design.edges.find((edge) => edge.id === gpsPower.id);
  badWire.sourceHandle = "analog-out";
  await loadWorkspace(malformed, "malformed-connection");
  await validate();
  const edgeIssue = issue(`validation:edge-${badWire.id}-signal`);
  await edgeIssue.getByRole("button", { name: "Review / resolve", exact: true }).click();
  const source = malformed.design.nodes.find(({ id }) => id === badWire.source);
  const location = await dialog.locator(".issue-locations").innerText();
  assert.ok(location.includes(source.data.label) && location.includes(gps.data.label) && location.includes("ADC") && location.includes("PWR"));
  assert.equal(await dialog.getByRole("button", { name: /^Connect:/ }).count(), 0, "An incompatible wire must be inspected before adding another supply.");
  await dialog.getByRole("button", { name: "Inspect connection", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const routeCard = page.locator(".connection-route-card");
  await routeCard.waitFor();
  assert.ok((await routeCard.innerText()).includes(source.data.label) && (await routeCard.innerText()).includes(gps.data.label));
  assert.ok((await page.locator(".connection-issues").innerText()).includes("analog"));
  assert.deepEqual(edgeSignature((await downloadWorkspace()).design), edgeSignature(malformed.design));
  passed("malformed connection review opens the exact edge inspector without modifying wiring");

  await openWiring();
  await acceptance("compatible-edges").getByRole("button", { name: "Review / resolve", exact: true }).click();
  assert.ok((await dialog.locator(".issue-locations").innerText()).includes(gps.data.label));
  await dialog.getByRole("button", { name: "Not now", exact: true }).click();
  assert.ok((await acceptance("compatible-edges").getAttribute("class")).includes("issue"));
  passed("acceptance also locates malformed edges and keeps deferred checks failed");

  assert.deepEqual(pageErrors, [], "Browser errors occurred during validation review.");
  assert.deepEqual(unexpectedActions, [], "Validation review attempted an unrelated server mutation.");
  report.passed = true;
  console.log(`Validation browser smoke passed: ${report.checks.length} interaction checks.`);
} catch (error) {
  report.error = error.message;
  await page.screenshot({ path: path.join(outputDirectory, "validation-smoke-failure.png"), fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  report.pageErrors = pageErrors;
  report.unexpectedActions = unexpectedActions;
  await writeFile(path.join(outputDirectory, "validation-smoke.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
