// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Lobby } from "./Lobby.js";
import { loadIdentity, saveIdentity } from "./identity.js";

function setup(named = false, account = false) {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  if (named) saveIdentity(storage, "Guest");
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") return account ? Response.json({ playerId: "p1", displayName: "Account" }) : new Response(null, { status: 401 });
    if (url.startsWith("/api/account/online-hands")) return Response.json({ hands: [] });
    if (url === "/api/auth/sign-out") { account = false; return new Response(null, { status: 204 }); }
    if (url === "/api/auth/magic-link") return Response.json({ ok: true });
    throw new Error(`Unexpected request ${url} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<Lobby baseUrl="https://x.test" storage={storage} onOpenTable={vi.fn()} onPlaySolo={vi.fn()} onRecentHands={vi.fn()} api={{ listTables: async () => [], createTable: vi.fn(), createSession: vi.fn() }} />);
  return { storage, data, fetcher };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows only email sign-in while a visitor is unauthenticated", async () => {
  setup();
  expect(await screen.findByLabelText("Email sign-in")).toBeTruthy();
  expect(screen.getByLabelText("Email")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
});

it("links an existing guest without changing its stored identity", async () => {
  const { storage, data, fetcher } = setup(true);
  const before = loadIdentity(storage);
  const user = userEvent.setup();
  await screen.findByLabelText("Email sign-in");
  await user.type(screen.getByLabelText("Email"), "guest@example.com");
  await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
  expect(await screen.findByText(/check your email/i)).toBeTruthy();
  const call = fetcher.mock.calls.find(([url]) => url === "/api/auth/magic-link")!;
  expect(JSON.parse(call[1]!.body as string)).toEqual({ email: "guest@example.com", guestSecret: before!.secret, displayName: "Guest" });
  expect(call[1]!.credentials).toBe("same-origin");
  expect(loadIdentity(storage)).toEqual(before);
  expect(JSON.stringify([...data])).not.toContain("guest@example.com");
  expect(location.href).not.toContain("guest@example.com");
});

it("restores the account after callback and returns to the sign-in gate on sign-out", async () => {
  const { fetcher } = setup(true, true);
  const user = userEvent.setup();
  expect(await screen.findByText("Signed in as Account")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /^Play/, expanded: false }));
  await user.click(screen.getByRole("radio", { name: "With other people" }));
  expect((screen.getByLabelText("Table name") as HTMLInputElement).value).toBe("Account's table");
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByLabelText("Email sign-in")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Play/ })).toBeNull();
  expect(fetcher.mock.calls.find(([url]) => url === "/api/auth/sign-out")?.[1]?.credentials).toBe("same-origin");
});

it("loads and imports online history after restoring the linked account", async () => {
  const { fetcher } = setup(true, true);
  await screen.findByText("Signed in as Account");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url === "/api/account/online-hands")).toBe(true));
});
