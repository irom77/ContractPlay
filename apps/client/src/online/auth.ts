export type AccountSession = { playerId: string; displayName: string };

export async function requestMagicLink(email: string, guestSecret?: string, displayName?: string): Promise<void> {
  const response = await fetch("/api/auth/magic-link", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, ...(guestSecret ? { guestSecret } : {}), ...(displayName ? { displayName } : {}) })
  });
  if (!response.ok) throw new Error("Sign-in request failed");
}

export async function currentAccount(): Promise<AccountSession | null> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Session lookup failed");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new Error("Invalid session");
  const { playerId, displayName } = data as Record<string, unknown>;
  if (typeof playerId !== "string" || typeof displayName !== "string") throw new Error("Invalid session");
  return { playerId, displayName };
}

export async function signOut(): Promise<void> {
  const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("Sign-out failed");
}
