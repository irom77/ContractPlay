// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFullscreen, setFullscreen } from "./nativeWindow.js";

type Prefixed = { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void; webkitRequestFullscreen?: () => void };

describe("browser full screen", () => {
  const doc = document as unknown as Prefixed & { requestFullscreen?: unknown; exitFullscreen?: unknown };
  const root = document.documentElement as unknown as Prefixed & { requestFullscreen?: unknown };
  const saved = { request: root.requestFullscreen, exit: doc.exitFullscreen };
  afterEach(() => {
    delete doc.webkitFullscreenElement;
    delete doc.webkitExitFullscreen;
    delete root.webkitRequestFullscreen;
    root.requestFullscreen = saved.request;
    doc.exitFullscreen = saved.exit;
  });

  it("falls back to the webkit-prefixed API that older iPad Safari offers", async () => {
    let element: Element | null = null;
    Object.defineProperty(doc, "webkitFullscreenElement", { configurable: true, get: () => element });
    delete root.requestFullscreen;
    delete doc.exitFullscreen;
    root.webkitRequestFullscreen = vi.fn(() => { element = document.documentElement; });
    doc.webkitExitFullscreen = vi.fn(() => { element = null; });

    expect(await setFullscreen(true)).toBe(true);
    expect(root.webkitRequestFullscreen).toHaveBeenCalledTimes(1);
    expect(await isFullscreen()).toBe(true);
    expect(await setFullscreen(false)).toBe(false);
    expect(doc.webkitExitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("reports a browser with no full-screen API", async () => {
    delete root.requestFullscreen;
    await expect(setFullscreen(true)).rejects.toThrow();
  });
});
