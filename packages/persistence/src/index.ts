import { isValidDeal, RANKS, SEATS, SUITS, type Deal, type GameState, type Rubber, type Seat, type Suit } from "@contractplay/core";

const storageKey = "contractplay.solo";
const legacyStorageKey = "bridgelab.solo";

export type SavedHand = Readonly<{
  id: string;
  /** Display name given when the hand was played; hands saved before names existed have none. */
  name?: string;
  game: GameState;
  savedAt: string;
  pbnMetadata?: PbnMetadata;
}>;

export type PbnMetadata = Readonly<{
  tags?: readonly Readonly<{ name: string; value: string }>[];
  comments?: readonly string[];
}>;

export type SoloData = Readonly<{
  version: 1;
  currentHandId: string | null;
  currentGame: GameState | null;
  currentPbnMetadata?: PbnMetadata;
  completedHands: readonly SavedHand[];
  /** The rubber being played in rubber-bridge scoring; absent until the first rubber deal. */
  rubber?: Rubber;
}>;

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const emptyData = (): SoloData => ({ version: 1, currentHandId: null, currentGame: null, completedHands: [] });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeat(value: unknown): value is Seat {
  return SEATS.includes(value as Seat);
}

function isCard(value: unknown): boolean {
  return isRecord(value) && SUITS.includes(value.suit as Suit) && RANKS.includes(value.rank as (typeof RANKS)[number]);
}

function isDeal(value: unknown): value is Deal {
  return isRecord(value) && SEATS.every((seat) => Array.isArray(value[seat]) && value[seat].every(isCard)) && isValidDeal(value as unknown as Deal);
}

function isTrickCard(value: unknown): boolean {
  return isRecord(value) && isSeat(value.seat) && isCard(value.card);
}

function isBid(value: unknown): boolean {
  return typeof value === "string" && (value === "pass" || value === "double" || value === "redouble" || /^[1-7](clubs|diamonds|hearts|spades|notrump)$/.test(value));
}

function isPbnMetadata(value: unknown): value is PbnMetadata {
  return isRecord(value) &&
    (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) =>
      isRecord(tag) && typeof tag.name === "string" && typeof tag.value === "string"
    ))) &&
    (value.comments === undefined || (Array.isArray(value.comments) && value.comments.every((comment) => typeof comment === "string")));
}

function isGame(value: unknown): value is GameState {
  if (!isRecord(value) || !["auction", "play", "passed-out", "complete"].includes(String(value.phase))) return false;
  if (!isSeat(value.dealer) || !isSeat(value.currentActor) || !isSeat(value.trickLeader)) return false;
  if (!["None", "NS", "EW", "Both"].includes(String(value.vulnerability))) return false;
  const hands = value.hands;
  if (!isDeal(value.initialDeal) || !isRecord(hands) || !SEATS.every((seat) => Array.isArray(hands[seat]) && hands[seat].every(isCard))) return false;
  if (!Array.isArray(value.auction) || !value.auction.every((entry) => isRecord(entry) && isSeat(entry.seat) && isBid(entry.bid))) return false;
  if (!Array.isArray(value.currentTrick) || value.currentTrick.length > 3 || !value.currentTrick.every(isTrickCard)) return false;
  if (!Array.isArray(value.completedTricks) || !value.completedTricks.every((trick) => Array.isArray(trick) && trick.length === 4 && trick.every(isTrickCard))) return false;
  if (!isRecord(value.history) || !Array.isArray(value.history.actions) || !Number.isInteger(value.history.cursor) || Number(value.history.cursor) < 0 || Number(value.history.cursor) > value.history.actions.length) return false;
  if (!value.history.actions.every((action) => isRecord(action) && isSeat(action.seat) && (action.type === "bid" ? isBid(action.bid) : action.type === "play" ? isCard(action.card) : action.type === "claim" && Number.isInteger(action.tricks) && Number(action.tricks) >= 0 && Number(action.tricks) <= 13))) return false;
  if (value.contract !== undefined && (!isRecord(value.contract) || !Number.isInteger(value.contract.level) || Number(value.contract.level) < 1 || Number(value.contract.level) > 7 || !(SUITS.includes(value.contract.strain as Suit) || value.contract.strain === "notrump") || !isSeat(value.contract.declarer) || ![0, 1, 2].includes(Number(value.contract.doubled)))) return false;
  if ((value.phase === "play" || value.phase === "complete") && value.contract === undefined) return false;
  if (value.claim !== undefined && (!isRecord(value.claim) || !isSeat(value.claim.seat) || !Number.isInteger(value.claim.tricks) || Number(value.claim.tricks) < 0 || Number(value.claim.tricks) > 13)) return false;
  if (value.score !== undefined && (!isRecord(value.score) || typeof value.score.score !== "number" || typeof value.score.tricksTaken !== "number")) return false;
  if (value.phase === "complete" && value.score === undefined) return false;
  return true;
}

function isSavedHand(value: unknown): value is SavedHand {
  return isRecord(value) && typeof value.id === "string" && typeof value.savedAt === "string" && (value.name === undefined || typeof value.name === "string") && isGame(value.game) && value.game.phase === "complete" &&
    (value.pbnMetadata === undefined || isPbnMetadata(value.pbnMetadata));
}

function isSidePoints(value: unknown): boolean {
  return isRecord(value) && Number.isFinite(value.NS) && Number.isFinite(value.EW);
}

function isRubber(value: unknown): value is Rubber {
  return isRecord(value) && Array.isArray(value.hands) &&
    value.hands.every((hand) => isRecord(hand) && typeof hand.handId === "string" && isSidePoints(hand.below) && isSidePoints(hand.above)) &&
    (value.lastDealer === undefined || isSeat(value.lastDealer)) &&
    (value.activeHandId === undefined || typeof value.activeHandId === "string");
}

function normalize(value: unknown): SoloData {
  if (!isRecord(value)) return emptyData();
  if (value.version === 0) {
    return { ...emptyData(), currentGame: isGame(value.currentGame) ? value.currentGame : null };
  }
  if (value.version !== 1) return emptyData();
  const currentGame = isGame(value.currentGame) ? value.currentGame : null;
  return {
    version: 1,
    currentHandId: currentGame && typeof value.currentHandId === "string" ? value.currentHandId : null,
    currentGame,
    ...(isPbnMetadata(value.currentPbnMetadata) ? { currentPbnMetadata: value.currentPbnMetadata } : {}),
    completedHands: Array.isArray(value.completedHands) ? value.completedHands.filter(isSavedHand) : [],
    ...(isRubber(value.rubber) ? { rubber: value.rubber } : {})
  };
}

export function loadSoloData(storage: StorageLike): SoloData {
  const currentRaw = storage.getItem(storageKey);
  const raw = currentRaw ?? storage.getItem(legacyStorageKey);
  if (raw === null) return emptyData();
  try {
    const parsed: unknown = JSON.parse(raw);
    const data = normalize(parsed);
    if (currentRaw === null || (isRecord(parsed) && parsed.version !== data.version)) {
      saveSoloData(storage, data);
      if (currentRaw === null) storage.removeItem(legacyStorageKey);
    }
    return data;
  } catch {
    return emptyData();
  }
}

export function saveSoloData(storage: StorageLike, data: SoloData): void {
  storage.setItem(storageKey, JSON.stringify(data));
}

export function deleteSavedHand(storage: StorageLike, id: string): SoloData {
  const data = loadSoloData(storage);
  const updated: SoloData = { ...data, completedHands: data.completedHands.filter((hand) => hand.id !== id) };
  saveSoloData(storage, updated);
  return updated;
}

export function exportSavedHand(data: SoloData, id: string): string | undefined {
  const hand = data.completedHands.find((candidate) => candidate.id === id);
  return hand ? JSON.stringify(hand, null, 2) : undefined;
}
