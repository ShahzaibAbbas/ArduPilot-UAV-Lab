import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { TraceBuffer } from "../server/trace.js";

const baseUrl = process.env.UAV_LAB_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
let firmwareId;
let savedDesignFixture;
await mkdir("test-results", { recursive: true });

async function until(check, message) {
  const deadline = Date.now() + 15000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function openWorkspaceTool(name) {
  const navigation = page.getByRole("complementary", { name: "Workspace navigation", exact: true });
  if (await navigation.isVisible()) {
    await navigation.getByRole("button", { name, exact: true }).click();
    return;
  }
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "Workspace tools", exact: true });
  await tools.waitFor();
  await tools.getByRole("button", { name, exact: true }).click();
  await tools.waitFor({ state: "hidden" });
}

// Exercise file downloads without opening an OS picker or writing a test design to the user's library.
await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
await page.route("**/api/designs*", async (route) => {
  if (route.request().method() === "POST") {
    savedDesignFixture = route.request().postDataJSON();
    await route.fulfill({ json: { design: savedDesignFixture } });
  } else {
    const query = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    await route.fulfill({ json: { designs: savedDesignFixture && savedDesignFixture.name.toLowerCase().includes(query) ? [savedDesignFixture] : [] } });
  }
});

// Isolated synthetic trace: browser controls never pause or clear the user's live packet buffer.
const trace = new TraceBuffer();
for (let index = 0; index < 2; index += 1) trace.add({
  receivedAt: new Date().toISOString(), direction: index ? "tx" : "rx", protocol: "MAVLink2",
  sequence: index, systemId: 241, componentId: 1, messageId: index ? 77 : 0,
  messageName: index ? "COMMAND_ACK" : "HEARTBEAT", datagramLength: 21, frameLength: 21,
  payloadLength: 9, summary: "Synthetic browser smoke fixture", checksumStatus: "valid", signed: false,
  remote: { host: "127.0.0.1", port: 14550 }, local: { host: "127.0.0.1", port: 14560 }
});
await page.route("**/api/telemetry/trace**", async (route) => {
  const url = new URL(route.request().url());
  const filters = Object.fromEntries(url.searchParams);
  if (url.pathname.endsWith("/export")) {
    const artifact = trace.export(filters.format, filters);
    await route.fulfill({ body: artifact.content, headers: {
      "Content-Type": filters.format === "csv" ? "text/csv" : "application/json",
      "Content-Disposition": `attachment; filename="smoke.mavtrace.${filters.format}"`
    } });
  } else if (url.pathname.endsWith("/pause")) {
    trace.pause(); await route.fulfill({ json: trace.stats() });
  } else if (url.pathname.endsWith("/resume")) {
    trace.resume(); await route.fulfill({ json: trace.stats() });
  } else if (url.pathname.endsWith("/clear")) {
    const cleared = trace.stats().count; trace.clear();
    await route.fulfill({ json: { cleared, stats: trace.stats() } });
  } else if (url.pathname.endsWith("/stats")) {
    await route.fulfill({ json: trace.stats() });
  } else await route.fulfill({ json: { events: trace.query(filters), stats: trace.stats() } });
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(await page.title(), "ArduPilot UAV Lab");
  await page.getByRole("tab", { name: "3D Lab", exact: true }).click();
  const scene = page.getByTestId("three-lab-workspace");
  await scene.waitFor();
  await scene.locator("canvas").waitFor();
  await page.getByLabel("Select 3D component").selectOption("fc-1");
  const position = page.getByLabel("3D position X", { exact: true });
  await position.fill("3.25");
  await position.press("Enter");
  assert.equal(await position.inputValue(), "3.25");
  await position.fill("8");
  await position.press("Escape");
  assert.equal(await position.inputValue(), "3.25");
  await position.fill("");
  await position.press("Tab");
  assert.equal(await position.inputValue(), "3.25");

  await page.getByRole("tab", { name: "2D Design", exact: true }).click();
  await page.locator('.react-flow__node[data-id="fc-1"].selected').waitFor();
  await page.getByRole("tab", { name: "3D Lab", exact: true }).click();
  assert.equal(await page.getByLabel("Select 3D component").inputValue(), "fc-1");
  assert.equal(await position.inputValue(), "3.25");

  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save .saq", exact: true }).click();
  const download = await saved;
  const workspace = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(workspace.design.nodes.find((node) => node.id === "fc-1").presentation3d.position.x, 3.25);
  assert.equal(workspace.design.lab.viewMode, "3d");
  await page.getByText("Workspace saved", { exact: true }).waitFor();
  await page.getByLabel("Select 3D component").selectOption("gps-1");
  await page.getByText("Workspace saved", { exact: true }).waitFor();
  await page.getByLabel("Select 3D component").selectOption("fc-1");
  await position.fill("4");
  await position.press("Enter");
  await page.getByLabel("Load workspace file", { exact: true }).setInputFiles({
    name: "smoke-roundtrip.saq", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(workspace))
  });
  await page.getByLabel("Select 3D component").selectOption("fc-1");
  await until(async () => await position.inputValue() === "3.25", "Saved 3D transform was not restored");
  await page.screenshot({ path: "test-results/phase1-3d.png", fullPage: true });

  await openWorkspaceTool("Firmware");
  const firmware = page.getByTestId("firmware-lab");
  await firmware.waitFor();
  await page.getByTestId("firmware-file-input").setInputFiles({ name: "unsafe.exe", mimeType: "application/octet-stream", buffer: Buffer.from([1, 2, 3]) });
  await page.getByText("Supported firmware types are .apj, .bin, .hex, and .elf.", { exact: true }).waitFor();
  const uploaded = page.waitForResponse((response) => response.url().includes("/api/firmware?") && response.request().method() === "POST");
  await page.getByTestId("firmware-file-input").setInputFiles({ name: "browser-smoke.bin", mimeType: "application/octet-stream", buffer: Buffer.from("Synthetic metadata-only browser test; never executed.") });
  const response = await uploaded;
  assert.equal(response.status(), 201);
  const upload = await response.json();
  firmwareId = upload.firmware.id;
  assert.match(upload.firmware.sha256, /^[a-f0-9]{64}$/);
  assert.equal(upload.firmware.selectedNode.nodeId, "fc-1");
  await firmware.getByRole("button", { name: "Attach to", exact: false }).click();
  await firmware.getByRole("button", { name: "Start visual workflow", exact: true }).click();
  const state = firmware.locator(".firmware-progress-copy strong");
  await until(async () => await state.textContent() === "RUNNING", "Visual boot workflow did not complete");
  assert.equal(await firmware.getByRole("progressbar").getAttribute("value"), "100");
  await firmware.getByRole("button", { name: "Stop", exact: true }).click();
  await until(async () => await state.textContent() === "STOPPED", "Visual workflow did not stop");
  await firmware.getByRole("button", { name: "Remove", exact: true }).click();
  await until(async () => (await page.request.get(new URL(`/api/firmware/${firmwareId}`, baseUrl).href)).status() === 404, "Test firmware was not removed");
  firmwareId = undefined;

  await openWorkspaceTool("Trace");
  const tracePanel = page.getByTestId("packet-trace-panel");
  await tracePanel.getByRole("row", { name: "Trace 1, HEARTBEAT, RX", exact: true }).waitFor();
  await tracePanel.getByRole("combobox", { name: /direction/i }).selectOption("tx");
  await until(async () => await tracePanel.locator("tbody tr").count() === 1, "Trace direction filter did not apply");
  await tracePanel.getByRole("row", { name: "Trace 2, COMMAND_ACK, TX", exact: true }).press("Enter");
  await tracePanel.getByText("Valid CRC", { exact: true }).waitFor();
  await tracePanel.getByRole("button", { name: "Reset filters", exact: true }).click();
  await until(async () => await tracePanel.locator("tbody tr").count() === 2, "Trace reset did not restore rows");
  await tracePanel.getByRole("button", { name: "Pause", exact: true }).click();
  await tracePanel.getByRole("button", { name: "Resume", exact: true }).waitFor();
  assert.equal(trace.stats().paused, true);
  for (const format of ["JSON", "CSV"]) {
    const exported = page.waitForEvent("download");
    await tracePanel.getByRole("button", { name: format, exact: true }).click();
    const text = await readFile(await (await exported).path(), "utf8");
    if (format === "JSON") assert.equal(JSON.parse(text).events.length, 2);
    else assert.ok(text.includes("HEARTBEAT") && text.includes("COMMAND_ACK"));
  }
  await page.screenshot({ path: "test-results/phase1-trace.png", fullPage: true });
  await tracePanel.getByRole("button", { name: "Clear", exact: true }).click();
  await until(async () => await tracePanel.locator("tbody tr").count() === 0, "Trace clear left stale rows");
  assert.equal(trace.stats().count, 0);
  await tracePanel.getByRole("button", { name: "Resume", exact: true }).click();
  assert.equal(trace.stats().paused, false);

  // The shell keeps all tools reachable and saved-file search/load uses the same workspace migration.
  await openWorkspaceTool("Workspace files");
  const files = page.locator(".workspace-files-panel");
  await files.locator(".saved-design-list button").waitFor();
  await files.getByRole("textbox", { name: "Search saved workspaces" }).fill("no-such-test-workspace");
  await files.getByText("No matching workspaces", { exact: true }).waitFor();
  await files.getByRole("textbox", { name: "Search saved workspaces" }).fill("");
  await files.locator(".saved-design-list button").click();
  await until(async () => await page.getByRole("textbox", { name: "Project name" }).inputValue() === savedDesignFixture.name, "Saved workspace did not open");
  await openWorkspaceTool("Ports & setup");
  const connections = page.locator(".connections-panel");
  await until(async () => (await connections.locator(".connection-status-row").nth(1).innerText()).includes("Connected"), "Runtime API status did not load");
  assert.equal(await connections.locator(".panel-error").count(), 0);
  await page.screenshot({ path: "test-results/workbench-ports.png", fullPage: true });
  await openWorkspaceTool("SITL");
  await page.getByLabel("Run without external windows").check();
  await page.getByLabel("Rebuild autopilot before launch").uncheck();
  const telemetryPort = page.getByLabel("Lab telemetry UDP port");
  if (await telemetryPort.isEnabled()) {
    await telemetryPort.fill("15552");
    await openWorkspaceTool("Live");
    assert.equal(await page.getByLabel("MAVLink UDP port").inputValue(), "15552");
  }
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openWorkspaceTool("Workspace files");
    await files.getByRole("textbox", { name: "Search saved workspaces" }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Workspace overflows at ${width}px`);
    if (width < 700) {
      await page.locator(".statusbar").scrollIntoViewIfNeeded();
      const footer = await page.locator(".statusbar").boundingBox();
      assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= 901, "Mobile footer cannot be reached by scrolling");
      await page.getByRole("group", { name: "Workspace panel", exact: true }).getByRole("button", { name: "Workspace", exact: true }).click();
      await page.getByTestId("three-lab-workspace").locator("canvas").waitFor();
      const sceneBox = await page.getByTestId("three-lab-workspace").locator("canvas").boundingBox();
      assert.ok(sceneBox && sceneBox.height >= 160, "Mobile 3D viewport is too short to use");
    }
  }
  await page.screenshot({ path: "test-results/workbench-mobile.png", fullPage: true });

  assert.deepEqual(pageErrors, []);
  console.log("Browser checks passed: 2D/3D selection and transforms, workspace round trip and search/load, firmware simulation, trace controls/exports, runtime ports, and responsive navigation.");
} catch (error) {
  await page.screenshot({ path: "test-results/phase1-failure.png", fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  if (firmwareId) await page.request.delete(new URL(`/api/firmware/${firmwareId}`, baseUrl).href).catch(() => undefined);
  await browser.close();
}
