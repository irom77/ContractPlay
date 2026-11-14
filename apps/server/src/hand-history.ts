import { isSavedHand, type SavedHand } from "@contractplay/persistence";
import { authenticatedAccount, authRequestAllowed } from "./auth.js";
import { AuthStore } from "./auth-store.js";

const MAX_HAND_BYTES = 64_000;
const MAX_BODY_BYTES = 1_600_000;
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get("Content-Length");
  if (length !== null && (!Number.isSafeInteger(Number(length)) || Number(length) < 0 || Number(length) > MAX_BODY_BYTES)) throw new RangeError("body too large");
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) { await reader.cancel().catch(() => undefined); throw new RangeError("body too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return undefined; }
}

/** Uploads are personal review archives. No browser assertion can create a competitive result. */
function archive(value: unknown): SavedHand | undefined {
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_HAND_BYTES || !isSavedHand(value)
    || !/^online-[A-Za-z0-9_-]{1,100}$/.test(value.id) || !Number.isFinite(Date.parse(value.savedAt))
    || (value.name !== undefined && value.name.length > 256)) return undefined;
  // Pick known archive fields; ignore caller ownership, provenance, and tournament result assertions.
  return { id: value.id, game: value.game, savedAt: value.savedAt,
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.playerSeat === undefined ? {} : { playerSeat: value.playerSeat }),
    onlineHistory: { source: "user-imported", competitive: false } };
}

export async function handHistoryRoute(request: Request, env: Env): Promise<Response> {
  if (!authRequestAllowed(request, env)) return json({ error: "forbidden" }, 403);
  try {
    const account = await authenticatedAccount(request, env);
    if (!account) return json({ error: "unauthenticated" }, 401);
    // A different tab may have replaced the cookie after this tab captured its account.
    // This is only a stale-client guard; the session still owns every archive operation.
    if (request.headers.get("X-Expected-Player-ID") !== account.primaryPlayerId) return json({ error: "account-changed" }, 409);
    const store = new AuthStore(env.DB);
    const path = new URL(request.url).pathname.slice("/api/account/online-hands".length);
    if (request.method === "GET" && path === "") return json({ hands: (await store.listHands(account.id)).map(hand => hand.data) });
    const importing = request.method === "POST" && path === "/import";
    const updating = request.method === "PUT" && /^\/online-[A-Za-z0-9_-]{1,100}$/.test(path);
    if (!importing && !updating) return json({ error: "method-not-allowed" }, 405);
    let body: unknown;
    try { body = await readBody(request); } catch (error) { return json({ error: "payload-too-large" }, error instanceof RangeError ? 413 : 400); }
    if (!record(body)) return json({ error: "bad-request" }, 400);
    const values: unknown = importing ? body.hands : [body.hand];
    if (!Array.isArray(values) || values.length > 25) return json({ error: "bad-request" }, 400);
    const hands = values.map(archive);
    if (hands.some(hand => !hand) || (updating && hands[0]?.id !== path.slice(1))) return json({ error: "bad-request" }, 400);
    await store.upsertHands(account.id, (hands as SavedHand[]).map(hand => ({ id: hand.id, completedAt: Date.parse(hand.savedAt), data: hand })), false);
    return json({ hands: (await store.listHands(account.id)).map(hand => hand.data) });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
