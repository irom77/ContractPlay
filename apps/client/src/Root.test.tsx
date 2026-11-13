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
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("[]"))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/"); });

const soloVisible = () => screen.queryByRole("button", { name: "Start a new hand" }) !== null;

describe("Root", () => {
  it("renders the solo app without a hash", () => {
    render(<Root />);
    expect(soloVisible()).toBe(true);
  });

  it("renders the lobby for #/online and returns to solo from it", async () => {
    location.hash = "#/online";
    render(<Root />);
    expect(await screen.findByLabelText("Your name")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Solo play" }));
    expect(soloVisible()).toBe(true);
    expect(location.hash).toBe("");
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
    expect(location.hash).toBe("");
  });

  it("follows hashchange", async () => {
    render(<Root />);
    await act(async () => { location.hash = "#/online"; });
    expect(await screen.findByLabelText("Your name")).toBeTruthy();
  });

  it("renders the solo app for an unknown hash", () => {
    location.hash = "#/nonsense";
    render(<Root />);
    expect(soloVisible()).toBe(true);
  });

  it("renders the online table for a table route, asking for a name first, and leaves to the lobby", async () => {
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
