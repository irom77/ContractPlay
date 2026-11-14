import { isValidDeal, RANKS, SEATS, SUITS, type Deal, type GameAction, type GameState, type HandRecord, type Rubber, type Seat, type Suit, type TravellerRow, MAX_MULTIPLICITY } from "@contractplay/core";

const storageKey = "contractplay.solo";
const legacyStorageKey = "bridgelab.solo";

export type SavedHand = Readonly<{
  id: string;
  /** Display name given when the hand was played; hands saved before names existed have none. */
  name?: string;
  /** Seat used for this saved attempt, so field comparisons remain stable when settings change. */
  playerSeat?: Seat;
  game: GameState;
  savedAt: string;
  pbnMetadata?: PbnMetadata;
  /** The imported board this hand was played on, when it came from a board set. */
  record?: HandRecord;
}>;

/** An imported PBN file's boards; `position` is the index of the board being played. */
export type BoardSet = Readonly<{ id?: string; name: string; records: readonly HandRecord[]; position: number }>;

/** A set kept in Recent hands; progress is the number of boards already completed. */
export type BoardSetLibraryEntry = Readonly<{ id: string; name: string; records: readonly HandRecord[]; progress: number; completed: boolean }>;
export const MAX_BOARD_SET_LIBRARY_ENTRIES = 8;
/** Leave room in localStorage for current play, completed hands, and app settings. */
export const MAX_BOARD_SET_LIBRARY_CHARS = 1_500_000;

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
  boardSet?: BoardSet;
  boardSetLibrary?: readonly BoardSetLibraryEntry[];
  currentRecord?: HandRecord;
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

function isAction(action: unknown): action is GameAction {
  return isRecord(action) && isSeat(action.seat) && (action.type === "bid" ? isBid(action.bid) : action.type === "play" ? isCard(action.card) : action.type === "claim" && Number.isInteger(action.tricks) && Number(action.tricks) >= 0 && Number(action.tricks) <= 13);
}

function isTravellerRow(value: unknown): value is TravellerRow {
  return isRecord(value) && Number.isInteger(value.multiplicity) && Number(value.multiplicity) >= 1 && Number(value.multiplicity) <= MAX_MULTIPLICITY && typeof value.artificial === "boolean" &&
    (value.nsScore === undefined || Number.isFinite(value.nsScore)) &&
    (value.contract === undefined || typeof value.contract === "string") &&
    (value.declarer === undefined || isSeat(value.declarer)) &&
    (value.tricks === undefined || (Number.isInteger(value.tricks) && Number(value.tricks) >= 0 && Number(value.tricks) <= 13));
}

function isHandRecord(value: unknown): value is HandRecord {
  return isRecord(value) && isSeat(value.dealer) && ["None", "NS", "EW", "Both"].includes(String(value.vulnerability)) && isDeal(value.deal) &&
    (value.board === undefined || typeof value.board === "string") &&
    (value.event === undefined || typeof value.event === "string") &&
    (value.scoring === undefined || typeof value.scoring === "string") &&
    (value.expectedFieldCount === undefined || (Number.isInteger(value.expectedFieldCount) && Number(value.expectedFieldCount) >= 0)) &&
    (value.doubleDummyPar === undefined || Number.isInteger(value.doubleDummyPar)) &&
    (value.original === undefined || (Array.isArray(value.original) && value.original.every(isAction))) &&
    Array.isArray(value.field) && value.field.every(isTravellerRow);
}

function isBoardSet(value: unknown): value is BoardSet {
  return isRecord(value) && (value.id === undefined || typeof value.id === "string") && typeof value.name === "string" && Array.isArray(value.records) && value.records.length > 0 && value.records.every(isHandRecord) &&
    Number.isInteger(value.position) && Number(value.position) >= 0 && Number(value.position) < value.records.length;
}

function isBoardSetLibraryEntry(value: unknown): value is BoardSetLibraryEntry {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && Array.isArray(value.records) && value.records.length > 0 && value.records.every(isHandRecord) &&
    Number.isInteger(value.progress) && Number(value.progress) >= 0 && Number(value.progress) <= value.records.length && typeof value.completed === "boolean";
}

function withinBoardSetLibraryLimits(entries: readonly BoardSetLibraryEntry[]): readonly BoardSetLibraryEntry[] {
  const kept: BoardSetLibraryEntry[] = [];
  for (const entry of entries) {
    if (kept.length >= MAX_BOARD_SET_LIBRARY_ENTRIES) break;
    const candidate = [...kept, entry];
    if (JSON.stringify(candidate).length > MAX_BOARD_SET_LIBRARY_CHARS) break;
    kept.push(entry);
  }
  return kept;
}

/** Portable JSON is deliberately limited to hand records, never stored player names. */
export function serializeBoardSetBackup(entry: BoardSetLibraryEntry): string {
  return JSON.stringify({ format: "ContractPlay board set", version: 1, boardSet: entry }, null, 2);
}

export function parseBoardSetBackup(text: string): BoardSetLibraryEntry | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value) && value.format === "ContractPlay board set" && value.version === 1 && isBoardSetLibraryEntry(value.boardSet)) return value.boardSet;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Add or update the most recently used set within the per-browser library limit. */
export function upsertBoardSetLibrary(
  entries: readonly BoardSetLibraryEntry[],
  entry: BoardSetLibraryEntry
): { entries: readonly BoardSetLibraryEntry[]; stored: boolean } {
  const updated = withinBoardSetLibraryLimits([entry, ...entries.filter((candidate) => candidate.id !== entry.id)]);
  return { entries: updated, stored: updated.some((candidate) => candidate.id === entry.id) };
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
  if (!value.history.actions.every(isAction)) return false;
  if (value.contract !== undefined && (!isRecord(value.contract) || !Number.isInteger(value.contract.level) || Number(value.contract.level) < 1 || Number(value.contract.level) > 7 || !(SUITS.includes(value.contract.strain as Suit) || value.contract.strain === "notrump") || !isSeat(value.contract.declarer) || ![0, 1, 2].includes(Number(value.contract.doubled)))) return false;
  if ((value.phase === "play" || value.phase === "complete") && value.contract === undefined) return false;
  if (value.claim !== undefined && (!isRecord(value.claim) || !isSeat(value.claim.seat) || !Number.isInteger(value.claim.tricks) || Number(value.claim.tricks) < 0 || Number(value.claim.tricks) > 13)) return false;
  if (value.score !== undefined && (!isRecord(value.score) || typeof value.score.score !== "number" || typeof value.score.tricksTaken !== "number")) return false;
  if (value.phase === "complete" && value.score === undefined) return false;
  return true;
}

function isSavedHand(value: unknown): value is SavedHand {
  return isRecord(value) && typeof value.id === "string" && typeof value.savedAt === "string" && (value.name === undefined || typeof value.name === "string") && isGame(value.game) && value.game.phase === "complete" &&
    (value.pbnMetadata === undefined || isPbnMetadata(value.pbnMetadata)) && (value.playerSeat === undefined || isSeat(value.playerSeat));
}

/** A saved hand with a malformed board record dropped; the hand itself stays. */
function cleanSavedHand(hand: SavedHand): SavedHand {
  if (hand.record === undefined || isHandRecord(hand.record)) return hand;
  return { id: hand.id, ...(hand.name === undefined ? {} : { name: hand.name }), ...(hand.playerSeat === undefined ? {} : { playerSeat: hand.playerSeat }), game: hand.game, savedAt: hand.savedAt, ...(hand.pbnMetadata === undefined ? {} : { pbnMetadata: hand.pbnMetadata }) };
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

const isScoreItem = (item: unknown): boolean => isRecord(item) && (item.side === "NS" || item.side === "EW") &&
  (item.line === "above" || item.line === "below") && typeof item.kind === "string" && Number.isFinite(item.points);

function isHandDetail(detail: unknown): boolean {
  return isRecord(detail) && isRecord(detail.contract) && isSeat(detail.contract.declarer) && Number.isInteger(detail.contract.level) &&
    typeof detail.contract.strain === "string" && Number.isInteger(detail.tricksTaken) && typeof detail.vulnerable === "boolean" &&
    Array.isArray(detail.items) && detail.items.every(isScoreItem);
}

/** A rubber with any malformed hand breakdown dropped; the hand's points stay on the scorecard. */
function cleanRubber(rubber: Rubber): Rubber {
  return { ...rubber, hands: rubber.hands.map((hand) => {
    if (hand.detail === undefined || isHandDetail(hand.detail)) return hand;
    return { handId: hand.handId, below: hand.below, above: hand.above };
  }) };
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
    completedHands: Array.isArray(value.completedHands) ? value.completedHands.filter(isSavedHand).map(cleanSavedHand) : [],
    ...(isRubber(value.rubber) ? { rubber: cleanRubber(value.rubber) } : {}),
    ...(isBoardSet(value.boardSet) ? { boardSet: value.boardSet } : {}),
    ...(Array.isArray(value.boardSetLibrary) ? { boardSetLibrary: withinBoardSetLibraryLimits(value.boardSetLibrary.filter(isBoardSetLibraryEntry)) } : {}),
    ...(isHandRecord(value.currentRecord) ? { currentRecord: value.currentRecord } : {})
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
  try {
    storage.setItem(storageKey, JSON.stringify(data));
  } catch {
    // A full or unavailable store must not break the app; the game carries on unsaved.
  }
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
