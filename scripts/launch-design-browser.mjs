import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const localDataRoot =
  process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || path.join(process.env.HOME || projectRoot, ".local", "share");
const profileDir = path.join(localDataRoot, "Ardupilot_Simulator", "design-browser-profile");
const defaultUrl = process.env.DESIGN_BROWSER_URL || "http://127.0.0.1:5173/";
const defaultSize = process.env.DESIGN_BROWSER_SIZE || "1920x1080";
const defaultWaitMs = Number(process.env.DESIGN_BROWSER_WAIT_MS || 60000);
const browserControlsScript = String.raw`
(() => {
  const rootId = "uav-lab-window-controls";
  const styleId = "uav-lab-window-controls-style";

  const mount = () => {
    if (document.getElementById(rootId)) {
      return;
    }

    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = [
        "#" + rootId + " {",
        "  position: fixed;",
        "  top: 0;",
        "  right: 0;",
        "  width: 108px;",
        "  height: 78px;",
        "  z-index: 2147483647;",
        "  pointer-events: none;",
        "  font-family: Inter, Segoe UI, Arial, sans-serif;",
        "}",
        "#" + rootId + " .uav-lab-window-panel {",
        "  position: absolute;",
        "  top: 10px;",
        "  right: 10px;",
        "  display: flex;",
        "  gap: 8px;",
        "  padding: 6px;",
        "  border: 1px solid rgba(255, 255, 255, 0.22);",
        "  border-radius: 8px;",
        "  background: rgba(15, 23, 42, 0.82);",
        "  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);",
        "  opacity: 0;",
        "  pointer-events: none;",
        "  transform: translateY(-10px);",
        "  transition: opacity 140ms ease, transform 140ms ease;",
        "  backdrop-filter: blur(12px);",
        "}",
        "#" + rootId + " .uav-lab-window-panel.is-visible {",
        "  opacity: 1;",
        "  pointer-events: auto;",
        "  transform: translateY(0);",
        "}",
        "#" + rootId + " .uav-lab-window-button {",
        "  width: 36px;",
        "  height: 32px;",
        "  border: 0;",
        "  border-radius: 6px;",
        "  color: #e5edf7;",
        "  background: rgba(255, 255, 255, 0.1);",
        "  font-size: 18px;",
        "  font-weight: 700;",
        "  line-height: 1;",
        "  cursor: pointer;",
        "}",
        "#" + rootId + " .uav-lab-window-button:hover {",
        "  background: rgba(255, 255, 255, 0.2);",
        "}",
        "#" + rootId + " .uav-lab-window-button:focus-visible {",
        "  outline: 2px solid #7dd3fc;",
        "  outline-offset: 2px;",
        "}",
        "#" + rootId + " .uav-lab-window-button[data-action='close']:hover {",
        "  background: #ef4444;",
        "  color: #ffffff;",
        "}",
        "#" + rootId + " .uav-lab-window-button:disabled {",
        "  cursor: default;",
        "  opacity: 0.65;",
        "}",
        "@media (prefers-reduced-motion: reduce) {",
        "  #" + rootId + " .uav-lab-window-panel {",
        "    transition: none;",
        "  }",
        "}"
      ].join("\n");
      (document.head || document.documentElement).appendChild(style);
    }

    const root = document.createElement("div");
    root.id = rootId;
    root.setAttribute("aria-hidden", "true");
    root.innerHTML = '<div class="uav-lab-window-panel" role="group" aria-label="Window controls"><button type="button" class="uav-lab-window-button" data-action="minimize" title="Minimize" aria-label="Minimize">-</button><button type="button" class="uav-lab-window-button" data-action="close" title="Close" aria-label="Close">x</button></div>';
    (document.body || document.documentElement).appendChild(root);

    const panel = root.querySelector(".uav-lab-window-panel");
    let hideTimer = 0;

    const showControls = () => {
      window.clearTimeout(hideTimer);
      root.setAttribute("aria-hidden", "false");
      panel.classList.add("is-visible");
    };

    const hideControls = () => {
      panel.classList.remove("is-visible");
      root.setAttribute("aria-hidden", "true");
    };

    const scheduleHide = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!panel.matches(":hover")) {
          hideControls();
        }
      }, 1300);
    };

    document.addEventListener(
      "mousemove",
      (event) => {
        const isInUpperRightEdge = event.clientX >= window.innerWidth - 88 && event.clientY <= 72;
        if (isInUpperRightEdge) {
          showControls();
        } else if (!panel.matches(":hover")) {
          scheduleHide();
        }
      },
      { passive: true }
    );

    panel.addEventListener("pointerenter", showControls);
    panel.addEventListener("pointerleave", scheduleHide);
    panel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (typeof window.uavLabWindowControl !== "function") {
        return;
      }

      button.disabled = true;
      try {
        await window.uavLabWindowControl(button.dataset.action);
      } catch (error) {
        console.error("Window control failed", error);
        button.disabled = false;
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
`;

function parseArgs() {
  const args = new Map();
  for (const arg of process.argv.slice(2)) {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    args.set(key, value);
  }
  return args;
}

function parseSize(value) {
  const match = /^(\d+)x(\d+)$/i.exec(String(value || ""));
  if (!match) {
    return { width: 1920, height: 1080 };
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // The dev server is still starting.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}. Start the web app first or increase DESIGN_BROWSER_WAIT_MS.`);
}

async function launchWith(options) {
  return chromium.launchPersistentContext(profileDir, {
    ...options,
    headless: false,
    ignoreDefaultArgs: ["--no-sandbox"],
    viewport: null
  });
}

async function setWindowState(page, windowState) {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState }
    });
  } finally {
    await session.detach().catch(() => undefined);
  }
}

async function attachBrowserControls(page) {
  try {
    await page.evaluate(browserControlsScript);
  } catch {
    page.once("domcontentloaded", () => {
      page.evaluate(browserControlsScript).catch(() => undefined);
    });
  }
}

async function installBrowserControls(context) {
  await context.exposeBinding("uavLabWindowControl", async (source, action) => {
    if (action === "minimize") {
      await setWindowState(source.page, "minimized");
      return;
    }

    if (action === "close") {
      setTimeout(() => {
        context.close().catch(() => undefined);
      }, 0);
    }
  });

  await context.addInitScript(browserControlsScript);
  context.on("page", (page) => {
    page.on("domcontentloaded", () => {
      attachBrowserControls(page).catch(() => undefined);
    });
    attachBrowserControls(page).catch(() => undefined);
  });

  await Promise.all(context.pages().map((page) => attachBrowserControls(page)));
}

async function launchDesignBrowser() {
  const args = parseArgs();
  const url = args.get("url") || defaultUrl;
  const size = parseSize(args.get("size") || defaultSize);
  const useKiosk = args.get("kiosk") === "true";
  const waitMs = Number(args.get("wait-ms") || defaultWaitMs);
  const browserArgs = [
    `--app=${url}`,
    "--new-window",
    "--start-fullscreen",
    "--start-maximized",
    `--window-size=${size.width},${size.height}`,
    "--disable-features=Translate,MediaRouter",
    "--no-first-run",
    "--no-default-browser-check"
  ];

  if (useKiosk) {
    browserArgs.push("--kiosk");
  }

  await mkdir(profileDir, { recursive: true });
  if (args.get("wait") !== "false" && waitMs > 0) {
    await waitForUrl(url, waitMs);
  }

  let context;
  try {
    context = await launchWith({ args: browserArgs });
  } catch (error) {
    console.warn("Bundled Playwright Chromium is not available. Falling back to Microsoft Edge.");
    context = await launchWith({ channel: process.env.DESIGN_BROWSER_CHANNEL || "msedge", args: browserArgs });
  }

  await installBrowserControls(context);

  let page = context.pages()[0] ?? (await context.newPage());
  if (!page.url().startsWith("http")) {
    await page.goto(url);
  }

  await page.bringToFront();
  console.log(`Design browser launched: ${url}`);
  console.log(`Profile: ${profileDir}`);
  console.log("Move the cursor to the upper-right edge to reveal Minimize and Close.");
  console.log("Close the design browser window or press Ctrl+C here to stop it.");

  const shutdown = async () => {
    await context.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise((resolve) => {
    context.on("close", resolve);
  });
}

launchDesignBrowser().catch((error) => {
  console.error(error);
  process.exit(1);
});
