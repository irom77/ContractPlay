import { isOwnCharacter, MAX_STORED_CHARACTERS, ownCharacterFields, type OwnCharacter } from "@contractplay/persistence";
import { authenticatedAccount, authRequestAllowed } from "./auth.js";
import { AuthStore } from "./auth-store.js";
import { readBody } from "./hand-history.js";

/** Live characters an account may hold: twice what the editor allows, so two devices that each made some offline still sync. */
export const MAX_ACCOUNT_CHARACTERS = 24;
const headers = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

const list = async (store: AuthStore, accountId: string) => json({ characters: await store.listCharacters(accountId) });

/**
 * The signed-in player's own bot characters: `GET` lists them with their deletions, `POST { characters }` adds them or
 * newer edits of them (a deletion is an edit) and answers with the full list. They are the player's own, never shared,
 * so the server checks their shape and keeps only the character's own fields.
 */
export async function charactersRoute(request: Request, env: Env): Promise<Response> {
  if (!authRequestAllowed(request, env)) return json({ error: "forbidden" }, 403);
  try {
    const account = await authenticatedAccount(request, env);
    if (!account) return json({ error: "unauthenticated" }, 401);
    if (request.headers.get("X-Expected-Player-ID") !== account.primaryPlayerId) return json({ error: "account-changed" }, 409);
    const store = new AuthStore(env.DB);
    if (new URL(request.url).pathname !== "/api/account/characters") return json({ error: "not-found" }, 404);
    if (request.method === "GET") return list(store, account.id);
    if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405);
    let body: unknown;
    try { body = await readBody(request); } catch (error) { return json({ error: "payload-too-large" }, error instanceof RangeError ? 413 : 400); }
    const values = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).characters : undefined;
    if (!Array.isArray(values) || values.length > MAX_STORED_CHARACTERS || !values.every(isOwnCharacter)) return json({ error: "bad-request" }, 400);
    const now = Date.now();
    // An edit stamped by a clock running ahead counts as made now, so it can't outrank every later edit.
    const incoming = (values as OwnCharacter[]).map((character) => ({ ...ownCharacterFields(character), updatedAt: Math.min(character.updatedAt, now),
      ...(character.playEditedAt === undefined ? {} : { playEditedAt: Math.min(character.playEditedAt, now) }) }));
    // The account's characters after this edit, the newer edit of each winning.
    const merged = new Map((await store.listCharacters(account.id)).map((character) => [character.id, character]));
    for (const character of incoming) if ((merged.get(character.id)?.updatedAt ?? -1) < character.updatedAt) merged.set(character.id, character);
    if ([...merged.values()].filter((character) => !character.deleted).length > MAX_ACCOUNT_CHARACTERS) return json({ error: "too-many-characters" }, 409);
    await store.upsertCharacters(account.id, incoming, MAX_STORED_CHARACTERS - MAX_ACCOUNT_CHARACTERS);
    return list(store, account.id);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
