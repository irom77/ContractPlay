import { applyAction, createGameState, legalCards, RANKS, scoreRubberHand, SEATS, SUITS, type Bid, type Card, type Deal, type GameAction, type GameState, type Rank, type Rubber, type Seat } from "@contractplay/core";
import type { SavedHand, SoloData } from "@contractplay/persistence";
import type { SoloPreview } from "../App.js";
import type { TableSummary, TableView } from "@contractplay/protocol";
import type { QueuedCard } from "../table/queuedCard.js";
import { botToAct, createTable, reduce, summaryOf, viewFor, type TableEvent, type TableState } from "@contractplay/table";

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

/** A table with these humans seated in this order (the first is host), bots in `bots`, and other seats open. */
function table(name: string, people: People, bots: readonly Seat[] = []): TableState {
  let state = createTable({ id: name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6), name, style: "SAYC", listed: true, at: AT });
  for (const [seat, person] of Object.entries(people) as [Seat, string][]) {
    state = run(state, { type: "connect", player: player(seat), name: person, at: AT });
    state = run(state, { type: "message", player: player(seat), message: { type: "sit", seat }, at: AT });
  }
  const host = player(Object.keys(people)[0] as Seat);
  for (const seat of bots) state = run(state, { type: "message", player: host, message: { type: "setBot", seat, skill: "intermediate" }, at: AT });
  return state;
}

/** Starts hand 1 on the fixed deal; dealing itself is random, so the game is placed the way a deal would place it. */
function dealt(state: TableState): TableState {
  const game: GameState = createGameState({ deal: DEAL, dealer: "north", vulnerability: "None" });
  return { ...state, handNumber: 1, revision: state.revision + 1, game, turnSince: AT, lastHumanAt: AT, trickJustCompleted: false };
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
  | { kind: "lobby"; viewerName: string; tables: TableSummary[] }
  | { kind: "table"; viewerName: string; view: TableView; hints?: boolean; menuOpen?: boolean; initialQueued?: QueuedCard }
  | { kind: "solo"; data: SoloData; scoring: "rubber" | "single"; table: Omit<SoloPreview, "storage"> };

export type PreviewScreen = { id: string; title: string; detail: string; build(): PreviewData };

const view = (state: TableState, seat: Seat, people: People, hints?: boolean): PreviewData =>
  ({ kind: "table", viewerName: people[seat]!, view: viewFor(state, player(seat)), ...(hints ? { hints } : {}) });

const you: People = { south: "Alex" };
const others = (seat: Seat) => SEATS.filter((s) => s !== seat);

const onlineScreens: readonly PreviewScreen[] = [
  {
    id: "lobby", title: "Lobby", detail: "Open tables, one mid-hand and one with open seats, and the new-table form.",
    build: () => {
      const playing = dealt(table("Friday club", { north: "Maria", east: "Sam", south: "Jo", west: "Priya" }));
      const open = table("Beginners welcome", { west: "Chris" }, ["east"]);
      return { kind: "lobby", viewerName: "Alex", tables: [summaryOf(playing), summaryOf(open)] };
    }
  },
  {
    id: "seating", title: "Seating", detail: "You host at South with a human partner and a bot; West is still open, so Deal waits.",
    build: () => {
      const people: People = { south: "Alex", north: "Maria" };
      return view(table("Friday club", people, ["east"]), "south", people);
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
    id: "bot-declares", title: "Dummy playing for a bot declarer", detail: "Your bot partner declares; as dummy you see and play both North and South.",
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
    id: "game-menu", title: "Game menu", detail: "Mid-hand with the menu open: back to the lobby, take back your last card, cancel the hand, or leave.",
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
    id: "result", title: "Hand result", detail: "All 52 cards played: every hand face-up at its seat with its high-card points, and the contract, score, and Deal in the middle.",
    build: () => playUntilView({ north: "Alex" }, "north", (game) => game.phase === "complete")
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
function soloGame(calls: number, stop: (game: GameState) => boolean = () => true): GameState {
  let game = AUCTION.slice(0, calls).reduce((current, [seat, call]) => soloAct(current, { type: "bid", seat, bid: call }),
    createGameState({ deal: DEAL, dealer: "north", vulnerability: "None" }));
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

const savedHand = (): SavedHand => ({ id: "preview-saved", name: "Friday practice", game: soloGame(8, (game) => game.phase === "complete"), savedAt: new Date(AT).toISOString() });

function solo(game: GameState | null, table: Omit<SoloPreview, "storage">, extra: Partial<SoloData> = {}): PreviewData {
  return {
    kind: "solo",
    scoring: "rubber",
    table,
    data: { version: 1, currentHandId: game ? SOLO_HAND : null, currentGame: game, completedHands: [savedHand()], rubber: rubberUnderway(), ...extra }
  };
}

export const soloScreens: readonly PreviewScreen[] = [
  {
    id: "solo-setup", title: "Solo: new deal", detail: "Solo play before the first hand: rubber scoring, bots as opponents, your seat, bot skill, and bidding style.",
    build: () => solo(null, { userSeat: "south" }, { completedHands: [], rubber: { hands: [] } })
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
    id: "solo-auto-play", title: "Solo: auto play", detail: "You are East and chose Auto play: the bots play your cards until this hand ends, or until you press Stop auto play.",
    build: () => solo(soloGame(8, moment(["east"], 2)), { userSeat: "east", autoPlay: true })
  },
  {
    id: "solo-claim", title: "Solo: claiming", detail: "Declaring as North, you opened the claim picker: claim all the remaining tricks or a number; the robots check it.",
    build: () => solo(soloGame(8, (game) => game.completedTricks.length >= 6 && game.currentTrick.length === 0 && ["north", "south"].includes(game.currentActor)), { userSeat: "north", claiming: true })
  },
  {
    id: "solo-menu", title: "Solo: table menu", detail: "Mid-hand with the menu open: deal again, claim, let bots finish, next-deal settings, the rubber so far, and recent hands.",
    build: () => solo(soloGame(8, moment(["north", "south"], 2)), { userSeat: "north", menuOpen: true })
  },
  {
    id: "solo-result", title: "Solo: hand result with rubber score", detail: "4♠ made: the whole deal face-up, the rubber score for this hand, and the scoresheet so far.",
    build: () => solo(soloGame(8, (game) => game.phase === "complete"), { userSeat: "north" })
  },
  {
    id: "solo-review", title: "Solo: reviewing a saved hand", detail: "A finished hand opened from Recent hands, stepped to the third trick with Previous and Next.",
    build: () => solo(null, { userSeat: "north", review: { handId: "preview-saved", cursor: 8 + 10 } })
  }
];

/** Every preview, online screens first and then solo play. */
export const previewScreens: readonly PreviewScreen[] = [...onlineScreens, ...soloScreens];

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
