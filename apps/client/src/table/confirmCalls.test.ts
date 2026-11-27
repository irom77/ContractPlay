import { describe, expect, it } from "vitest";
import { confirmCallsMenuItem, confirmCallsStorageKey, loadConfirmCalls, saveConfirmCalls } from "./confirmCalls.js";

const memory = (initial?: string) => {
  const values = new Map<string, string>(initial === undefined ? [] : [[confirmCallsStorageKey, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
};

describe("confirm calls setting", () => {
  it("is on unless turned off", () => {
    expect(loadConfirmCalls(memory())).toBe(true);
    expect(loadConfirmCalls(memory("on"))).toBe(true);
    expect(loadConfirmCalls(memory("off"))).toBe(false);
    expect(loadConfirmCalls(undefined)).toBe(true);
    expect(loadConfirmCalls({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
  });

  it("is remembered", () => {
    const storage = memory();
    saveConfirmCalls(storage, false);
    expect(storage.values.get(confirmCallsStorageKey)).toBe("off");
    saveConfirmCalls(storage, true);
    expect(storage.values.get(confirmCallsStorageKey)).toBe("on");
    expect(() => saveConfirmCalls({ setItem: () => { throw new Error("full"); } }, true)).not.toThrow();
  });

  it("names the menu entry for what it does next", () => {
    expect(confirmCallsMenuItem(true, () => {}).label).toBe("Bid with one tap");
    expect(confirmCallsMenuItem(false, () => {}).label).toBe("Confirm each call");
  });
});
