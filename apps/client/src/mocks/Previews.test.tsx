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
  lobby: async () => {
    await screen.findByRole("heading", { name: "Open tables" });
    expect(screen.getByRole("button", { name: "Recent hands" })).toBeTruthy();
  },
  seating: () => {
    expect(within(screen.getByRole("group", { name: "West seat" })).getByRole("button", { name: "Add bot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deal" })).toBeTruthy();
  },
  auction: () => {
    expect(screen.getByText("Your call")).toBeTruthy();
    // While bidding, the hand is grouped by suit exactly as in the play: one row per suit, alternating colours
    // (♠♥♣♦), with suits drawn as shapes, so like-coloured suits never sit together.
    const hand = screen.getByRole("region", { name: "South's hand" });
    expect(hand.classList.contains("fixed-seat-hand")).toBe(true);
    const suitGroups = [...hand.querySelectorAll(".dummy-suit-row")].map((row) => new Set([...row.querySelectorAll(".table-card")].map((card) => card.getAttribute("aria-label")!.split(" of ")[1])));
    expect(suitGroups.map((suits) => [...suits])).toEqual([["spades"], ["hearts"], ["clubs"], ["diamonds"]]);
    expect(document.querySelector(".hand-zone")).toBeNull();
    expect(document.querySelector(".table-card .card-corner svg.suit-glyph")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
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
    expect(surface()!.querySelectorAll(".hidden-hand .card-back").length).toBeGreaterThan(0);
  },
  "defending-right": () => {
    expect(surface()!.classList.contains("dummy-on-right")).toBe(true);
    expect(screen.getByText("Your play")).toBeTruthy();
  },
  queued: () => {
    expect(screen.getAllByRole("button", { name: /^Unqueue / })).toHaveLength(1);
    expect(screen.getByText(/^Queued:/)).toBeTruthy();
  },
  "game-menu": () => {
    const menu = screen.getByRole("group", { name: "Game menu" });
    expect(menu.closest("details")!.open).toBe(true);
    expect(within(menu).getByRole("button", { name: "Back to lobby" })).toBeTruthy();
    expect((within(menu).getByRole("button", { name: "Take back" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(menu).getByRole("button", { name: "Cancel this hand" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Scores" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Recent hands" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "Leave the table" })).toBeTruthy();
  },
  "auto-play": () => {
    const banner = screen.getByRole("group", { name: "Auto play is on" });
    expect(within(banner).getByRole("button", { name: "Stop auto play" })).toBeTruthy();
    // The banner floats clear of the hand and can be dragged anywhere on the table.
    expect(banner.closest(".hand-zone, .pos-bottom")).toBeNull();
    expect(within(banner).getByRole("button", { name: "Move this banner" })).toBeTruthy();
    expect(screen.getByText("auto play")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Play / }).filter((card) => !(card as HTMLButtonElement).disabled)).toHaveLength(0);
  },
  "claim-answer": () => {
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "North's hand" }).querySelectorAll(".table-card").length).toBe(10);
  },
  result: () => {
    const result = screen.getByRole("region", { name: "Hand result" });
    // A rubber table: the scorecard with the players' names, the game won by North–South, and the hand explained.
    expect(result.textContent).toMatch(/4♠ by North/);
    const card = within(result).getByRole("region", { name: "Scorecard" });
    expect(within(card).getByRole("heading", { name: "Alex & Bot" })).toBeTruthy();
    expect(within(card).getByText("Games: N–S 1, E–W 0 · N–S vulnerable")).toBeTruthy();
    expect(within(card).getByRole("img", { name: "Game 1 to N–S" })).toBeTruthy();
    expect(within(card).getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/N–S: \+120 for making 4♠ \(below the line\)[\s\S]*N–S win game 1/);
    expect(within(result).getByRole("button", { name: "Deal" })).toBeTruthy();
    // All 52 cards face-up at their seats around the result, each hand with its high-card points.
    for (const seat of ["North", "East", "South", "West"]) expect(screen.getByRole("region", { name: `${seat}'s hand` }).querySelectorAll(".table-card")).toHaveLength(13);
    expect(document.querySelectorAll(".hcp-badge")).toHaveLength(4);
  },
  "rubber-score": () => {
    const dialog = screen.getByRole("dialog", { name: "Scores" });
    const card = within(dialog).getByRole("region", { name: "Scorecard" });
    expect(within(card).getByText("Games: N–S 0, E–W 0 · Neither side vulnerable")).toBeTruthy();
    expect(within(card).getByRole("list", { name: "E–W above the line: 30, 50" })).toBeTruthy();
    expect(within(card).getByRole("list", { name: "E–W game 1: 60" })).toBeTruthy();
    expect(within(card).getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/E–W: \+50 for defeating 3NT by 1/);
    expect(within(card).queryByRole("img", { name: /^Game 1 to/ })).toBeNull();
    // Opened over a hand in play.
    expect(screen.getAllByRole("button", { name: /^Play / }).length).toBeGreaterThan(0);
  },
  "rubber-won": () => {
    const result = screen.getByRole("region", { name: "Hand result" });
    const card = within(result).getByRole("region", { name: "Scorecard" });
    expect(within(card).getByRole("status").textContent).toMatch(/N–S win the rubber 2–0[\s\S]*Final score N–S 920 · E–W 0 · N–S by 920 points/);
    expect(within(card).getByRole("list", { name: "N–S above the line: 700" })).toBeTruthy();
    expect(within(card).getAllByRole("img", { name: /to N–S$/ })).toHaveLength(2);
    expect(within(card).getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/N–S win game 2[\s\S]*\+700 rubber bonus/);
    for (const name of ["Deal a new rubber", "Seating", "Back to lobby", "Leave the table", "Close"]) expect(within(card).getByRole("button", { name })).toBeTruthy();
  },
  "solo-setup": () => {
    expect(screen.getByRole("region", { name: "New deal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a new hand" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Scoring" }) as HTMLSelectElement).value).toBe("rubber");
    expect((screen.getByRole("combobox", { name: "Opponents" }) as HTMLSelectElement).value).toBe("bots");
    expect((screen.getByRole("combobox", { name: "Your seat" }) as HTMLSelectElement).value).toBe("south");
  },
  "solo-auction": () => {
    expect(document.querySelector(".status-pill")!.textContent).toBe("Your call");
    expect(screen.getByRole("group", { name: "Contract bids by level and strain" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Auction calls" }).querySelectorAll("li")).toHaveLength(2);
  },
  "solo-declaring": () => {
    expect(screen.getByRole("region", { name: "South's dummy hand" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Play / }).some((card) => !(card as HTMLButtonElement).disabled)).toBe(true);
    expect(document.querySelector(".status-pill")!.textContent).not.toMatch(/^Bot/);
  },
  "solo-auto-play": () => {
    // The same floating, draggable banner as online.
    const banner = screen.getByRole("group", { name: "Auto play is on" });
    expect(within(banner).getByRole("button", { name: "Stop auto play" })).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "Move this banner" })).toBeTruthy();
    expect(banner.closest(".hand-zone, .pos-bottom")).toBeNull();
    expect(document.querySelector(".status-pill")!.textContent).toBe("Bot · East to play");
    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
  },
  "solo-claim": () => {
    const picker = screen.getByRole("group", { name: "Claim tricks" });
    expect(within(picker).getByRole("group", { name: "Claim some of the tricks" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Play / }).every((card) => (card as HTMLButtonElement).disabled)).toBe(true);
  },
  "solo-menu": () => {
    const menu = screen.getByRole("group", { name: "Game menu" });
    expect(menu.closest("details")!.open).toBe(true);
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual(
      ["Online tables", "Claim", "Take back", "Auto play this hand", "Settings", "Scores", "Recent hands", "About ContractPlay", "Deal a new hand"]);
    // No Take back or Redo buttons on the table itself.
    expect(document.querySelector(".history-controls")).toBeNull();
  },
  "solo-settings": () => {
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect((within(dialog).getByRole("combobox", { name: "Opponents" }) as HTMLSelectElement).value).toBe("bots");
    expect(within(dialog).getByRole("checkbox", { name: "Play forced cards automatically" })).toBeTruthy();
  },
  "solo-hands": () => {
    const dialog = screen.getByRole("dialog", { name: "Recent hands" });
    expect(within(dialog).getByRole("button", { name: /^Review SAKJ74_HK83_CQ92_DA6, played / })).toBeTruthy();
    expect(within(dialog).getByText("Import a PBN deal")).toBeTruthy();
  },
  "solo-result": () => {
    const result = screen.getByRole("region", { name: "Hand result" });
    expect(result.textContent).toMatch(/4♠ by North/);
    const card = within(result).getByRole("region", { name: "Scorecard" });
    expect(within(card).getByRole("heading", { name: "We (N–S)" })).toBeTruthy();
    expect(within(card).getByRole("list", { name: "They game 1: 60" })).toBeTruthy();
    expect(within(card).getByRole("list", { name: "We game 1: 120" })).toBeTruthy();
    expect(within(card).getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/We: \+120 for making 4♠[\s\S]*We win game 1/);
    expect(within(card).getByRole("button", { name: "Next deal" })).toBeTruthy();
    for (const seat of ["North", "East", "South", "West"]) expect(screen.getByRole("region", { name: `${seat}'s hand` }).querySelectorAll(".table-card")).toHaveLength(13);
  },
  "solo-rubber-won": () => {
    const card = within(screen.getByRole("region", { name: "Hand result" })).getByRole("region", { name: "Scorecard" });
    expect(within(card).getByRole("status").textContent).toMatch(/We win the rubber 2–0/);
    expect(within(card).getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/\+700 rubber bonus/);
    expect(within(card).getByRole("button", { name: "Play another rubber" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Online tables" })).toBeTruthy();
  },
  "solo-review": () => {
    expect(screen.getByRole("region", { name: "Hand review" })).toBeTruthy();
    expect(document.querySelector(".status-pill")!.textContent).toBe("Reviewing action 18 of 60");
    expect(within(screen.getByRole("group", { name: "Review controls" })).getByRole("button", { name: "Exit review" })).toBeTruthy();
  },
  "solo-field-result": () => {
    const field = screen.getByRole("region", { name: "Result against the field" });
    expect(field.textContent).toContain("37.5% · 3 of 8 matchpoints");
    expect(field.textContent).toContain("You");
    expect(within(field).getByText("Board 7 · 1 of 3")).toBeTruthy();
    expect(document.querySelector(".table-status .board-label")!.textContent).toBe("Board 7 · 1 of 3");
    expect(screen.getByRole("button", { name: "View original play" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Hand result" })).getByRole("button", { name: "Next board" })).toBeTruthy();
  },
  "solo-original-play": () => {
    expect(document.querySelector(".status-pill")!.textContent).toMatch(/Original play: action 8 of/);
    expect(within(screen.getByRole("group", { name: "Review controls" })).getByRole("button", { name: "Back to your result" })).toBeTruthy();
    expect(document.querySelector(".board-label")).toBeNull();
  }
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
