// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Previews } from "./Previews.js";
import { previewCategories, previewScreens } from "./scenarios.js";
import readme from "../../../../README.md?raw";

afterEach(cleanup);

const surface = () => document.querySelector(".table-surface");

/** What each preview must actually show, so a change that breaks a screen fails here instead of drifting. */
const expectations: Record<string, () => Promise<void> | void> = {
  lobby: async () => {
    // Open tables sits above Play, and both open collapsed to their headers.
    const tables = await screen.findByRole("button", { name: /^Open tables/, expanded: false });
    const playToggle = screen.getByRole("button", { name: /^Play/, expanded: false });
    expect(tables.compareDocumentPosition(playToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The duplicate session form is collapsed too, marked Experimental.
    const session = screen.getByRole("button", { name: /^New duplicate session/, expanded: false });
    expect(within(session).getByRole("img", { name: "Experimental" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recent hands" })).toBeTruthy();
    expect(screen.getByText("Signed in as Alex")).toBeTruthy();
    // The bot leaderboard panel starts open; with no rated bots it says so instead of an empty list.
    expect(await screen.findByText(/No bots are rated yet/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Bot leaderboard" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change name" })).toBeTruthy();
    const user = userEvent.setup();
    await user.click(tables);
    expect(screen.getByText("SAYC · Rubber bridge · Conservative bots")).toBeTruthy();
    expect(screen.getByText("Careful Cora")).toBeTruthy();
    // Alex hosts Beginners welcome, so Rename sits beside its Join; Friday club is someone else's.
    expect(screen.getByRole("button", { name: "Rename Beginners welcome" }).parentElement).toBe(screen.getByRole("button", { name: "Join Beginners welcome" }).parentElement);
    expect(screen.queryByRole("button", { name: "Rename Friday club" })).toBeNull();
    await user.click(playToggle);
    const play = screen.getByRole("form", { name: "Play" });
    expect(within(play).getByLabelText("Bot aggressiveness")).toBeTruthy();
    expect(within(play).getByRole("radio", { name: "Me and bots" })).toBeTruthy();
    expect(within(play).getByRole("radio", { name: "With other people" })).toBeTruthy();
    expect(within(play).getByRole("button", { name: "Play" })).toBeTruthy();
  },
  seating: () => {
    expect(within(screen.getByRole("group", { name: "West seat" })).getByRole("button", { name: "Add bot" })).toBeTruthy();
    const north = within(screen.getByRole("group", { name: "North seat" }));
    expect(north.getByText("Gentle Gina · Advanced · Player's character", { selector: "strong" })).toBeTruthy();
    expect(north.getByText("Openings: Sound · Competing: Sells out · Preempts: Sound · Penalty doubles: Rarely · Second hand: Low")).toBeTruthy();
    const east = within(screen.getByRole("group", { name: "East seat" }));
    expect(east.getByText("Bold Bea · Advanced · Aggressive", { selector: "strong" })).toBeTruthy();
    expect((east.getByLabelText("Bot") as HTMLSelectElement).value).toBe("bea");
    expect(screen.getByRole("button", { name: "Deal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename" })).toBeTruthy();
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
    // The table turns so the declaring hand the human dummy plays sits at the bottom, their own across the table.
    expect(screen.getByRole("region", { name: "North's hand" }).closest(".pos-bottom")).toBeTruthy();
    expect(screen.getByRole("region", { name: "South's dummy hand" }).closest(".pos-top")).toBeTruthy();
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
    expect(within(menu).getByRole("button", { name: "Lay cards in a line" })).toBeTruthy();
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
    // The whole auction stays beside the hands, newest call first, and a call there can still be explained.
    expect(screen.getByRole("group", { name: "North calls" }).textContent).toBe("4♠1♠");
    expect(screen.getByRole("group", { name: "South calls" }).textContent).toBe("Pass3♠");
    expect(screen.getAllByRole("button", { name: "Explain East's Pass" })).toHaveLength(2);
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
    for (const name of ["Deal a new rubber", "Back to lobby", "Leave the table", "Close"]) expect(within(card).getByRole("button", { name })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Seating" })).toBeNull();
    // The winner sits on its own banner (it pulses in the stylesheet), with the games score kept on one line.
    expect(within(card).getByRole("heading", { name: "N–S win the rubber 2–0" }).querySelector(".pad-result-games")?.textContent).toBe("2–0");
    // West, a person who has stepped away, keeps the widest seat label; the table measures every seat so the panel
    // can be placed clear of them all.
    expect(screen.getByText("Annabelle Fitzgerald").getAttribute("title")).toBe("Annabelle Fitzgerald");
    const surface = document.querySelector<HTMLElement>(".table-surface.hands-revealed")!;
    for (const side of ["top", "right", "bottom", "left"]) expect(surface.style.getPropertyValue(`--measured-${side}-room`)).toMatch(/^\d+px$/);
  },
  "duplicate-session": () => {
    expect(document.querySelector(".session-progress")?.textContent).toBe("Board 3 complete · waiting for other tables · Place 1 of 4 · 66.7% matchpoints");
  },
  "solo-setup": () => {
    expect(screen.getByRole("region", { name: "New deal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a new hand" })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Scoring" }) as HTMLSelectElement).value).toBe("rubber");
    expect((screen.getByRole("combobox", { name: "Opponents" }) as HTMLSelectElement).value).toBe("bots");
    expect((screen.getByRole("combobox", { name: "Your seat" }) as HTMLSelectElement).value).toBe("south");
    expect((screen.getByRole("combobox", { name: "Partner" }) as HTMLSelectElement).value).toBe("bea");
    expect((screen.getByRole("combobox", { name: "Left opponent" }) as HTMLSelectElement).value).toBe("cora");
    expect((screen.getByRole("combobox", { name: "Right opponent" }) as HTMLSelectElement).value).toBe("own-gentlegina");
    expect(screen.getAllByRole("option", { name: "Gentle Gina · Your character" })).toHaveLength(3);
    expect(screen.getByRole("list", { name: "Your bots" }).textContent).toContain("Bold Bea (Advanced): Competes on every hand. 14 hands together, +230 a hand.");
    expect(screen.getByRole("list", { name: "Your bots" }).textContent).toContain("Careful Cora (Intermediate): Won't bid without the goods. 16 hands against, +317 a hand.");
    expect(screen.getByRole("list", { name: "Your bots" }).textContent).toContain("Gentle Gina (Advanced): Sound and patient; never doubles you for penalty. 3 hands against, -40 a hand.");
    // Every seat is a character, so the custom bot's skill and aggressiveness are not asked for.
    expect(screen.queryByRole("combobox", { name: "Bot skill" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Bot aggressiveness" })).toBeNull();
    expect(screen.getByRole("button", { name: "New character" })).toBeTruthy();
  },

  "solo-auction": () => {
    expect(document.querySelector(".status-pill")!.textContent).toBe("Your call");
    const bidRows = within(screen.getByRole("group", { name: "Contract bids by level and strain" })).getAllByRole("button");
    // Each row of the bidding box runs from notrump down to clubs.
    expect(bidRows.slice(0, 5).map((bid) => bid.getAttribute("aria-label"))).toEqual(["1 notrump", "1 spades", "1 hearts", "1 diamonds", "1 clubs"]);
    expect(screen.getByRole("list", { name: "Auction calls" }).querySelectorAll("li")).toHaveLength(2);
  },
  "solo-declaring": () => {
    expect(screen.getByRole("region", { name: "South's dummy hand" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Play / }).some((card) => !(card as HTMLButtonElement).disabled)).toBe(true);
    expect(document.querySelector(".status-pill")!.textContent).not.toMatch(/^Bot/);
  },
  "solo-bot-declares": () => {
    // South plays for their bot partner: North's declaring hand at the bottom, South's own across the table as dummy.
    expect(document.querySelector(".seat-north")!.classList.contains("pos-bottom")).toBe(true);
    expect(screen.getByRole("region", { name: "South's dummy hand" }).closest(".pos-top")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Play / }).some((card) => !(card as HTMLButtonElement).disabled)).toBe(true);
    expect(document.querySelector(".status-pill")!.textContent).not.toMatch(/^Bot/);
    expect(document.querySelector(".seat-north .bot-name-tag")?.textContent).toBe("Bold Bea");
    expect(document.querySelector(".seat-west .bot-name-tag")?.textContent).toBe("Careful Cora");
    expect(document.querySelector(".seat-east .bot-name-tag")?.textContent).toBe("Wild Wes");
    expect(document.querySelector(".seat-south .bot-name-tag")).toBeNull();
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
    expect((within(dialog).getByRole("combobox", { name: "Cards" }) as HTMLSelectElement).value).toBe("fan");
  },
  "solo-hands": () => {
    const dialog = screen.getByRole("dialog", { name: "Recent hands" });
    expect(within(dialog).getByRole("button", { name: /^Review SAKJ74_HK83_CQ92_DA6, played / })).toBeTruthy();
    expect(within(dialog).getByText("Import a PBN deal")).toBeTruthy();
    const partners = within(dialog).getAllByRole("listitem").filter((item) => item.closest("[aria-label='Your partners']")).map((item) => item.textContent);
    expect(partners).toEqual([
      "Bold Bea14 hands together, +230 a hand · made 7 of 9 contracts you declared",
      "Sharp Kim9 hands together, +410 a hand · made 6 of 6 contracts you declared",
      "Rookie Ray3 hands together, -103 a hand · made 1 of 2 contracts you declared"
    ]);
    const opponents = within(dialog).getAllByRole("listitem").filter((item) => item.closest("[aria-label='Your opponents']")).map((item) => item.textContent);
    expect(opponents).toEqual([
      "Careful Cora16 hands against, +317 a hand",
      "Wild Wes16 hands against, +317 a hand",
      "Daring Dex7 hands against, +263 a hand",
      "Timid Tess3 hands against, -103 a hand",
      "Eager Eddie3 hands against, -103 a hand"
    ]);
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
    for (const seat of ["North", "East", "South", "West"]) expect(screen.getByRole("group", { name: `${seat} calls` })).toBeTruthy();
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
  },
  "solo-replayed-deal": () => {
    expect(document.querySelector(".status-pill")!.textContent).toBe("Your call");
    const notice = screen.getByRole("status", { name: "" });
    expect(notice.classList.contains("replay-notice")).toBe(true);
    expect(notice.textContent).toBe("Replayed deal · first played 12 Nov 2026, 14:32 · you may have played it before.");
  },
  "solo-replay-result": () => {
    const result = screen.getByRole("region", { name: "Hand result" });
    const field = within(result).getByRole("region", { name: "Result against the field" });
    expect(field.textContent).toContain("Original: 4♠ by N · 10 tricks · NS +420 · 12 Nov 2026");
    expect(field.textContent).toMatch(/[+-]\d+ IMPs? against a datum of NS/);
    expect(field.textContent).toContain("Earlier results rescored at your vulnerability");
    // In a rubber the comparison sits above the scorecard, and there is no View original.
    expect(within(result).getByRole("region", { name: "Scorecard" })).toBeTruthy();
    expect(within(result).queryByRole("button", { name: "View original play" })).toBeNull();
    expect(screen.getByText(/^Replayed deal · first played 12 Nov 2026, 14:32/)).toBeTruthy();
  },
  "online-replay-result": () => {
    const result = screen.getByRole("region", { name: "Hand result" });
    const field = screen.getByRole("region", { name: "Result against the field" });
    expect(field.textContent).toContain("Original: 4♠ by N · 10 tricks · NS +420 · 12 Nov 2026");
    expect(field.textContent).toMatch(/[+-]\d+ IMPs? against a datum of NS/);
    expect(field.textContent).toContain("Earlier results rescored at your vulnerability");
    expect(within(result).getByRole("button", { name: "Deal" })).toBeTruthy();
    // The start notice is for the hand in play; once it is over the comparison replaces it.
    expect(screen.queryByText(/^Replayed deal/)).toBeNull();
  },
  "email-sign-in": async () => {
    expect(screen.getByRole("region", { name: "Email sign-in" })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("alex@example.com");
    // Under the form, what ContractPlay is for: replays, autopilot, and a record of every hand.
    const mission = screen.getByRole("region", { name: "Why ContractPlay" });
    expect(within(mission).getByRole("heading", { level: 2 }).textContent).toBe("Bridge that remembers every hand");
    expect(within(mission).getAllByRole("listitem").map((item) => item.querySelector("strong")?.textContent))
      .toEqual(["Replay real deals", "Autopilot when you need it", "Every hand on record", "Practise with bots that explain"]);
    // Under the points, a crossfading tour of the table; each slide opens its preview.
    const tour = within(mission).getByRole("figure", { name: "A look at the table" });
    expect(tour.querySelector(".tour-slide.current")?.getAttribute("href")).toBe("#/mocks/18");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
    expect(await screen.findByText("Check your email for a sign-in link.")).toBeTruthy();
  },
  "email-link-sent": () => {
    expect(screen.getByRole("region", { name: "Email sign-in" })).toBeTruthy();
    expect(screen.getByText("Check your email for a sign-in link.")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
  },
  "result-waiting": () => {
    const result = screen.getByRole("region", { name: "Hand result" });
    // North and South have confirmed; the next hand waits for East, and the result stays on the table meanwhile.
    const waiting = within(result).getByRole("button", { name: "Waiting for East" }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    expect(waiting.title).toMatch(/You are ready\. The next hand is dealt once East is ready too/);
    for (const seat of ["North", "East", "South", "West"]) expect(screen.getByRole("region", { name: `${seat}'s hand` }).querySelectorAll(".table-card")).toHaveLength(13);
  },
  "solo-characters": () => {
    const editor = screen.getByRole("group", { name: "Edit Gentle Gina" });
    expect((within(editor).getByLabelText("Name") as HTMLInputElement).value).toBe("Gentle Gina");
    expect((within(editor).getByLabelText("Skill") as HTMLSelectElement).value).toBe("advanced");
    expect(within(editor).getAllByRole("group").map((group) => group.querySelector("legend")?.textContent))
      .toEqual(["Openings", "Competing", "Preempts", "Penalty doubles", "Leads", "Second hand"]);
    const doubles = within(within(editor).getByRole("group", { name: "Penalty doubles" }));
    expect((doubles.getByLabelText("Rarely") as HTMLInputElement).checked).toBe(true);
    expect(doubles.getByText("Passes rather than double the opponents for penalty.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Your characters" }).textContent).toContain("Gentle Gina");
  },
  "benchmark-lobby": async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Open tables/, expanded: false }));
    expect(screen.getByText("Bot benchmark")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Watch Benchmark · round 12" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Watch Friday club" })).toBeNull();
    // The bot leaderboard sits open below New duplicate session: ranked bots first by rating, then provisional ones.
    const board = screen.getByRole("region", { name: "Bot leaderboard" });
    const session = screen.getByRole("form", { name: "New duplicate session" });
    expect(session.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(board).getByRole("button", { name: "Bot leaderboard", expanded: true })).toBeTruthy();
    expect(within(board).getAllByRole("listitem").map((item) => item.querySelector(".lobby-leaderboard-name")?.textContent))
      .toEqual(["Sharp Kim · v1", "Bold Bea · v1", "Weekly Will · v1", "Steady Sam · v1-2over1"]);
    expect([...board.querySelectorAll(".lobby-leaderboard-stats")].map((stats) => stats.textContent))
      .toEqual(["SAYC · 32 boards · 64 hands", "SAYC · 32 boards · 64 hands", "SAYC · 32 boards · 64 hands", "2/1 · 16 boards · 32 hands · provisional"]);
    await user.click(within(board).getByRole("button", { name: "Full leaderboard" }));
    expect(window.location.hash).toBe("#/leaderboard");
    window.location.hash = "";
  },
  "benchmark-watch": () => {
    const table = screen.getByRole("region", { name: "Benchmark match Benchmark · round 12, read-only observer" });
    // The observer note sits under the top-left controls, clear of the status card in the top-right corner.
    expect(screen.getByText("Watching bot benchmark · read-only").closest(".table-tools")).toBeTruthy();
    expect(document.querySelector(".session-progress")).toBeNull();
    expect(within(table).getByRole("button", { name: "Back to open tables" })).toBeTruthy();
    // A reload control sits with the table tools, apart from any Take back.
    expect(within(table).getByRole("button", { name: "Reload page" }).closest(".table-tools")).toBeTruthy();
    // Hands stay concealed while the board is in play, and there are no gameplay controls.
    expect(table.querySelectorAll(".table-card[aria-label*=' of ']").length).toBeLessThan(16);
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /menu/i })).toBeNull();
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

  it("steps forward with Space and back with Shift+Space, without also pressing the focused button", async () => {
    const user = userEvent.setup();
    const onIndex = vi.fn();
    render(<Previews index={3} onIndex={onIndex} />);
    await user.keyboard(" ");
    expect(onIndex).toHaveBeenLastCalledWith(4);
    await user.keyboard("{Shift>} {/Shift}");
    expect(onIndex).toHaveBeenLastCalledWith(2);

    onIndex.mockClear();
    screen.getByRole("button", { name: "Next screen" }).focus();
    await user.keyboard(" ");
    expect(onIndex.mock.calls).toEqual([[4]]);
  });

  it("keeps stepping with Space on a screen whose form takes focus by itself, but types in a field the reviewer clicks", async () => {
    const user = userEvent.setup();
    const onIndex = vi.fn();
    const signIn = previewScreens.findIndex((s) => s.id === "email-sign-in");
    render(<Previews index={signIn} onIndex={onIndex} />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(document.activeElement).not.toBe(email);
    await user.keyboard(" ");
    expect(onIndex).toHaveBeenLastCalledWith(signIn + 1);
    expect(email.value).toBe("alex@example.com");

    onIndex.mockClear();
    await user.click(email);
    await user.keyboard(" ");
    expect(onIndex).not.toHaveBeenCalled();
  });

  it("puts every screen in exactly one picker group and jumps to the chosen screen", async () => {
    const grouped = previewCategories.flatMap((category) => category.ids);
    expect([...grouped].sort()).toEqual(previewScreens.map((s) => s.id).sort());

    const user = userEvent.setup();
    const onIndex = vi.fn();
    render(<Previews index={0} onIndex={onIndex} />);
    const picker = screen.getByRole("combobox", { name: "Jump to a screen" }) as HTMLSelectElement;
    expect(within(picker).getAllByRole("group").map((group) => group.getAttribute("label"))).toEqual(previewCategories.map((c) => c.name));
    const target = previewScreens.findIndex((s) => s.id === "solo-rubber-won");
    await user.selectOptions(picker, `${target + 1}. ${previewScreens[target]!.title}`);
    expect(onIndex).toHaveBeenLastCalledWith(target);
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
