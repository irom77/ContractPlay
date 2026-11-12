// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Previews } from "./Previews.js";
import { previewScreens } from "./scenarios.js";
import readme from "../../../../README.md?raw";

afterEach(cleanup);

const surface = () => document.querySelector(".table-surface");

/** What each preview must actually show, so a change that breaks a screen fails here instead of drifting. */
const expectations: Record<string, () => Promise<void> | void> = {
  lobby: async () => { await screen.findByRole("heading", { name: "Open tables" }); },
  seating: () => {
    expect(within(screen.getByRole("group", { name: "West seat" })).getByRole("button", { name: "Add bot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deal" })).toBeTruthy();
  },
  auction: () => {
    expect(screen.getByText("Your call")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Hints" }).getAttribute("aria-checked")).toBe("false");
  },
  "auction-hints": () => {
    expect(screen.getByText("Your call")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Hints" }).getAttribute("aria-checked")).toBe("true");
  },
  declaring: () => {
    expect(screen.getByRole("region", { name: "South's dummy hand" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Play / }).some((card) => !(card as HTMLButtonElement).disabled)).toBe(true);
  },
  "bot-declares": () => {
    expect(screen.getByRole("region", { name: "North's hand" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "South's dummy hand" })).toBeTruthy();
  },
  "defending-left": () => {
    expect(surface()!.classList.contains("dummy-on-left")).toBe(true);
    expect(screen.getByText("Your play")).toBeTruthy();
  },
  "defending-right": () => {
    expect(surface()!.classList.contains("dummy-on-right")).toBe(true);
    expect(screen.getByText("Your play")).toBeTruthy();
  },
  result: () => { expect(screen.getByRole("region", { name: "Hand result" }).textContent).toMatch(/4♠ by North[\s\S]*420/); }
};

describe("UI previews", () => {
  it("covers the major screens in a fixed order", () => {
    expect(previewScreens.map((s) => s.id)).toEqual(Object.keys(expectations));
  });

  it.each(previewScreens.map((s, index) => [s.id, index] as const))("renders the %s screen in its intended state", async (id, index) => {
    render(<Previews index={index} onIndex={() => {}} />);
    expect(screen.getByRole("navigation", { name: "UI previews" }).textContent).toContain(`${index + 1} / ${previewScreens.length}`);
    await expectations[id]!();
  });

  it("is listed, screen by screen, at the top of the README", () => {
    const section = readme.slice(0, readme.indexOf("<p align"));
    const listed = [...section.matchAll(/\| (\d+) \| ([^|]+?) (?=\|)/g)].map((m) => [Number(m[1]), m[2]!.trim()] as const).sort((a, b) => a[0] - b[0]);
    expect(listed).toEqual(previewScreens.map((s, i) => [i + 1, s.title] as const));
    expect(section).toContain(`N/${previewScreens.length}`);
  });

  it("steps with Next, Previous, and the arrow keys, stopping at the ends", async () => {
    const user = userEvent.setup();
    const onIndex = vi.fn();
    const { rerender } = render(<Previews index={0} onIndex={onIndex} />);
    expect((screen.getByRole("button", { name: "Previous screen" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next screen" }));
    expect(onIndex).toHaveBeenLastCalledWith(1);
    await user.keyboard("{ArrowRight}");
    expect(onIndex).toHaveBeenLastCalledWith(1);

    rerender(<Previews index={previewScreens.length - 1} onIndex={onIndex} />);
    expect((screen.getByRole("button", { name: "Next screen" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{ArrowLeft}");
    expect(onIndex).toHaveBeenLastCalledWith(previewScreens.length - 2);
  });

  it("hides the navigation bar and brings it back", async () => {
    const user = userEvent.setup();
    render(<Previews index={2} onIndex={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Hide preview controls" }));
    expect(screen.queryByRole("button", { name: "Next screen" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show preview controls" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Next screen" })).toBeTruthy());
  });
});
