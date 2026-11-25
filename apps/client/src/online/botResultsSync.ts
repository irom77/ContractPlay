import { botResultFields, isBotResult, MAX_BOT_RESULTS, type BotResult, type StorageLike } from "@contractplay/persistence";
import { loadPartnerResults, savePartnerResults } from "../partnerResults.js";
import type { AccountSession } from "./auth.js";

const path = "/api/account/bot-results";
/** The most results the service takes in one request. */
const BATCH = 500;
const queues = new WeakMap<StorageLike, Promise<unknown>>();

async function request(account: AccountSession, body?: { results: readonly BotResult[] }): Promise<BotResult[]> {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin",
    headers: { "X-Expected-Player-ID": account.playerId, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error("Bot results are unavailable");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("results" in result) || !Array.isArray(result.results)
    || result.results.length > MAX_BOT_RESULTS || !result.results.every(isBotResult)) throw new Error("Invalid bot results");
  return result.results as BotResult[];
}

/** This account's results, or ones recorded on this device before any account synced them. */
const belongsTo = (result: BotResult, account: AccountSession) => result.owner === undefined || result.owner === account.playerId;

/** Keeps the account's results (tagged as its own) with this device's results for other accounts, reloaded at commit time. */
function merge(storage: StorageLike, account: AccountSession, remote: readonly BotResult[]): BotResult[] {
  const others = loadPartnerResults(storage).filter((result) => !belongsTo(result, account));
  const local = loadPartnerResults(storage).filter((result) => belongsTo(result, account) && !remote.some((entry) => entry.handId === result.handId));
  // Results recorded while the request was out stay, to go up with the next sync.
  return savePartnerResults(storage, [...others, ...remote.map((result) => ({ ...result, owner: account.playerId })), ...local]);
}

function queued<T>(storage: StorageLike, work: () => Promise<T>): Promise<T> {
  const pending = (queues.get(storage) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(storage, pending);
  return pending;
}

/**
 * Brings this device's results with named bots and the account's together: sends the ones the account lacks (or holds an
 * older finish of), then keeps the account's list. Called with the online hand history sync; returns the results now on the device.
 */
export function syncBotResults(storage: StorageLike, account: AccountSession): Promise<BotResult[]> {
  return queued(storage, async () => {
    let remote = await request(account);
    const known = new Map(remote.map((result) => [result.handId, result]));
    const missing = loadPartnerResults(storage).filter((result) => belongsTo(result, account) &&
      (!known.has(result.handId) || (result.at ?? -1) > (known.get(result.handId)!.at ?? -1)))
      .slice(-MAX_BOT_RESULTS).map(botResultFields);
    for (let start = 0; start < missing.length; start += BATCH) remote = await request(account, { results: missing.slice(start, start + BATCH) });
    return merge(storage, account, remote);
  });
}

/** Sends one newly recorded result; the local copy is already saved, and a failure is retried by the next sync. */
export function uploadBotResult(storage: StorageLike, account: AccountSession, result: BotResult): Promise<BotResult[]> {
  return queued(storage, async () => merge(storage, account, await request(account, { results: [botResultFields(result)] })));
}
