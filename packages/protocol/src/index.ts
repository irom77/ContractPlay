import { botCharacter, cleanName, isBotTraits, isOwnCharacterId, MAX_CHARACTER_NAME, RANKS, SEATS, SUITS } from "@contractplay/core";
export { cleanName } from "@contractplay/core";
import type { Aggression, BotTraits, Card, Deal, GameAction, GameState, HandRecord, Rubber, Seat, SkillLevel, TravellerRow } from "@contractplay/core";

export const PROTOCOL_VERSION = 8;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_PLAYER_NAME = 20;
export const MAX_TABLE_NAME = 40;
export type TableStyle = "SAYC" | "2/1";
/** How a table scores: rubber bridge (the default for new tables), or running duplicate-style totals (tables made before rubbers). */
export type TableScoring = "rubber" | "duplicate";
export const TABLE_SCORINGS: readonly TableScoring[] = ["rubber", "duplicate"];

export type SeatInfo =
  | { kind: "empty" }
  /** `character`: a named bot from the cast, playing at its own skill and aggressiveness rather than the table's. */
  | { kind: "bot"; skill: SkillLevel; character?: string; custom?: { id?: string; name: string; traits: BotTraits } }
  | { kind: "human"; name: string; away: boolean; standIn?: SkillLevel;
    /** The player asked a bot to play their cards for the rest of this hand; they get the seat back when it ends. */
    autoPlay?: true };

/** `aggression`: how every bot and stand-in at the table bids and plays; missing from servers that predate it, and then Normal. */
export type TableSummary = { id: string; benchmark?: true; name: string; style: TableStyle; scoring: TableScoring; aggression?: Aggression; seats: Record<Seat, SeatInfo>; handInProgress: boolean };

/** GameState without history or the original deal; hands the viewer may not see are empty arrays. */
export type PublicGame = Pick<GameState, "phase" | "dealer" | "vulnerability" | "currentActor" | "auction" | "contract" | "hands" | "currentTrick" | "completedTricks" | "score" | "trickLeader" | "claim">;

export type TableView = TableSummary & {
  /** `revision` is the staleness token to send with `act`, not a change counter: views can differ at the same revision, so never dedupe views by it. */
  listed: boolean; revision: number; handNumber: number;
  /** Running totals at a duplicate-scored table; a rubber table keeps its score in `rubber`. */
  totals: { ns: number; ew: number };
  /** A rubber table's rubber: the hands scored so far, with the hand being played for it. */
  rubber?: Rubber;
  /**
   * `canDeal`: the viewer may send `deal`. After a hand has been played, `deal` confirms the viewer is ready and the
   * next hand is dealt once every present human has; `nextHand` lists the seats that have confirmed and those still awaited.
   */
  host?: Seat; yourSeat?: Seat; canDeal: boolean;
  nextHand?: { ready: Seat[]; waitingOn: Seat[] };
  game?: PublicGame;
  revealed?: Deal;
  /**
   * A claim waiting for answers: `seat` is the claiming side's seat (declarer for the declaring side), `waitingOn`
   * the seats yet to accept. `madeAt` identifies the claim: send it as `claimId` with `answerClaim`.
   */
  claim?: { seat: Seat; tricks: number; waitingOn: Seat[]; madeAt: number };
  /** The last claim, rejected by `by`; shown until the next card or call. */
  claimRejected?: { seat: Seat; tricks: number; by: Seat };
  /** Progress and this table's standing in a duplicate session. Contains no board or other table's result data. */
  session?: { board: number; position: number; boardCount: number; scoring: "matchpoints" | "imps"; completedBoards: number;
    complete: boolean; waitingForTables: boolean; rank: number; tableCount: number;
    matchpoints: { points: number; top: number; percentage: number }; crossImps: number };
  /**
   * Present while the hand is a replayed archived deal, for every viewer, with when it was first played. Only once the
   * hand is over: its first result (`original`), whether earlier results were rescored at this table's vulnerability,
   * and `record` (earlier results, without the original play's actions).
   */
  replay?: { firstPlayedAt: number; rescored?: boolean; original?: TravellerRow; record?: HandRecord };
};

export type ClientMessage =
  // expectedPlayerId only guards a captured account against a changed cookie; the server verifies identity.
  | { type: "hello"; version: number; secret?: string; expectedPlayerId?: string; name: string }
  | { type: "sit"; seat: Seat } | { type: "leave" } | { type: "refresh" }
  /** With `character` or `custom`, the seat gets that bot and its skill (the sent `skill` is ignored). */
  | { type: "setBot"; seat: Seat; skill: SkillLevel; character?: string; custom?: CustomBot }
  | { type: "clearSeat"; seat: Seat }
  | { type: "deal" }
  | { type: "act"; handNumber: number; revision: number; action: GameAction }
  | { type: "handToBot"; seat: Seat } | { type: "resume" } | { type: "autoPlay" }
  | { type: "takeBack" } | { type: "cancelHand" }
  | { type: "claim"; tricks: number } | { type: "answerClaim"; accept: boolean; claimId: number } | { type: "withdrawClaim" };

export type CustomBot = { id: string; name: string; skill: SkillLevel; traits: BotTraits };

export type RefusalReason = "bad-message" | "not-seated" | "seat-taken" | "already-seated" | "not-allowed" | "hand-in-progress" | "not-ready" | "stale" | "not-your-turn" | "illegal";

export type ServerMessage =
  | { type: "view"; view: TableView }
  | { type: "refused"; reason: RefusalReason; view: TableView }
  | { type: "reload" }
  | { type: "gone" }
  | { type: "identity-conflict" }
  | { type: "account-changed" };

const SKILLS: readonly string[] = ["beginner", "intermediate", "advanced", "expert"];
const SECRET = /^[A-Za-z0-9_-]{32,128}$/;
const BID = /^(pass|double|redouble|[1-7](clubs|diamonds|hearts|spades|notrump))$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const seatOf = (v: unknown): Seat | undefined => (SEATS as readonly unknown[]).includes(v) ? (v as Seat) : undefined;
const skillOf = (v: unknown): SkillLevel | undefined => SKILLS.includes(v as string) ? (v as SkillLevel) : undefined;
const count = (v: unknown): number | undefined => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

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
      if (typeof data.version !== "number" || (data.secret !== undefined && (typeof data.secret !== "string" || !SECRET.test(data.secret))) || name === undefined) return undefined;
      if (data.expectedPlayerId !== undefined && (typeof data.expectedPlayerId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.expectedPlayerId))) return undefined;
      return { type: "hello", version: data.version, ...(typeof data.secret === "string" ? { secret: data.secret } : {}),
        ...(typeof data.expectedPlayerId === "string" ? { expectedPlayerId: data.expectedPlayerId } : {}), name };
    }
    case "sit": case "clearSeat": case "handToBot": {
      const seat = seatOf(data.seat);
      return seat ? { type: data.type, seat } : undefined;
    }
    case "setBot": {
      const seat = seatOf(data.seat), skill = skillOf(data.skill);
      if (!seat || !skill) return undefined;
      if (data.custom !== undefined) {
        if (data.character !== undefined || !isRecord(data.custom) || !isOwnCharacterId(data.custom.id)) return undefined;
        const name = cleanName(data.custom.name, MAX_CHARACTER_NAME), customSkill = skillOf(data.custom.skill);
        if (name === undefined || !customSkill || !isBotTraits(data.custom.traits)) return undefined;
        const traits = Object.fromEntries(Object.entries(data.custom.traits)) as BotTraits;
        return { type: "setBot", seat, skill: customSkill, custom: { id: data.custom.id, name, skill: customSkill, traits } };
      }
      if (data.character === undefined) return { type: "setBot", seat, skill };
      const character = typeof data.character === "string" ? botCharacter(data.character) : undefined;
      return character ? { type: "setBot", seat, skill: character.skill, character: character.id } : undefined;
    }
    case "leave": case "refresh": case "deal": case "resume": case "autoPlay": case "takeBack": case "cancelHand": case "withdrawClaim": return { type: data.type };
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
