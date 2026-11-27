import { applyAction, createGameState, legalCards, RANKS, scoreRubberHand, SEATS, summarizeRubber, SUITS, type Bid, type Card, type Deal, type GameAction, type HandRecord, type GameState, type Rank, type Rubber, type Seat, type TravellerRow } from "@contractplay/core";
import type { OwnCharacter, SavedHand, SoloData } from "@contractplay/persistence";
import type { SoloPreview } from "../App.js";
import type { PartnerResult } from "../partnerResults.js";
import type { LobbyTable, TableView } from "@contractplay/protocol";
import type { QueuedCard } from "../table/queuedCard.js";
import type { LeaderboardRating } from "../online/connection.js";
import { handName } from "../handNames.js";
import { botToAct, createTable, observerViewFor, reduce, rubberHandId, summaryOf, viewFor, type TableEvent, type TableState } from "@contractplay/table";

/*
 * UI preview scenarios. Every screen is a real table state built with the same reducer the server runs, then
 * projected with `viewFor` exactly as the server sends it, and drawn by the real components. Layout or component
 * changes therefore show up here automatically; Previews.test.tsx fails if a screen stops reaching its state.
 */

const AT = Date.UTC(2026, 10, 6, 19);
const never = () => { throw new Error("Previews never shuffle: the deal is fixed."); };

/** One hand per seat, written as spades.hearts.diamonds.clubs with T for ten. */
function hand(text: string): Card[] {
  return text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: SUITS[index]!, rank: rank as Rank })));
}

/** North opens 1♠ with 17 points, South raises to 3♠ with four trumps, North bids 4♠; East leads ♦K. */
const DEAL: Deal = {
  north: hand("AKJ74.K83.A6.Q92"),
  east: hand("985.QT7.KQJ9.J86"),
  south: hand("QT63.A92.8542.K7"),
  west: hand("2.J654.T73.AT543")
};
const AUCTION: readonly [Seat, Bid][] = [
  ["north", "1spades"], ["east", "pass"], ["south", "3spades"], ["west", "pass"],
  ["north", "4spades"], ["east", "pass"], ["south", "pass"], ["west", "pass"]
];

type People = Partial<Record<Seat, string>>;
const player = (seat: Seat) => `preview-${seat}`;

function run(state: TableState, event: TableEvent): TableState {
  const outcome = reduce(state, event, never);
  // A bot event that does not apply is ignored rather than refused, so it must visibly move the table on.
  if (outcome.refused || (event.type === "bot" && outcome.state.revision === state.revision)) throw new Error(`Preview step was not accepted: ${JSON.stringify(event)} (${outcome.refused ?? "ignored"})`);
  return outcome.state;
}

/** A table with these humans seated in this order (the first is host), bots in `bots`, named bots in `named`, and other seats open. */
function table(name: string, people: People, bots: readonly Seat[] = [], named: Partial<Record<Seat, string>> = {}): TableState {
  let state = createTable({ id: name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6), name, style: "SAYC", listed: true, at: AT });
  for (const [seat, person] of Object.entries(people) as [Seat, string][]) {
    state = run(state, { type: "connect", player: player(seat), name: person, at: AT });
    state = run(state, { type: "message", player: player(seat), message: { type: "sit", seat }, at: AT });
  }
  const host = player(Object.keys(people)[0] as Seat);
  for (const seat of bots) state = run(state, { type: "message", player: host, message: { type: "setBot", seat, skill: "intermediate" }, at: AT });
  for (const [seat, character] of Object.entries(named) as [Seat, string][]) {
    state = run(state, { type: "message", player: host, message: { type: "setBot", seat, skill: "intermediate", character }, at: AT });
  }
  return state;
}

/**
 * Starts hand 1 on the fixed deal; dealing itself is random, so the game is placed the way a deal would place it,
 * as the first hand of a new rubber. `earlier` puts hands already scored on that rubber.
 */
function dealt(state: TableState, earlier: Rubber["hands"] = []): TableState {
  const game: GameState = createGameState({ deal: DEAL, dealer: "north", vulnerability: summarizeRubber({ hands: earlier }).vulnerability });
  const rubber: Rubber = { hands: earlier, lastDealer: "north", activeHandId: rubberHandId(1) };
  return { ...state, handNumber: 1, revision: state.revision + 1, game, rubber, turnSince: AT, lastHumanAt: AT, trickJustCompleted: false };
}

/** Applies one action through whoever controls it: the seat's bot, or the human allowed to act for it. */
function step(state: TableState, action: GameAction): TableState {
  if (botToAct(state) === action.seat) return run(state, { type: "bot", revision: state.revision, action, at: AT });
  for (const seat of SEATS) {
    const s = state.seats[seat];
    if (s.kind !== "human") continue;
    const outcome = reduce(state, { type: "message", player: s.player, message: { type: "act", handNumber: state.handNumber, revision: state.revision, action }, at: AT }, never);
    if (!outcome.refused && outcome.state.revision > state.revision) return outcome.state;
  }
  throw new Error(`Nobody at the preview table may make ${JSON.stringify(action)}`);
}

const rankOf = (card: Card) => RANKS.indexOf(card.rank);

const partner = (seat: Seat) => SEATS[(SEATS.indexOf(seat) + 2) % 4]!;
const lowest = (cards: readonly Card[]) => [...cards].sort((a, b) => rankOf(a) - rankOf(b))[0]!;
const highest = (cards: readonly Card[]) => [...cards].sort((a, b) => rankOf(b) - rankOf(a))[0]!;

/**
 * A simple, natural card-play policy so the hand reads like real play: declarer's side draws trumps first,
 * otherwise everyone leads the top of their longest suit; later hands win as cheaply as possible unless
 * partner is already winning, and otherwise play low.
 */
function nextCard(game: GameState): Card {
  const seat = game.currentActor;
  const trump = game.contract?.strain === "notrump" ? undefined : game.contract?.strain;
  const trick = game.currentTrick;
  const legal = legalCards(game.hands[seat], trick[0]?.card.suit);
  if (!trick.length) {
    const declaring = game.contract !== undefined && (seat === game.contract.declarer || seat === partner(game.contract.declarer));
    const trumpsOut = trump !== undefined && (game.hands[SEATS[(SEATS.indexOf(seat) + 1) % 4]!].some((c) => c.suit === trump) ||
      game.hands[SEATS[(SEATS.indexOf(seat) + 3) % 4]!].some((c) => c.suit === trump));
    const ownTrumps = legal.filter((card) => card.suit === trump);
    if (declaring && trumpsOut && ownTrumps.length) return highest(ownTrumps);
    const suits = SUITS.filter((suit) => suit !== trump || !declaring).map((suit) => legal.filter((card) => card.suit === suit));
    return highest(suits.sort((a, b) => b.length - a.length)[0]!.length ? suits[0]! : legal);
  }
  const beats = (card: Card, best: Card) => card.suit === best.suit ? rankOf(card) > rankOf(best) : card.suit === trump;
  const winning = trick.reduce((best, play) => beats(play.card, best.card) ? play : best);
  if (winning.seat === partner(seat)) return lowest(legal);
  const winners = legal.filter((card) => beats(card, winning.card));
  return lowest(winners.length ? winners : legal);
}

function bid(state: TableState, calls: number): TableState {
  return AUCTION.slice(0, calls).reduce((current, [seat, call]) => step(current, { type: "bid", seat, bid: call }), state);
}

/** Plays on until `stop` holds, so a screen lands on a real moment of the hand. */
function playUntil(state: TableState, stop: (game: GameState) => boolean): TableState {
  let current = state;
  while (!stop(current.game!)) {
    if (current.game!.phase !== "play") throw new Error("The preview hand ended before reaching its moment.");
    current = step(current, { type: "play", seat: current.game!.currentActor, card: nextCard(current.game!) });
  }
  return current;
}

/** Mid-hand with cards on the table and `seat` (or either seat in `seats`) to play. */
const moment = (seats: readonly Seat[], tricks: number) => (game: GameState) =>
  game.completedTricks.length >= tricks && game.currentTrick.length > 0 && seats.includes(game.currentActor);

export type PreviewData =
  | { kind: "lobby"; viewerName: string; tables: LobbyTable[]; leaderboard?: LeaderboardRating[] }
  | { kind: "table"; viewerName: string; view: TableView; hints?: boolean; menuOpen?: boolean; rubberOpen?: boolean; initialQueued?: QueuedCard; selectedCall?: Bid; ownCharacters?: readonly OwnCharacter[]; observer?: true }
  | { kind: "auth"; sent: boolean }
  | { kind: "solo"; data: SoloData; scoring: "rubber" | "single"; table: Omit<SoloPreview, "storage">; partnerResults?: readonly PartnerResult[]; ownCharacters?: readonly OwnCharacter[] };

export type PreviewScreen = { id: string; title: string; detail: string; build(): PreviewData };

const view = (state: TableState, seat: Seat, people: People, hints?: boolean): PreviewData =>
  ({ kind: "table", viewerName: people[seat]!, view: viewFor(state, player(seat)), ...(hints ? { hints } : {}) });

const you: People = { south: "Alex" };
const others = (seat: Seat) => SEATS.filter((s) => s !== seat);

const onlineScreens: readonly PreviewScreen[] = [
  {
    id: "lobby", title: "Lobby", detail: "Signed in as Alex with Change name; Open tables (one mid-hand, and Beginners welcome, which you host from West, with open seats, conservative bots, and Careful Cora named at East, so it offers Rename beside Join) above the Play panel (Me and bots, or With other people, each with bot skill, bidding style and bot aggressiveness) and the duplicate session form (marked Experimental), all collapsed to their headers until clicked; below them the Bot leaderboard panel starts open and says no bots are rated yet. Renaming yourself or the table here changes only the preview.",
    build: () => {
      const playing = dealt(table("Friday club", { north: "Maria", east: "Sam", south: "Jo", west: "Priya" }));
      const open = { ...table("Beginners welcome", { west: "Alex" }, [], { east: "cora" }), aggression: "conservative" as const };
      return { kind: "lobby", viewerName: "Alex", tables: [summaryOf(playing), { ...summaryOf(open), youHost: true }] };
    }
  },
  {
    id: "seating", title: "Seating", detail: "You host at South with Gentle Gina, your own character, at North (her non-standard dials under her name), and Bold Bea, a named bot, at East. West is still open, so Deal waits. As host you can rename the table.",
    build: () => {
      const people: People = { south: "Alex" };
      const host = player("south");
      const state = table("Friday club", people, [], { east: "bea" });
      const withGina = run(state, { type: "message", player: host, message: { type: "setBot", seat: "north", skill: GINA.skill,
        custom: { id: GINA.id, name: GINA.name, skill: GINA.skill, traits: GINA.traits } }, at: AT });
      return { ...view(withGina, "south", people), ownCharacters: [GINA] };
    }
  },
  {
    id: "auction", title: "Auction: your call", detail: "Partner opened 1♠ and East passed; the bidding box is yours.",
    build: () => view(bid(dealt(table("Friday club", you, others("south"))), 2), "south", you)
  },
  {
    id: "auction-hints", title: "Auction with hints", detail: "The same call with Hints on: your points, the suggested call, and its meaning.",
    build: () => view(bid(dealt(table("Friday club", you, others("south"))), 2), "south", you, true)
  },
  {
    id: "declaring", title: "Declaring 4♠ with dummy", detail: "You are North, declarer; dummy South is face-up across the table and you play both hands.",
    build: () => {
      const people: People = { north: "Alex" };
      return view(playUntil(bid(dealt(table("Friday club", people, others("north"))), 8), moment(["north", "south"], 2)), "north", people);
    }
  },
  {
    id: "bot-declares", title: "Dummy playing for a bot declarer", detail: "Your bot partner declares; as dummy you see and play both hands, with North's declaring hand turned to the bottom and your South hand across the table.",
    build: () => playUntilView(you, "south", moment(["north", "south"], 1))
  },
  {
    id: "defending-left", title: "Defending, dummy on your left", detail: "You are East; dummy South sits on your left and your hand fits beside its column.",
    build: () => playUntilView({ east: "Alex" }, "east", moment(["east"], 2))
  },
  {
    id: "defending-right", title: "Defending, dummy on your right", detail: "You are West; dummy South sits on your right and the hint corner moves to the left.",
    build: () => playUntilView({ west: "Alex" }, "west", moment(["west"], 2))
  },
  {
    id: "queued", title: "Card queued", detail: "You are West and East is to play; you clicked a card to queue it, and it plays when your turn comes.",
    build: () => {
      const people: People = { west: "Alex" };
      const data = playUntilView(people, "west", moment(["east"], 2));
      const held = viewHeld(data);
      return { ...data, initialQueued: { handKey: "1", seat: "west", card: lowest(held) } } as PreviewData;
    }
  },
  {
    id: "game-menu", title: "Game menu", detail: "Mid-hand with the menu open: back to the lobby, recent hands, seating (read-only until the hand ends, with Back to the table), take back your last card, lay the cards in a line instead of a fan, bid with one tap instead of confirming each call, cancel the hand, or leave.",
    build: () => ({ ...playUntilView({ east: "Alex" }, "east", moment(["east"], 2)), menuOpen: true })
  },
  {
    id: "auto-play", title: "Auto play", detail: "You chose Auto play from the menu: a bot plays your East cards until this hand ends, or until you stop it. Drag the banner anywhere on the table.",
    build: () => {
      const people: People = { east: "Alex" };
      const playing = playUntil(bid(dealt(table("Friday club", people, others("east"))), 8), moment(["east"], 2));
      return view(run(playing, { type: "message", player: player("east"), message: { type: "autoPlay" }, at: AT }), "east", people);
    }
  },
  {
    id: "claim-answer", title: "Claim waiting on you", detail: "North, the declarer, claims all the remaining tricks; as an opponent you accept or reject, and the claimer's hand is face-up.",
    build: () => {
      const people: People = { north: "Maria", east: "Alex", west: "Priya" };
      const playing = playUntil(bid(dealt(table("Friday club", people, ["south"])), 8), moment(["south"], 2));
      return view(run(playing, { type: "message", player: player("north"), message: { type: "claim", tricks: 13 - playing.game!.completedTricks.length }, at: AT }), "east", people);
    }
  },
  {
    id: "result", title: "Hand result", detail: "All 52 cards played: every hand face-up at its seat with its high-card points and its calls from the auction (click one for its meaning), and the contract with the rubber scorecard in the middle: North–South's 120 below the line wins game 1 (dotted line, arrow to them), the last hand's points explained, and Deal.",
    build: () => playUntilView({ north: "Alex" }, "north", (game) => game.phase === "complete")
  },
  {
    id: "rubber-score", title: "Scores", detail: "Scores from the game menu, mid-hand: East-West made 2♥ with an overtrick and North-South went down in 3NT, so the first game is still open, nobody is vulnerable, and the last hand's undertrick is explained.",
    build: () => {
      const people: People = { north: "Alex" };
      const earlier = [
        scoreRubberHand("preview-2h", { level: 2, strain: "hearts", declarer: "east", doubled: 0 }, 9, "None"),
        scoreRubberHand("preview-3nt", { level: 3, strain: "notrump", declarer: "south", doubled: 0 }, 8, "None")
      ];
      const playing = playUntil(bid(dealt(table("Friday club", people, others("north")), earlier), 8), moment(["north", "south"], 2));
      return { ...view(playing, "north", people), rubberOpen: true };
    }
  },
  {
    id: "rubber-won", title: "Rubber won", detail: "North–South already have game 1 from 3NT; 4♠ makes game 2 and the rubber: the winner pulses on a gold banner, and the scorecard ends with the 700 rubber bonus, the final score, and Deal a new rubber, Back to lobby, or Leave the table (Seating is in the game menu). The panel keeps clear of West (Annabelle Fitzgerald, a name as long as names go, away) and their points: a long name at a side seat wraps onto two lines.",
    build: () => {
      // West is a person who has stepped away: their name, tag and points make the widest seat label, which the
      // result panel must not cover.
      const people: People = { north: "Alex", west: "Annabelle Fitzgerald" };
      const earlier = [scoreRubberHand("preview-3nt", { level: 3, strain: "notrump", declarer: "south", doubled: 0 }, 9, "None")];
      const played = playUntil(bid(dealt(table("Friday club", people, ["east", "south"]), earlier), 8), (game) => game.phase === "complete");
      return view(run(played, { type: "disconnect", player: player("west"), at: AT }), "north", people);
    }
  },
  {
    id: "duplicate-session", title: "Online: duplicate session progress", detail: "The table has finished board 2 and waits for the other tables; the session shows its current place and matchpoint percentage.",
    build: () => {
      const people: People = { north: "Alex" };
      const state = bid(dealt(table("Club duplicate", people, others("north"))), 2);
      const data = view(state, "north", people);
      if (data.kind !== "table") throw new Error("Expected a table preview.");
      return { ...data, view: { ...data.view, session: { board: 3, position: 3, boardCount: 8, scoring: "matchpoints", completedBoards: 2,
        complete: false, waitingForTables: true, rank: 1, tableCount: 4, matchpoints: { points: 4, top: 6, percentage: 66.6666667 }, crossImps: 12 } } };
    }
  }
];

/*
 * Solo play: the same deal and auction, played straight through the core rules (no table server), and opened in the
 * real solo App from an in-memory copy of its saved data, with every automatic move switched off.
 */
const SOLO_HAND = "preview-solo-hand";

function soloAct(game: GameState, action: GameAction): GameState {
  const result = applyAction(game, action);
  if (!result.ok) throw new Error(`Preview step was not accepted: ${JSON.stringify(action)} (${result.error.message})`);
  return result.state;
}

/** The solo hand after `calls` calls, then played on until `stop` holds. */
function soloGame(calls: number, stop: (game: GameState) => boolean = () => true, vulnerability: GameState["vulnerability"] = "None"): GameState {
  let game = AUCTION.slice(0, calls).reduce((current, [seat, call]) => soloAct(current, { type: "bid", seat, bid: call }),
    createGameState({ deal: DEAL, dealer: "north", vulnerability }));
  while (!stop(game)) {
    if (game.phase !== "play") throw new Error("The preview hand ended before reaching its moment.");
    game = soloAct(game, { type: "play", seat: game.currentActor, card: nextCard(game) });
  }
  return game;
}

/** A rubber whose first hand East–West made 2♥, with this deal (North dealing) played for it. */
const rubberUnderway = (): Rubber => ({
  hands: [scoreRubberHand("preview-earlier", { level: 2, strain: "hearts", declarer: "east", doubled: 0 }, 8, "None", DEAL)],
  lastDealer: "north",
  activeHandId: SOLO_HAND
});

/** A finished hand in the history, named after North's dealt cards as when you played it from North. */
const savedHand = (): SavedHand => {
  const game = soloGame(8, (finished) => finished.phase === "complete");
  return { id: "preview-saved", name: handName(game.initialDeal.north), game, savedAt: new Date(AT).toISOString() };
};

/**
 * A record built up over weeks: fourteen hands with Bold Bea (half against Careful Cora and Wild Wes, half against
 * Daring Dex and a custom bot), nine with Sharp Kim against Cora and Wes, and three with Rookie Ray against Timid Tess and Eager Eddie.
 */
function partnerHistory(): PartnerResult[] {
  const hands = (partner: string, scores: readonly number[], declared: number, made: number, opponents: readonly (readonly [string, string])[]): PartnerResult[] =>
    scores.map((score, index) => {
      const [left, right] = opponents[index % opponents.length]!;
      return { handId: `${partner}-${index}`, partner, left, right, score, declared: index < declared, made: index < made };
    });
  return [
    ...hands("bea", [620, 420, 170, 650, 140, 420, 450, -100, -200, -50, 110, -100, 90, 600], 9, 7, [["cora", "wes"], ["dex", "custom"]]),
    ...hands("kim", [420, 620, 140, 450, 400, 1430, -50, 110, 170], 6, 6, [["cora", "wes"]]),
    ...hands("ray", [90, -100, -300], 2, 1, [["tess", "eddie"]])
  ];
}

/** The player's own character in the previews: sound and patient, never doubling for penalty. */
const GINA: OwnCharacter = { id: "own-gentlegina", name: "Gentle Gina", blurb: "Sound and patient; never doubles you for penalty.", skill: "advanced",
  traits: { openings: "cautious", competing: "cautious", preempts: "cautious", doubles: "cautious", leads: "standard", secondHand: "cautious" }, updatedAt: 1 };

/** The fixed history plus three hands against Gentle Gina. */
const historyWithGina = (): PartnerResult[] => [...partnerHistory(),
  ...[-110, 50, -60].map((score, index) => ({ handId: `gina-${index}`, partner: "kim", left: GINA.id, right: "wes", score, declared: false, made: false, names: { [GINA.id]: GINA.name } }))];

/** Solo before the first hand, with Bold Bea, Careful Cora and Gentle Gina around the player. */
const newDealWithGina = (extra: Omit<SoloPreview, "storage"> = {}): PreviewData => ({
  ...solo(null, { userSeat: "south", cast: { partner: "bea", left: "cora", right: GINA.id }, ...extra }, { completedHands: [], rubber: { hands: [] } }) as Extract<PreviewData, { kind: "solo" }>,
  partnerResults: historyWithGina(), ownCharacters: [GINA] });

function solo(game: GameState | null, table: Omit<SoloPreview, "storage">, extra: Partial<SoloData> = {}): PreviewData {
  return {
    kind: "solo",
    scoring: "rubber",
    table,
    data: { version: 1, currentHandId: game ? SOLO_HAND : null, currentGame: game, completedHands: [savedHand()], rubber: rubberUnderway(), ...extra }
  };
}

/** Board 7 of an imported club game: this hand as the record, with a five-row field (one row an artificial score). */
function boardSetExtra(): Partial<SoloData> {
  const game = soloGame(8, (finished) => finished.phase === "complete");
  const record: HandRecord = {
    board: "7", event: "Club Pairs", scoring: "MP", original: game.history.actions, dealer: game.dealer, vulnerability: game.vulnerability, deal: game.initialDeal,
    field: [
      { nsScore: 420, contract: "4S", declarer: "north", tricks: 10, multiplicity: 1, artificial: false },
      { nsScore: 450, contract: "4S", declarer: "north", tricks: 11, multiplicity: 1, artificial: false },
      { nsScore: 170, contract: "3S", declarer: "north", tricks: 10, multiplicity: 1, artificial: false },
      { nsScore: 500, contract: "4HX", declarer: "east", tricks: 7, multiplicity: 1, artificial: false },
      { nsScore: 0, contract: "Pass", multiplicity: 1, artificial: true }
    ]
  };
  const record2: HandRecord = { ...record, board: "8" };
  const record3: HandRecord = { ...record, board: "9" };
  return { boardSet: { name: "Club Pairs", records: [record, record2, record3], position: 0 }, currentRecord: record, rubber: { hands: [] } };
}

/** An archived deal first played on 12 Nov 2026 (local time, so the shown date never depends on the time zone). */
const FIRST_PLAYED = new Date(2026, 10, 12, 14, 32).getTime();
const ORIGINAL_ROW: TravellerRow = { nsScore: 420, contract: "4S", declarer: "north", tricks: 10, multiplicity: 1, artificial: false };

/** This preview's deal as an archived replay, with the earlier results (the first play among them) scored at its vulnerability. */
function replayRecord(rescored: boolean): HandRecord {
  return {
    event: "Replay", scoring: "IMP", dealer: "north", vulnerability: "None", deal: DEAL, field: [
      ORIGINAL_ROW,
      { nsScore: 450, contract: "4S", declarer: "north", tricks: 11, multiplicity: 1, artificial: false },
      { nsScore: 170, contract: "3S", declarer: "north", tricks: 10, multiplicity: 1, artificial: false },
      { nsScore: -100, contract: "4HX", declarer: "east", tricks: 6, multiplicity: 1, artificial: false }
    ],
    replay: { dealId: "preview-deal", firstPlayedAt: FIRST_PLAYED, original: ORIGINAL_ROW, rescored }
  };
}

/** An online table after a replayed hand: the server adds the replay record to the view once the hand is over. */
const onlineReplayResult: PreviewScreen = {
  id: "online-replay-result", title: "Online: replay result", detail: "A replayed hand at an online table has ended: every player sees the original result and, in IMPs, how the table's result compares with the deal's earlier results, from their own side.",
  build: () => {
    const data = playUntilView({ north: "Alex" }, "north", (game) => game.phase === "complete");
    if (data.kind !== "table") throw new Error("Expected a table preview.");
    const record = replayRecord(true);
    return { ...data, view: { ...data.view, replay: { firstPlayedAt: FIRST_PLAYED, rescored: true, original: ORIGINAL_ROW, record } } };
  }
};

export const soloScreens: readonly PreviewScreen[] = [
  {
    id: "solo-setup", title: "Solo: new deal", detail: "Solo play before the first hand: rubber scoring, bots as opponents, your seat, and your bots: Bold Bea as partner (14 hands together so far), Careful Cora on your left (16 hands against), and on your right Gentle Gina, a character you made yourself (3 hands against). Below them, Your characters lists her with Edit and Delete, and New character.",
    build: () => newDealWithGina()
  },
  {
    id: "solo-auction", title: "Solo: your call against bots", detail: "You are South against bots; partner opened 1♠ and East passed.",
    build: () => solo(soloGame(2), { userSeat: "south" })
  },
  {
    id: "solo-declaring", title: "Solo: declaring against bots", detail: "You are North, declarer in 4♠; you play both your hand and dummy South while the bots defend.",
    build: () => solo(soloGame(8, moment(["north", "south"], 2)), { userSeat: "north" })
  },
  {
    id: "solo-bot-declares", title: "Solo: dummy playing for a bot declarer", detail: "You are South and your bot partner Bold Bea declares 4♠ against Careful Cora and Wild Wes, each named at their seat; once dummy is down the table turns, so North's hand that you play sits at the bottom and your own lies across the table as dummy.",
    build: () => solo(soloGame(8, moment(["north", "south"], 2)), { userSeat: "south", cast: { partner: "bea", left: "cora", right: "wes" } })
  },
  {
    id: "solo-auto-play", title: "Solo: auto play", detail: "You are East and chose Auto play this hand from the menu: a bot plays your cards until this hand ends. Drag the banner anywhere; Stop auto play takes your cards back.",
    build: () => solo(soloGame(8, moment(["east"], 2)), { userSeat: "east", autoPlay: true })
  },
  {
    id: "solo-claim", title: "Solo: claiming", detail: "Declaring as North, you opened the claim picker: claim all the remaining tricks or a number; the robots check it.",
    build: () => solo(soloGame(8, (game) => game.completedTricks.length >= 6 && game.currentTrick.length === 0 && ["north", "south"].includes(game.currentActor)), { userSeat: "north", claiming: true })
  },
  {
    id: "solo-menu", title: "Solo: game menu", detail: "Mid-hand with the menu open, as at an online table: claim, take back, auto play, then settings, one-tap bidding, the rubber, recent hands, and dealing again.",
    build: () => solo(soloGame(8, moment(["north", "south"], 2)), { userSeat: "north", menuOpen: true })
  },
  {
    id: "solo-settings", title: "Solo: settings", detail: "Settings from the game menu: scoring, dealer, opponents, your seat, bot skill and style, cards fanned or in a line, hints, and forced cards.",
    build: () => solo(soloGame(8, moment(["north", "south"], 2)), { userSeat: "north", dialog: "settings" })
  },
  {
    id: "solo-hands", title: "Solo: recent hands", detail: "Recent hands from the game menu: review or export a finished hand, see your results with each named partner and against each named opponent, or import a PBN deal.",
    build: () => ({ ...solo(soloGame(8, moment(["north", "south"], 2)), { userSeat: "north", dialog: "hands" }), partnerResults: partnerHistory() })
  },
  {
    id: "solo-result", title: "Solo: hand result with scorecard", detail: "4♠ made: the whole deal face-up with each seat's calls, and the scorecard: They (East–West) have 60 below from 2♥, We (North–South) add 120 to win game 1, and the breakdown explains the hand.",
    build: () => solo(soloGame(8, (game) => game.phase === "complete"), { userSeat: "north" })
  },
  {
    id: "solo-rubber-won", title: "Solo: rubber won", detail: "We already have game 1 from 3NT; 4♠ makes game 2 and the rubber 2–0: the 700 bonus, the final score, and Play another rubber, Online tables, or Close.",
    build: () => solo(soloGame(8, (game) => game.phase === "complete", "NS"), { userSeat: "north" }, { rubber: {
      hands: [scoreRubberHand("preview-3nt", { level: 3, strain: "notrump", declarer: "south", doubled: 0 }, 9, "None", DEAL)],
      lastDealer: "north",
      activeHandId: SOLO_HAND
    } })
  },
  {
    id: "solo-review", title: "Solo: reviewing a saved hand", detail: "A finished hand opened from Recent hands, stepped to the third trick with Previous and Next.",
    build: () => solo(null, { userSeat: "north", review: { handId: "preview-saved", cursor: 8 + 10 } })
  },
  {
    id: "solo-field-result", title: "Solo: result against the field", detail: "4♠ made on board 7 of an imported club game (the status card shows Board 7 · 1 of 3): your +420 placed in the field's traveller with your matchpoint percentage, the original play one click away, and Next board.",
    build: () => solo(soloGame(8, (game) => game.phase === "complete"), { userSeat: "north" }, boardSetExtra())
  },
  {
    id: "solo-original-play", title: "Solo: viewing the original play", detail: "The same board as it was really bid and played, stepped through with Previous and Next; Back to your result returns to the comparison.",
    build: () => solo(soloGame(8, (game) => game.phase === "complete"), { userSeat: "north", viewOriginal: 8 }, boardSetExtra())
  },
  {
    id: "solo-replayed-deal", title: "Solo: replayed deal", detail: "Every second new hand may replay a deal first played at least a day ago: the notice under the status card says when it was first played and that you may have played it before. The deal looks like any other until the hand ends.",
    build: () => solo(soloGame(2), { userSeat: "south" }, { currentRecord: replayRecord(false) })
  },
  {
    id: "solo-replay-result", title: "Solo: replay result", detail: "4♠ made on a replayed deal: above the rubber scorecard, the original result (4♠ by N, 10 tricks, NS +420, 12 Nov 2026), your result in IMPs against the earlier results, and the note that they were rescored at your vulnerability.",
    build: () => solo(soloGame(8, (game) => game.phase === "complete"), { userSeat: "north" }, { currentRecord: replayRecord(true) })
  },
  onlineReplayResult
];

const authScreens: readonly PreviewScreen[] = [
  {
    id: "email-sign-in", title: "Email sign-in", detail: "The real sign-in form with a sample address, and under it what ContractPlay is for with a crossfading tour of the table; submitting in this preview never contacts the server.",
    build: () => ({ kind: "auth", sent: false })
  },
  {
    id: "email-link-sent", title: "Email link sent", detail: "The confirmation shown after requesting a sign-in link; no email is sent by this preview.",
    build: () => ({ kind: "auth", sent: true })
  }
];

/** Screens added after the sign-in ones, kept at the end so every earlier `#/mocks/N` link stays put. */
const laterScreens: readonly PreviewScreen[] = [
  {
    id: "result-waiting", title: "Online: waiting for the next deal", detail: "A hand has ended at a table of three people and a bot. You (North) and your partner Maria pressed Deal; the next hand waits until Priya (East) is ready too, so nobody's look at the result is cut short.",
    build: () => {
      const people: People = { north: "Alex", south: "Maria", east: "Priya" };
      let state = playUntil(bid(dealt(table("Friday club", people, ["west"])), 8), (game) => game.phase === "complete");
      for (const seat of ["south", "north"] as const) state = run(state, { type: "message", player: player(seat), message: { type: "deal" }, at: AT });
      return view(state, "north", people);
    }
  },
  {
    id: "solo-characters", title: "Solo: your characters", detail: "Editing Gentle Gina, a character you made: her name, description and skill, and a setting on each of six dials (openings, competing, preempts, penalty doubles, leads, second hand), each with what it means. Gina is sound and patient: she never doubles you for penalty.",
    build: () => newDealWithGina({ editingCharacter: GINA.id })
  },
  {
    id: "benchmark-lobby", title: "Open tables: a bot benchmark to watch", detail: "Open tables with a server-run bot benchmark table, marked Bot benchmark, next to a human table. All four seats are benchmark bots, so it offers Watch instead of seats, and Stop beside it, as a benchmark admin sees it. Below New duplicate session, the Bot leaderboard panel lists the top-rated bots with their bidding style (Steady Sam is a 2/1 profile, the rest SAYC) and boards (deals) and hands played, provisional ratings marked, and links to the full leaderboard.",
    build: () => {
      const playing = dealt(table("Friday club", { north: "Maria", east: "Sam", south: "Jo", west: "Priya" }));
      const rated = (id: string, rating: number, sampleBoards: number, eligible: boolean, biddingStyle: "SAYC" | "2/1" = "SAYC"): LeaderboardRating =>
        ({ competitorId: JSON.stringify([id, biddingStyle === "2/1" ? "v1-2over1" : "v1"]), rating, deviation: eligible ? 80 : 160, sampleBoards, handsPlayed: 2 * sampleBoards, eligible, biddingStyle });
      return { kind: "lobby", viewerName: "Alex", tables: [summaryOf(bid(dealt(benchmarkTable()), 3)), summaryOf(playing)],
        leaderboard: [rated("will", 1462, 32, true), rated("kim", 1581, 32, true), rated("bea", 1530, 32, true), rated("sam", 1497, 16, false, "2/1")] };
    }
  },
  {
    id: "benchmark-watch", title: "Watching a bot benchmark table", detail: "A read-only observer at a bot benchmark table mid-play: the auction and the tricks so far, every hand face-down until the duplicate board is complete, and no seating, claim, or menu controls. Seen as a benchmark admin, so Stop (which ends the whole run) is in the table tools.",
    build: () => ({ kind: "table", viewerName: "Alex", view: observerViewFor(playUntil(bid(dealt(benchmarkTable()), 8), moment(["east", "west"], 3))), observer: true })
  },
  {
    id: "auction-confirm", title: "Auction: checking a call before making it", detail: "Partner opened 1♠ and East passed; you tapped 2♠ once: it is ringed, what it tells partner shows under the bidding box, and Bid 2♠ (or a second tap) makes it. Bid with one tap in the game menu turns this off.",
    build: () => ({ ...view(bid(dealt(table("Friday club", you, others("south"))), 2), "south", you), selectedCall: "2spades" })
  }
];

/** A server-run benchmark table: four benchmark bots and the job marker the coordinator sets. */
function benchmarkTable(): TableState {
  const state = createTable({ id: "BENCH1", name: "Benchmark · round 12", style: "SAYC", listed: true, at: AT });
  const seats = Object.fromEntries(SEATS.map((seat) => [seat, { kind: "bot", skill: "advanced" } as const])) as unknown as TableState["seats"];
  return { ...state, seats, benchmark: { jobId: "preview-job", tableIndex: 0, engineVersion: "contractplay-bots-v1", boardSource: "generated",
    profiles: Object.fromEntries(SEATS.map((seat) => [seat, { profileId: `preview-${seat}`, version: "1" }])) as Record<Seat, { profileId: string; version: string }> } };
}

/** Every preview, online screens first, then solo play and account sign-in, then later additions. */
export const previewScreens: readonly PreviewScreen[] = [...onlineScreens, ...soloScreens, ...authScreens, ...laterScreens];

/**
 * The preview picker's groups, by what a screen shows rather than where it sits in the list, so `#/mocks/N` numbers
 * stay as they are. Every screen belongs to exactly one group.
 */
export const previewCategories: readonly { name: string; ids: readonly string[] }[] = [
  { name: "Lobby, seating & sign-in", ids: ["lobby", "seating", "solo-setup", "solo-characters", "email-sign-in", "email-link-sent", "benchmark-lobby"] },
  { name: "Bidding", ids: ["auction", "auction-hints", "solo-auction", "auction-confirm"] },
  { name: "Card play", ids: ["declaring", "bot-declares", "defending-left", "defending-right", "queued", "solo-declaring", "solo-bot-declares", "solo-replayed-deal", "benchmark-watch"] },
  { name: "Menus, claims & auto play", ids: ["game-menu", "auto-play", "claim-answer", "solo-auto-play", "solo-claim", "solo-menu", "solo-settings", "solo-hands"] },
  { name: "Results & scoring", ids: ["result", "rubber-score", "rubber-won", "duplicate-session", "solo-result", "solo-rubber-won", "solo-field-result", "solo-replay-result", "online-replay-result", "result-waiting"] },
  { name: "Reviewing hands", ids: ["solo-review", "solo-original-play"] }
];

function playUntilView(people: People, seat: Seat, stop: (game: GameState) => boolean): PreviewData {
  const humans = Object.keys(people) as Seat[];
  const state = playUntil(bid(dealt(table("Friday club", people, SEATS.filter((s) => !humans.includes(s)))), 8), stop);
  return view(state, seat, people);
}

/** West's own cards as the viewer sees them. */
function viewHeld(data: PreviewData): Card[] {
  if (data.kind !== "table" || !data.view.game) throw new Error("Expected a table preview with a game.");
  return [...data.view.game.hands.west];
}
