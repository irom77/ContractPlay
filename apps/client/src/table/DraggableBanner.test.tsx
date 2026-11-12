// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DraggableBanner, readBannerSpot } from "./DraggableBanner.js";

const key = "contractplay.test-banner";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("DraggableBanner", () => {
  it("keeps its content usable and starts in its default corner", () => {
    render(<DraggableBanner label="Auto play is on" storageKey={key}><button type="button">Stop auto play</button></DraggableBanner>);
    const banner = screen.getByRole("group", { name: "Auto play is on" });
    expect(banner.classList.contains("moved")).toBe(false);
    expect(screen.getByRole("button", { name: "Stop auto play" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move this banner" })).toBeTruthy();
  });

  it("moves with the arrow keys, remembers the spot, and Home puts it back", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<DraggableBanner label="Auto play is on" storageKey={key}><span>text</span></DraggableBanner>);
    screen.getByRole("button", { name: "Move this banner" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    expect(readBannerSpot(window.localStorage, key)).toEqual({ x: expect.closeTo(0.1, 5), y: expect.closeTo(0.05, 5) });
    unmount();

    render(<DraggableBanner label="Auto play is on" storageKey={key}><span>text</span></DraggableBanner>);
    expect(screen.getByRole("group", { name: "Auto play is on" }).classList.contains("moved")).toBe(true);
    screen.getByRole("button", { name: "Move this banner" }).focus();
    await user.keyboard("{Home}");
    expect(readBannerSpot(window.localStorage, key)).toBeUndefined();
    expect(screen.getByRole("group", { name: "Auto play is on" }).classList.contains("moved")).toBe(false);
  });

  it("ignores a broken saved spot and clamps one off the table", () => {
    window.localStorage.setItem(key, "not json");
    expect(readBannerSpot(window.localStorage, key)).toBeUndefined();
    window.localStorage.setItem(key, JSON.stringify({ x: 3, y: -1 }));
    expect(readBannerSpot(window.localStorage, key)).toEqual({ x: 1, y: 0 });
  });
});
