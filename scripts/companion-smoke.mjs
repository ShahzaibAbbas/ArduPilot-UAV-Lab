import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// UI state transitions use an isolated API fixture; backend process/security tests
// exercise the VM manager separately without installing an operating system.
const baseUrl = process.env.UAV_LAB_URL || "http://127.0.0.1:5173/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let available = false;
let machine;
let requestSettings;
await page.route("**/api/companion-vm**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith("/start")) {
    requestSettings = route.request().postDataJSON();
    machine = { nodeId: "companion-smoke", ...requestSettings, diskExists: true, state: "running", vncPort: 5901 };
    delete machine.isoPath;
    await route.fulfill({ json: { machine } });
  } else if (url.pathname.endsWith("/stop")) {
    machine = { ...machine, state: "stopped", vncPort: undefined };
    await route.fulfill({ json: { machine } });
  } else await route.fulfill({ json: {
    runtime: { available, qemuAvailable: available, qemuImgAvailable: available, message: available ? "Ready" : "QEMU is not installed." },
    machines: machine ? [machine] : []
  } });
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  for (const [selector, expected] of [[".lab-topbar", 68], [".lab-evidence", 76]]) {
    const bounds = await page.locator(selector).boundingBox();
    assert.ok(bounds && Math.abs(bounds.height - expected) < 1, `${selector} height must be ${expected}px`);
  }
  const domains = page.locator(".domain-strip").getByRole("button");
  assert.equal(await domains.count(), 7);
  for (const domain of await domains.all()) {
    assert.equal(await domain.isVisible(), true);
    const bounds = await domain.boundingBox();
    assert.ok(bounds && bounds.height >= 52, "Engineering domain controls must remain readable");
  }
  await page.getByRole("button", { name: "Component library", exact: true }).click();
  const library = page.getByRole("complementary", { name: "Component library" });
  const drawer = await library.boundingBox();
  assert.equal(drawer?.width, 420);
  await library.getByRole("button", { name: "Close component library", exact: true }).click();
  await library.waitFor({ state: "hidden" });

  await page.getByLabel("Load workspace file", { exact: true }).setInputFiles({
    name: "companion-smoke.saq", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
      format: "ardupilot-uav-lab.workspace", version: 1,
      design: { name: "Companion test", settings: {}, nodes: [{
        id: "companion-smoke", type: "componentNode", position: { x: 0, y: 0 },
        data: { componentType: "companion-computer", label: "Companion computer", properties: {} }
      }], edges: [] }
    }))
  });
  await page.locator('.react-flow__node[data-id="companion-smoke"]').click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
  const panel = page.getByRole("region", { name: "Companion Linux virtual machine" });
  await panel.getByText("QEMU is not installed.", { exact: false }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Install Linux", exact: true }).isDisabled(), true);
  available = true;
  await panel.getByLabel("Linux installer ISO path on the API computer").fill("C:\\Installers\\linux.iso");
  await panel.getByLabel("Memory (MB)").fill("4096");
  await panel.getByRole("button", { name: "Install Linux", exact: true }).click();
  await panel.getByText("127.0.0.1:5901", { exact: true }).waitFor();
  assert.equal(requestSettings.memoryMb, 4096);
  assert.equal(requestSettings.boot, "installer");
  assert.equal(await panel.getByLabel("Linux installer ISO path on the API computer").inputValue(), "");
  await panel.getByRole("button", { name: "Open control window", exact: true }).click();
  await panel.getByRole("dialog", { name: "Virtual machine control window" }).waitFor();
  await panel.getByRole("button", { name: "Close virtual machine control window", exact: true }).click();
  assert.equal(await panel.getByRole("button", { name: "Start Linux", exact: true }).isDisabled(), true);
  await panel.getByRole("button", { name: "Stop VM", exact: true }).click();
  await panel.getByLabel("Open a native QEMU window on the API computer", { exact: true }).check();
  await panel.getByRole("button", { name: "Start Linux", exact: true }).click();
  await panel.getByText("Saved disk", { exact: true }).waitFor();
  assert.equal(requestSettings.boot, "disk");
  assert.equal(requestSettings.displayMode, "window");
  assert.equal(requestSettings.isoPath, undefined);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/companion-linux.png", fullPage: true });
  await page.getByRole("button", { name: "SITL", exact: true }).click();
  await page.getByRole("region", { name: "Mission Planner connection guide" }).waitFor();
  assert.equal(await page.getByLabel("MAVLink TCP port", { exact: true }).inputValue(), "5762");
  assert.deepEqual(errors, []);
  console.log("Companion controls passed: missing runtime, install/start/stop, resources, transient ISO path, Mission Planner guide, workbench chrome.");
} catch (error) {
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/companion-failure.png", fullPage: true }).catch(() => undefined);
  console.error("Page errors:", errors);
  throw error;
} finally {
  await browser.close();
}
