// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Root from "./Root.js";

const service = vi.hoisted(() => ({ url: "https://x.test" as string | undefined }));
vi.mock("./online/connection.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./online/connection.js")>()),
  serviceUrl: () => service.url
}));

beforeEach(() => {
  service.url = "https://x.test";
  window.localStorage.clear();
  history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = input.toString();
    if (url === "/api/auth/me") return Promise.resolve(Response.json({ playerId: "root-player", displayName: "Bob" }));
    if (url.startsWith("/api/account/online-hands")) return Promise.resolve(Response.json({ hands: [] }));
    return Promise.resolve(new Response("[]"));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

const soloVisible = () => screen.queryByRole("button", { name: "Start a new hand" }) !== null;

describe("Root", () => {
  it("renders the online lobby at the bare deployment URL", async () => {
    render(<Root />);
    expect(await screen.findByText("Open tables")).toBeTruthy();
  });

  it("renders the lobby for #/online and starts solo from Play", async () => {
    const { loadSoloData } = await import("@contractplay/persistence");
    location.hash = "#/online";
    render(<Root />);
    expect(await screen.findByText("Open tables")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Play" }));
    expect(location.hash).toBe("#/solo");
    await vi.waitFor(() => expect(loadSoloData(window.localStorage).handsStarted).toBe(1));
    expect(soloVisible()).toBe(false);
  });

  it("does not deal again when solo is reopened later", async () => {
    const { loadSoloData, saveSoloData } = await import("@contractplay/persistence");
    location.hash = "#/online";
    render(<Root />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Play" }));
    await vi.waitFor(() => expect(loadSoloData(window.localStorage).handsStarted).toBe(1));
    await act(async () => { location.hash = "#/online"; });
    expect(await screen.findByText("Open tables")).toBeTruthy();
    // The hand is gone (as if finished), so a start-now still pending would deal again.
    saveSoloData(window.localStorage, { ...loadSoloData(window.localStorage), currentGame: null });
    await act(async () => { location.hash = "#/solo"; });
    expect(await screen.findByRole("button", { name: "Start a new hand" })).toBeTruthy();
    // Long enough for a stray start-now to fetch a replay and deal.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(soloVisible()).toBe(true);
    expect(loadSoloData(window.localStorage).handsStarted).toBe(1);
  });

  it("opens the solo app's Recent hands dialog from the lobby, listing saved online hands", async () => {
    const { applyAction, createGameState, deal, legalCards } = await import("@contractplay/core");
    const { saveSoloData, loadSoloData } = await import("@contractplay/persistence");
    const { saveIdentity } = await import("./online/identity.js");
    // A finished hand: 1♣ passed out to North, then the first legal card each turn.
    let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
    const step = (action: Parameters<typeof applyAction>[1]) => { const result = applyAction(game, action); if (!result.ok) throw new Error(result.error.message); game = result.state; };
    for (const [seat, bid] of [["north", "1clubs"], ["east", "pass"], ["south", "pass"], ["west", "pass"]] as const) step({ type: "bid", seat, bid });
    while (game.phase === "play") step({ type: "play", seat: game.currentActor, card: legalCards(game.hands[game.currentActor], game.currentTrick[0]?.card.suit)[0]! });
    saveSoloData(window.localStorage, { ...loadSoloData(window.localStorage), completedHands: [{ id: "online-ABC234-1", name: "Online hand", game, savedAt: "2026-11-01T10:00:00.000Z" }] });
    saveIdentity(window.localStorage, "Bob");
    location.hash = "#/online";
    render(<Root />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Recent hands" }));
    const dialog = await screen.findByRole("dialog", { name: "Recent hands" });
    expect(dialog.textContent).toContain("Online hand");
    expect(location.hash).toBe("#/solo");
  });

  it("follows hashchange", async () => {
    render(<Root />);
    await act(async () => { location.hash = "#/online"; });
    expect(await screen.findByText("Open tables")).toBeTruthy();
  });

  it("renders the solo app for an unknown hash", () => {
    location.hash = "#/nonsense";
    render(<Root />);
    expect(soloVisible()).toBe(true);
  });

  it("renders the online table for a table route, asking for a name first, and leaves to the lobby", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))));
    location.hash = "#/table/ABC234";
    render(<Root />);
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Back to lobby" }));
    expect(location.hash).toBe("#/online");
  });

  it.each([["https://x.test"], [undefined]])("opens the UI previews at #/mocks/N with service URL %s, steps the hash, and leaves storage alone", async (url) => {
    service.url = url;
    location.hash = "#/mocks/2";
    render(<Root />);
    const bar = await screen.findByRole("navigation", { name: "UI previews" });
    expect(bar.textContent).toContain("2 / ");
    await userEvent.setup().click(screen.getByRole("button", { name: "Next screen" }));
    expect(location.hash).toBe("#/mocks/3");
    expect((await screen.findByRole("navigation", { name: "UI previews" })).textContent).toContain("3 / ");
    expect(window.localStorage.length).toBe(0);
  });

  it.each(["", "#/online", "#/table/ABC234"])("renders solo for %j with no service URL", (hash) => {
    service.url = undefined;
    location.hash = hash;
    render(<Root />);
    expect(soloVisible()).toBe(true);
  });
});

it("loads account history when Recent hands opens directly in solo play", async () => {
  const { applyAction, createGameState, deal, legalCards } = await import("@contractplay/core");
  const { loadSoloData } = await import("@contractplay/persistence");
  let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
  for (const [seat, bid] of [["north", "1clubs"], ["east", "pass"], ["south", "pass"], ["west", "pass"]] as const) {
    const result = applyAction(game, { type: "bid", seat, bid }); if (!result.ok) throw new Error(result.error.message); game = result.state;
  }
  while (game.phase === "play") {
    const result = applyAction(game, { type: "play", seat: game.currentActor, card: legalCards(game.hands[game.currentActor], game.currentTrick[0]?.card.suit)[0]! });
    if (!result.ok) throw new Error(result.error.message); game = result.state;
  }
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url === "/api/auth/me"
    ? Response.json({ playerId: "account-player", displayName: "Owner" })
    : Response.json({ hands: [{ id: "online-ABC234-1", name: "Another device", savedAt: "2026-11-14T00:00:00.000Z", game }] })));
  const { default: App } = await import("./App.js");
  render(<App initialDialog="hands" />);
  expect(await screen.findByText("Another device")).toBeTruthy();
  expect(loadSoloData(window.localStorage).completedHands[0]?.id).toBe("online-ABC234-1");
});
