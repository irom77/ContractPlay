import { botResultFields, isBotResult, MAX_BOT_RESULTS, type BotResult } from "@contractplay/persistence";
import { authenticatedAccount, authRequestAllowed } from "./auth.js";
import { AuthStore } from "./auth-store.js";
import { readBody } from "./hand-history.js";

/** Results a device may send at once: a first sync sends its newest in a few batches. */
export const MAX_BOT_RESULT_BATCH = 500;
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

const list = async (store: AuthStore, accountId: string) => json({ results: (await store.listBotResults(accountId)).map((row) => row.data) });

/**
 * The signed-in player's results with and against named bots: `GET` lists them oldest first, `POST { results }` adds or
 * replaces them by hand id and answers with the full list. They are personal records from the player's own devices,
 * never ranked or shared, so the server checks their shape and keeps only the result's own fields.
 */
export async function botResultsRoute(request: Request, env: Env): Promise<Response> {
  if (!authRequestAllowed(request, env)) return json({ error: "forbidden" }, 403);
  try {
    const account = await authenticatedAccount(request, env);
    if (!account) return json({ error: "unauthenticated" }, 401);
    if (request.headers.get("X-Expected-Player-ID") !== account.primaryPlayerId) return json({ error: "account-changed" }, 409);
    const store = new AuthStore(env.DB);
    if (new URL(request.url).pathname !== "/api/account/bot-results") return json({ error: "not-found" }, 404);
    if (request.method === "GET") return list(store, account.id);
    if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405);
    let body: unknown;
    try { body = await readBody(request); } catch (error) { return json({ error: "payload-too-large" }, error instanceof RangeError ? 413 : 400); }
    const values = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).results : undefined;
    if (!Array.isArray(values) || values.length > MAX_BOT_RESULT_BATCH || !values.every(isBotResult)) return json({ error: "bad-request" }, 400);
    const now = Date.now();
    // A result without a time sorts as sent, just before now.
    await store.upsertBotResults(account.id, (values as BotResult[]).map((result, index) => ({ id: result.handId,
      completedAt: Math.min(result.at ?? now - values.length + index, now), data: botResultFields(result) })), MAX_BOT_RESULTS);
    return list(store, account.id);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
