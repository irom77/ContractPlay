import { isSavedHand, isSyncableSoloHand, loadSoloData, saveSoloData, type SavedHand, type StorageLike } from "@contractplay/persistence";
import type { AccountSession } from "./auth.js";
import { isOnlineHand as isOnline, newestHands as newest, retainHandHistory } from "../handHistoryRetention.js";

const path = "/api/account/online-hands";
/** Hands the account keeps: online hands and dealt or replayed solo hands. */
const isAccountHand = (hand: SavedHand) => isOnline(hand) || isSyncableSoloHand(hand);
const belongsTo = (hand: SavedHand, account: AccountSession) => !hand.onlineHistory?.ownerPlayerId || hand.onlineHistory.ownerPlayerId === account.playerId;
const queues = new WeakMap<StorageLike, Promise<void>>();
const owners = new WeakMap<StorageLike, string>();

async function request(account: AccountSession, suffix = "", method = "GET", body?: unknown): Promise<SavedHand[]> {
  const response = await fetch(path + suffix, { method, credentials: "same-origin",
    headers: { "X-Expected-Player-ID": account.playerId, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error("Online hand history is unavailable");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("hands" in result) || !Array.isArray(result.hands)
    || !result.hands.every(hand => isSavedHand(hand) && isAccountHand(hand) && Number.isFinite(Date.parse(hand.savedAt)))) throw new Error("Invalid online hand history");
  const hands = result.hands as SavedHand[];
  // The account keeps at most 25 of each kind.
  if (hands.filter(isOnline).length > 25 || hands.filter(hand => !isOnline(hand)).length > 25) throw new Error("Invalid online hand history");
  return hands;
}

function merge(storage: StorageLike, account: AccountSession, remote: readonly SavedHand[]): void {
  if (owners.get(storage) !== account.playerId) return;
  // Reload at commit time: solo play and other completed hands may have changed during the request.
  const data = loadSoloData(storage);
  const owned = (hand: SavedHand): SavedHand => ({ ...hand, onlineHistory: { source: "user-imported", competitive: false, ownerPlayerId: account.playerId } });
  const mine = (hand: SavedHand) => isAccountHand(hand) && belongsTo(hand, account);
  const kept = new Map(data.completedHands.filter(mine).map(hand => [hand.id, owned(hand)]));
  for (const hand of remote) kept.set(hand.id, owned(hand));
  const completedHands = retainHandHistory([...kept.values(), ...data.completedHands.filter(hand => !mine(hand))]);
  saveSoloData(storage, { ...data, completedHands });
}

function queued(storage: StorageLike, account: AccountSession, work: () => Promise<void>): Promise<void> {
  owners.set(storage, account.playerId);
  const pending = (queues.get(storage) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (owners.get(storage) === account.playerId) await work();
  });
  queues.set(storage, pending);
  return pending;
}

/** Called after linking/restoring an account and whenever Recent hands opens. Of solo data, only dealt or replayed finished hands leave the device. */
export function syncOnlineHands(storage: StorageLike, account: AccountSession): Promise<void> {
  return queued(storage, account, async () => {
    let remote = await request(account);
    if (owners.get(storage) !== account.playerId) return;
    const ids = new Set(remote.map(hand => hand.id));
    const local = loadSoloData(storage).completedHands.filter(hand => belongsTo(hand, account) && !ids.has(hand.id));
    // Each kind goes in its own import, as the account keeps 25 of each.
    for (const kind of [isOnline, isSyncableSoloHand]) {
      const missing = newest(local.filter(kind)).slice(0, 25);
      if (missing.length) remote = await request(account, "/import", "POST", { hands: missing });
    }
    merge(storage, account, remote);
  });
}

function upload(storage: StorageLike, account: AccountSession, hand: SavedHand): Promise<void> {
  return queued(storage, account, async () => {
    merge(storage, account, await request(account, `/${encodeURIComponent(hand.id)}`, "PUT", { hand }));
  });
}

/** The local save happens first; a failed upload is retried by the next history sync. */
export function uploadOnlineHand(storage: StorageLike, account: AccountSession, hand: SavedHand): Promise<void> {
  return isOnline(hand) ? upload(storage, account, hand) : Promise.resolve();
}

/** Saves a finished solo hand to the account unless it came from an imported file or board set; failures retry on the next sync. */
export function uploadSoloHand(storage: StorageLike, account: AccountSession, hand: SavedHand): Promise<void> {
  return isSyncableSoloHand(hand) ? upload(storage, account, hand) : Promise.resolve();
}
