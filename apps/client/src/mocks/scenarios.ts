import { createGameState, legalCards, RANKS, SEATS, SUITS, type Bid, type Card, type Deal, type GameAction, type GameState, type Rank, type Seat } from "@contractplay/core";
import type { TableSummary, TableView } from "@contractplay/protocol";
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
  | { kind: "table"; viewerName: string; view: TableView; hints?: boolean };

export type PreviewScreen = { id: string; title: string; detail: string; build(): PreviewData };

const view = (state: TableState, seat: Seat, people: People, hints?: boolean): PreviewData =>
  ({ kind: "table", viewerName: people[seat]!, view: viewFor(state, player(seat)), ...(hints ? { hints } : {}) });

const you: People = { south: "Alex" };
const others = (seat: Seat) => SEATS.filter((s) => s !== seat);

export const previewScreens: readonly PreviewScreen[] = [
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
    id: "result", title: "Hand result", detail: "All 52 cards played: the contract, the score, and every hand revealed.",
    build: () => playUntilView({ north: "Alex" }, "north", (game) => game.phase === "complete")
  }
];

function playUntilView(people: People, seat: Seat, stop: (game: GameState) => boolean): PreviewData {
  const humans = Object.keys(people) as Seat[];
  const state = playUntil(bid(dealt(table("Friday club", people, SEATS.filter((s) => !humans.includes(s)))), 8), stop);
  return view(state, seat, people);
}
