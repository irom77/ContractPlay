import {
  applyAction,
  createDeck,
  createGameState,
  isValidDeal,
  RANKS,
  SUITS,
  type Bid,
  type Card,
  type Deal,
  type GameAction,
  type Seat,
  type Suit,
  type Vulnerability
} from "@contractplay/core";
import { exportPbn, parsePbn } from "./pbn.js";
import type { PbnBoard } from "./pbn.js";

export type LinDiagnostic = Readonly<{ severity: "error" | "warning"; message: string; record: number }>;
export type LinDocument = Readonly<{ boards: readonly PbnBoard[]; diagnostics: readonly LinDiagnostic[] }>;

type LinToken = Readonly<{ name: string; value: string }>;
type LinBoard = {
  number?: string;
  event?: string;
  dealer: Seat;
  vulnerability: Vulnerability;
  deal?: Deal;
  actions: readonly LinToken[];
};

const seatByDealerDigit: Readonly<Record<string, Seat>> = { "1": "south", "2": "west", "3": "north", "4": "east" };
const suitByLetter: Readonly<Record<string, Suit>> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };
const rankIndex = (rank: string): number => RANKS.indexOf(rank as (typeof RANKS)[number]);

function linTokens(text: string): LinToken[] {
  const tokens: LinToken[] = [];
  const tokenPattern = /([a-z]{2})\|([^|]*)\|/gi;
  for (const match of text.matchAll(tokenPattern)) tokens.push({ name: match[1]!.toLowerCase(), value: match[2]! });
  return tokens;
}

function boardNumber(value: string): string | undefined {
  return /^o(\d+)/i.exec(value.trim())?.[1];
}

function vulnerability(value: string): Vulnerability | undefined {
  return ({ o: "None", n: "NS", e: "EW", b: "Both" } as const)[value.trim().toLowerCase() as "o" | "n" | "e" | "b"];
}

function linHand(value: string): Card[] | undefined {
  const cards: Card[] = [];
  let suitIndex = -1;
  let expectedSuit = 0;
  let ranks = "";
  const flushSuit = () => {
    if (suitIndex < 0) return true;
    if (new Set(ranks).size !== ranks.length || ![...ranks].every((rank) => RANKS.includes(rank as (typeof RANKS)[number]))) return false;
    for (const rank of ranks) cards.push({ suit: SUITS[suitIndex]!, rank: rank as Card["rank"] });
    return true;
  };
  for (const char of value.toUpperCase()) {
    const nextSuit = "SHDC".indexOf(char);
    if (nextSuit !== -1) {
      if (nextSuit !== expectedSuit || !flushSuit()) return undefined;
      suitIndex = nextSuit;
      expectedSuit += 1;
      ranks = "";
    } else {
      if (suitIndex < 0 || rankIndex(char) < 0) return undefined;
      ranks += char;
    }
  }
  return expectedSuit === 4 && flushSuit() ? cards : undefined;
}

function linDeal(value: string): { dealer: Seat; deal?: Deal } | undefined {
  const dealer = seatByDealerDigit[value[0] ?? ""];
  if (!dealer) return undefined;
  const encodedHands = value.slice(1).split(",");
  if (encodedHands.length < 3 || encodedHands.length > 4) return undefined;
  const seats: readonly Seat[] = ["south", "west", "north", "east"];
  const hands = { north: [], east: [], south: [], west: [] } as Record<Seat, Card[]>;
  for (let index = 0; index < encodedHands.length; index += 1) {
    if (index === 3 && encodedHands[index] === "") continue;
    const decoded = linHand(encodedHands[index]!);
    if (!decoded) return { dealer };
    hands[seats[index]!] = decoded;
  }
  const present = new Set(Object.values(hands).flat().map((card) => `${card.suit}:${card.rank}`));
  const missing = createDeck().filter((card) => !present.has(`${card.suit}:${card.rank}`));
  if (encodedHands.length === 3) hands.east = missing;
  else if (encodedHands[3] === "") hands.east = missing;
  return { dealer, ...(isValidDeal(hands) ? { deal: hands } : {}) };
}

function linBid(value: string): Bid | undefined {
  const normalized = value.trim().replace(/[!?#]+$/g, "").toLowerCase();
  if (normalized === "p" || normalized === "pass" || normalized === "-") return "pass";
  if (normalized === "d" || normalized === "x" || normalized === "dbl") return "double";
  if (normalized === "r" || normalized === "xx" || normalized === "rdbl") return "redouble";
  const match = /^([1-7])(c|d|h|s|n|nt)$/.exec(normalized);
  if (!match) return undefined;
  const strain = ({ c: "clubs", d: "diamonds", h: "hearts", s: "spades", n: "notrump", nt: "notrump" } as const)[match[2] as "c" | "d" | "h" | "s" | "n" | "nt"];
  return `${match[1]}${strain}` as Bid;
}

function linCard(value: string): Card | undefined {
  const match = /^([SHDC])([2-9TJQKA])$/i.exec(value.trim());
  if (!match) return undefined;
  const suit = suitByLetter[match[1]!.toUpperCase()];
  const rank = match[2]!.toUpperCase();
  return suit && RANKS.includes(rank as (typeof RANKS)[number]) ? { suit, rank: rank as Card["rank"] } : undefined;
}

function recordActions(board: LinBoard): readonly GameAction[] | undefined {
  if (!board.deal) return undefined;
  let game = createGameState({ deal: board.deal, dealer: board.dealer, vulnerability: board.vulnerability });
  const actions: GameAction[] = [];
  for (const token of board.actions) {
    let action: GameAction | undefined;
    if (token.name === "mb" && game.phase === "auction") {
      const bid = linBid(token.value);
      if (bid) action = { type: "bid", seat: game.currentActor, bid };
    } else if (token.name === "pc" && game.phase === "play") {
      const card = linCard(token.value);
      if (card) action = { type: "play", seat: game.currentActor, card };
    }
    if (!action) continue;
    const result = applyAction(game, action);
    if (!result.ok) return undefined;
    actions.push(action);
    game = result.state;
  }
  return actions;
}

/**
 * Reads the common BBO LIN subset used by hand records: `md`, `qx`, `sv`, `ah`, `mb` and `pc`.
 * LIN is de facto rather than a published hand-record standard, so unknown display tokens are ignored.
 */
export function parseLin(text: string): LinDocument {
  const records: LinBoard[] = [];
  const diagnostics: LinDiagnostic[] = [];
  let pendingNumber: string | undefined;
  let pendingVulnerability: Vulnerability | undefined;
  let current: LinBoard | undefined;
  let recordNumber = 0;
  const addRecord = (value: string) => {
    recordNumber += 1;
    const parsed = linDeal(value);
    if (!parsed || !parsed.deal) {
      diagnostics.push({ severity: "error", record: recordNumber, message: "LIN record has an invalid or incomplete deal" });
      current = undefined;
      pendingNumber = undefined;
      pendingVulnerability = undefined;
      return;
    }
    current = {
      ...(pendingNumber ? { number: pendingNumber } : {}),
      dealer: parsed.dealer,
      vulnerability: pendingVulnerability ?? "None",
      deal: parsed.deal,
      actions: []
    };
    records.push(current);
    pendingNumber = undefined;
    pendingVulnerability = undefined;
  };
  const tokens = linTokens(text);
  for (const token of tokens) {
    if (token.name === "qx") {
      pendingNumber = boardNumber(token.value);
      continue;
    }
    if (token.name === "md") {
      addRecord(token.value);
      continue;
    }
    if (token.name === "sv") {
      const value = vulnerability(token.value);
      if (value) {
        if (pendingNumber !== undefined) pendingVulnerability = value;
        else if (current) current.vulnerability = value;
      }
      continue;
    }
    if (token.name === "ah") {
      const event = token.value.replace(/^Board\s+\d+\s*$/i, "").trim();
      if (event && current) current.event = event;
      continue;
    }
    if (current && ["mb", "pc"].includes(token.name)) current.actions = [...current.actions, token];
  }
  if (!recordNumber) diagnostics.push({ severity: "error", record: 0, message: "LIN file contains no deal records" });
  const validBoards: PbnBoard[] = [];
  for (const record of records) {
    if (!record.deal) continue;
    const original = recordActions(record);
    if (record.actions.length && !original) diagnostics.push({ severity: "warning", record: validBoards.length + 1, message: "LIN auction or play could not be replayed; original play was omitted" });
    const pbn = exportPbn({
      dealer: record.dealer,
      vulnerability: record.vulnerability,
      deal: record.deal,
      actions: original ?? [],
      tags: [
        ...(record.number ? [{ name: "Board", value: record.number }] : []),
        ...(record.event ? [{ name: "Event", value: record.event }] : [])
      ]
    });
    const converted = parsePbn(pbn).boards[0];
    if (converted) validBoards.push(converted);
  }
  return { boards: validBoards, diagnostics };
}
