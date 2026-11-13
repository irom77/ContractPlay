import { RANKS, SEATS, SUITS } from "@contractplay/core";
import type { Card, Deal, GameAction, GameState, Rubber, Seat, SkillLevel } from "@contractplay/core";

export const PROTOCOL_VERSION = 4;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_PLAYER_NAME = 20;
export const MAX_TABLE_NAME = 40;
export type TableStyle = "SAYC" | "2/1";
/** How a table scores: rubber bridge (the default for new tables), or running duplicate-style totals (tables made before rubbers). */
export type TableScoring = "rubber" | "duplicate";
export const TABLE_SCORINGS: readonly TableScoring[] = ["rubber", "duplicate"];

export type SeatInfo =
  | { kind: "empty" }
  | { kind: "bot"; skill: SkillLevel }
  | { kind: "human"; name: string; away: boolean; standIn?: SkillLevel;
    /** The player asked a bot to play their cards for the rest of this hand; they get the seat back when it ends. */
    autoPlay?: true };

export type TableSummary = { id: string; name: string; style: TableStyle; scoring: TableScoring; seats: Record<Seat, SeatInfo>; handInProgress: boolean };

/** GameState without history or the original deal; hands the viewer may not see are empty arrays. */
export type PublicGame = Pick<GameState, "phase" | "dealer" | "vulnerability" | "currentActor" | "auction" | "contract" | "hands" | "currentTrick" | "completedTricks" | "score" | "trickLeader" | "claim">;

export type TableView = TableSummary & {
  /** `revision` is the staleness token to send with `act`, not a change counter: views can differ at the same revision, so never dedupe views by it. */
  listed: boolean; revision: number; handNumber: number;
  /** Running totals at a duplicate-scored table; a rubber table keeps its score in `rubber`. */
  totals: { ns: number; ew: number };
  /** A rubber table's rubber: the hands scored so far, with the hand being played for it. */
  rubber?: Rubber;
  host?: Seat; yourSeat?: Seat; canDeal: boolean;
  game?: PublicGame;
  revealed?: Deal;
  /**
   * A claim waiting for answers: `seat` is the claiming side's seat (declarer for the declaring side), `waitingOn`
   * the seats yet to accept. `madeAt` identifies the claim: send it as `claimId` with `answerClaim`.
   */
  claim?: { seat: Seat; tricks: number; waitingOn: Seat[]; madeAt: number };
  /** The last claim, rejected by `by`; shown until the next card or call. */
  claimRejected?: { seat: Seat; tricks: number; by: Seat };
};

export type ClientMessage =
  | { type: "hello"; version: number; secret: string; name: string }
  | { type: "sit"; seat: Seat } | { type: "leave" }
  | { type: "setBot"; seat: Seat; skill: SkillLevel }
  | { type: "clearSeat"; seat: Seat }
  | { type: "deal" }
  | { type: "act"; handNumber: number; revision: number; action: GameAction }
  | { type: "handToBot"; seat: Seat } | { type: "resume" } | { type: "autoPlay" }
  | { type: "takeBack" } | { type: "cancelHand" }
  | { type: "claim"; tricks: number } | { type: "answerClaim"; accept: boolean; claimId: number } | { type: "withdrawClaim" };

export type RefusalReason = "bad-message" | "not-seated" | "seat-taken" | "already-seated" | "not-allowed" | "hand-in-progress" | "not-ready" | "stale" | "not-your-turn" | "illegal";

export type ServerMessage =
  | { type: "view"; view: TableView }
  | { type: "refused"; reason: RefusalReason; view: TableView }
  | { type: "reload" }
  | { type: "gone" };

const SKILLS: readonly string[] = ["beginner", "intermediate", "advanced", "expert"];
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;
const BID = /^(pass|double|redouble|[1-7](clubs|diamonds|hearts|spades|notrump))$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/** Unicode format characters: zero-width spaces and joiners, bidirectional overrides and the like. */
const FORMAT = /\p{Cf}/gu;
/** A surrogate half not paired with its partner (with the u flag, paired halves match as one code point). */
const LONE_SURROGATE = /\p{Cs}/u;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const seatOf = (v: unknown): Seat | undefined => (SEATS as readonly unknown[]).includes(v) ? (v as Seat) : undefined;
const skillOf = (v: unknown): SkillLevel | undefined => SKILLS.includes(v as string) ? (v as SkillLevel) : undefined;
const count = (v: unknown): number | undefined => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

/**
 * Removes format characters (zero-width and bidi controls), replaces control characters with spaces,
 * collapses whitespace and trims; undefined when not well-formed Unicode, empty, or longer than max.
 */
export function cleanName(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return undefined;
  const name = value.replace(FORMAT, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return name.length === 0 || [...name].length > max ? undefined : name;
}

function parseCard(v: unknown): Card | undefined {
  if (!isRecord(v)) return undefined;
  const { suit, rank } = v;
  if (!(SUITS as readonly unknown[]).includes(suit) || !(RANKS as readonly unknown[]).includes(rank)) return undefined;
  return { suit, rank } as Card;
}

function parseAction(v: unknown): GameAction | undefined {
  if (!isRecord(v)) return undefined;
  const seat = seatOf(v.seat);
  if (!seat) return undefined;
  if (v.type === "bid") return typeof v.bid === "string" && BID.test(v.bid) ? ({ type: "bid", seat, bid: v.bid } as GameAction) : undefined;
  if (v.type === "play") {
    const card = parseCard(v.card);
    return card ? { type: "play", seat, card } : undefined;
  }
  return undefined;
}

export function parseClientMessage(raw: string): ClientMessage | undefined {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) return undefined;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return undefined; }
  if (!isRecord(data)) return undefined;
  switch (data.type) {
    case "hello": {
      const name = cleanName(data.name, MAX_PLAYER_NAME);
      if (typeof data.version !== "number" || typeof data.secret !== "string" || !SECRET.test(data.secret) || name === undefined) return undefined;
      return { type: "hello", version: data.version, secret: data.secret, name };
    }
    case "sit": case "clearSeat": case "handToBot": {
      const seat = seatOf(data.seat);
      return seat ? { type: data.type, seat } : undefined;
    }
    case "setBot": {
      const seat = seatOf(data.seat), skill = skillOf(data.skill);
      return seat && skill ? { type: "setBot", seat, skill } : undefined;
    }
    case "leave": case "deal": case "resume": case "autoPlay": case "takeBack": case "cancelHand": case "withdrawClaim": return { type: data.type };
    case "claim": {
      const tricks = count(data.tricks);
      return tricks !== undefined && tricks <= 13 ? { type: "claim", tricks } : undefined;
    }
    case "answerClaim": {
      const claimId = count(data.claimId);
      return typeof data.accept === "boolean" && claimId !== undefined ? { type: "answerClaim", accept: data.accept, claimId } : undefined;
    }
    case "act": {
      const handNumber = count(data.handNumber), revision = count(data.revision), action = parseAction(data.action);
      return handNumber !== undefined && revision !== undefined && action ? { type: "act", handNumber, revision, action } : undefined;
    }
    default: return undefined;
  }
}
