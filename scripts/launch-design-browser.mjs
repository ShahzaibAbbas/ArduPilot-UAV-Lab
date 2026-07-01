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

async function launchWith(options) {
  return chromium.launchPersistentContext(profileDir, {
    ...options,
    headless: false,
    ignoreDefaultArgs: ["--no-sandbox"],
    viewport: null
  });
}

async function launchDesignBrowser() {
  const args = parseArgs();
  const url = args.get("url") || defaultUrl;
  const size = parseSize(args.get("size") || defaultSize);
  const useKiosk = args.get("kiosk") === "true";
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

  let context;
  try {
    context = await launchWith({ args: browserArgs });
  } catch (error) {
    console.warn("Bundled Playwright Chromium is not available. Falling back to Microsoft Edge.");
    context = await launchWith({ channel: process.env.DESIGN_BROWSER_CHANNEL || "msedge", args: browserArgs });
  }

  let page = context.pages()[0] ?? (await context.newPage());
  if (!page.url().startsWith("http")) {
    await page.goto(url);
  }

  await page.bringToFront();
  console.log(`Design browser launched: ${url}`);
  console.log(`Profile: ${profileDir}`);
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
