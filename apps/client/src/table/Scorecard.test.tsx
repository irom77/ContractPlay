// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { scoreRubberHand, summarizeRubber, type Rubber } from "@contractplay/core";
import { handsOnCard, playerSideNames, Scorecard } from "./Scorecard.js";

afterEach(cleanup);

const show = (rubber: Rubber, passedOut = false) => {
  const summary = summarizeRubber(rubber);
  render(<Scorecard summary={summary} hands={handsOnCard(rubber, summary)} passedOut={passedOut} />);
  return within(screen.getByRole("region", { name: "Scorecard" }));
};

describe("Scorecard", () => {
  it("explains a doubled contract made with an overtrick, line by line", () => {
    const card = show({ hands: [scoreRubberHand("a", { level: 2, strain: "spades", declarer: "east", doubled: 1 }, 9, "None")] });
    const lines = [...card.getByRole("region", { name: "Last hand's points" }).querySelectorAll("li")].map((line) => line.textContent);
    expect(lines).toEqual([
      "E–W: +120 for making 2♠X (below the line)",
      "E–W: +100 for 1 overtrick (doubled)",
      "E–W: +50 for making a doubled contract",
      "E–W win game 1"
    ]);
    // East–West's game: the arrow points to their column.
    expect(card.getByRole("img", { name: "Game 1 to E–W" }).classList).toContain("pad-game-EW");
    expect(card.getByRole("list", { name: "E–W above the line: 150" })).toBeTruthy();
  });

  it("says a passed-out hand scored nothing", () => {
    const card = show({ hands: [scoreRubberHand("a", { level: 1, strain: "clubs", declarer: "north", doubled: 0 }, 7, "None")] }, true);
    expect(card.getByRole("region", { name: "Last hand's points" }).textContent).toBe("Passed out: no score.");
  });

  it("falls back to points above and below the line when a stored breakdown does not add up", () => {
    const hand = scoreRubberHand("a", { level: 3, strain: "notrump", declarer: "north", doubled: 0 }, 10, "None");
    const card = show({ hands: [{ ...hand, above: { NS: 999, EW: 0 } }] });
    expect(card.getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/N–S: \+100 below the line.*N–S: \+999 above the line/);
  });

  it("leaves hands after the rubber was won off the card", () => {
    const won = (id: string) => scoreRubberHand(id, { level: 3, strain: "notrump", declarer: "north", doubled: 0 }, 9, "None");
    const rubber = { hands: [won("a"), won("b"), won("c")] };
    expect(handsOnCard(rubber, summarizeRubber(rubber)).map((hand) => hand.handId)).toEqual(["a", "b"]);
  });

  it("heads the columns with the players at each side", () => {
    const names = playerSideNames((seat) => ({ north: "Alex", south: undefined, east: "Bot", west: "Priya" })[seat]);
    expect(names.NS.heading).toBe("Alex & South");
    expect(names.EW.heading).toBe("Bot & Priya");
    expect(playerSideNames(() => undefined).NS.heading).toBe("North–South");
  });
});
