/** Restore saved/minimized/off-screen Chromium app windows before showing them. */
export async function restoreDesignBrowserWindow(page, size, { fullscreen = true } = {}) {
  const session = await page.context().newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    // Chromium rejects a rectangle combined with maximized/fullscreen bounds.
    // bringToFront alone activates a tab but may leave its window minimized.
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await session.send("Browser.setWindowBounds", {
      windowId, bounds: { left: 0, top: 0, width: size.width, height: size.height }
    });
    await session.send("Browser.setWindowBounds", {
      windowId, bounds: { windowState: fullscreen ? "fullscreen" : "maximized" }
    });
    await page.bringToFront();
  } finally {
    await session.detach().catch(() => undefined);
  }
}
