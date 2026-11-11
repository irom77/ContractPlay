import type { StorageLike } from "@contractplay/persistence";

export type Identity = { secret: string; name: string };

const storageKey = "contractplay.online";

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function loadIdentity(storage: StorageLike): Identity | undefined {
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return undefined;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return undefined;
    const { secret, name } = data as Record<string, unknown>;
    return typeof secret === "string" && secret !== "" && typeof name === "string" ? { secret, name } : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps an existing secret so the player keeps their seat; only the display name changes. */
export function saveIdentity(storage: StorageLike, name: string): Identity {
  const identity = { secret: loadIdentity(storage)?.secret ?? newSecret(), name };
  storage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}
