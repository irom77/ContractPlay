import { isSavedHand, loadSoloData, saveSoloData, type SavedHand, type StorageLike } from "@contractplay/persistence";
import type { AccountSession } from "./auth.js";
import { isOnlineHand as isOnline, newestHands as newest, retainHandHistory } from "../handHistoryRetention.js";

const path = "/api/account/online-hands";
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
    || result.hands.length > 25 || !result.hands.every(hand => isSavedHand(hand) && isOnline(hand) && Number.isFinite(Date.parse(hand.savedAt)))) throw new Error("Invalid online hand history");
  return result.hands as SavedHand[];
}

function merge(storage: StorageLike, account: AccountSession, remote: readonly SavedHand[]): void {
  if (owners.get(storage) !== account.playerId) return;
  // Reload at commit time: solo play and other completed hands may have changed during the request.
  const data = loadSoloData(storage);
  const owned = (hand: SavedHand): SavedHand => ({ ...hand, onlineHistory: { source: "user-imported", competitive: false, ownerPlayerId: account.playerId } });
  const online = new Map(data.completedHands.filter(hand => isOnline(hand) && belongsTo(hand, account)).map(hand => [hand.id, owned(hand)]));
  for (const hand of remote) online.set(hand.id, owned(hand));
  const completedHands = retainHandHistory([...online.values(), ...data.completedHands.filter(hand => !isOnline(hand) || !belongsTo(hand, account))]);
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

/** Called after linking/restoring an account and whenever Recent hands opens. Solo data never leaves the device. */
export function syncOnlineHands(storage: StorageLike, account: AccountSession): Promise<void> {
  return queued(storage, account, async () => {
    let remote = await request(account);
    if (owners.get(storage) !== account.playerId) return;
    const ids = new Set(remote.map(hand => hand.id));
    const local = newest(loadSoloData(storage).completedHands.filter(hand => isOnline(hand) && belongsTo(hand, account))).slice(0, 25);
    const missing = local.filter(hand => !ids.has(hand.id));
    if (missing.length) remote = await request(account, "/import", "POST", { hands: missing });
    merge(storage, account, remote);
  });
}

/** The local save happens first; a failed upload is retried by the next history sync. */
export function uploadOnlineHand(storage: StorageLike, account: AccountSession, hand: SavedHand): Promise<void> {
  return queued(storage, account, async () => {
    if (!isOnline(hand)) return;
    merge(storage, account, await request(account, `/${encodeURIComponent(hand.id)}`, "PUT", { hand }));
  });
}
