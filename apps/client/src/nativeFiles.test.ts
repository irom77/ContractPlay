import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  isTauri: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: nativeMocks.isTauri }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: nativeMocks.open, save: nativeMocks.save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: nativeMocks.readTextFile, writeTextFile: nativeMocks.writeTextFile }));

import { isNativeClient, openHandFiles, savePbnFile } from "./nativeFiles.js";

describe("native hand file access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeMocks.isTauri.mockReturnValue(true);
  });

  it("reads the PBN file selected in the native document picker", async () => {
    nativeMocks.open.mockResolvedValue("/user/boards/board.pbn");
    nativeMocks.readTextFile.mockResolvedValue('[Dealer "N"]');

    await expect(openHandFiles()).resolves.toEqual([{ name: "board.pbn", contents: '[Dealer "N"]' }]);

    expect(nativeMocks.open).toHaveBeenCalledWith(expect.objectContaining({
      multiple: true,
      directory: false,
      fileAccessMode: "scoped",
      filters: [{ name: "Bridge hand, results, or board set backup", extensions: ["pbn", "lin", "xml", "txt", "json"] }]
    }));
    expect(nativeMocks.readTextFile).toHaveBeenCalledWith("/user/boards/board.pbn");
  });

  it("reads a selected PBN and USEBIO file pair for one board set", async () => {
    nativeMocks.open.mockResolvedValue(["/user/boards/hands.pbn", "/user/boards/results.xml"]);
    nativeMocks.readTextFile.mockImplementation(async (path: string) => path.endsWith(".xml") ? "<USEBIO/>" : '[Dealer "N"]');
    await expect(openHandFiles()).resolves.toEqual([
      { name: "hands.pbn", contents: '[Dealer "N"]' },
      { name: "results.xml", contents: "<USEBIO/>" }
    ]);
    expect(nativeMocks.open).toHaveBeenCalledWith(expect.objectContaining({
      multiple: true,
      filters: [{ name: "Bridge hand, results, or board set backup", extensions: ["pbn", "lin", "xml", "txt", "json"] }]
    }));
  });

  it("does not access a file when the native picker is cancelled", async () => {
    nativeMocks.open.mockResolvedValue(null);

    await expect(openHandFiles()).resolves.toBeNull();

    expect(nativeMocks.readTextFile).not.toHaveBeenCalled();
  });

  it("writes exported PBN only to the path selected in the native save dialog", async () => {
    nativeMocks.save.mockResolvedValue("/user/boards/export.pbn");

    await expect(savePbnFile("contractplay-hand.pbn", "PBN contents")).resolves.toBe(true);

    expect(nativeMocks.save).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "contractplay-hand.pbn",
      filters: [{ name: "Portable Bridge Notation", extensions: ["pbn"] }]
    }));
    expect(nativeMocks.writeTextFile).toHaveBeenCalledWith("/user/boards/export.pbn", "PBN contents");
  });

  it("does not write an exported PBN when the native save dialog is cancelled", async () => {
    nativeMocks.save.mockResolvedValue(null);

    await expect(savePbnFile("contractplay-hand.pbn", "PBN contents")).resolves.toBe(false);

    expect(nativeMocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("detects whether the shared client is running in Tauri", () => {
    nativeMocks.isTauri.mockReturnValue(true);
    expect(isNativeClient()).toBe(true);
    nativeMocks.isTauri.mockReturnValue(false);
    expect(isNativeClient()).toBe(false);
  });
});
