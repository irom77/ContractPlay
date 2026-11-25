// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { StorageLike } from "@contractplay/persistence";
import type { TableSummary } from "@contractplay/protocol";
import { createDeck, deal } from "@contractplay/core";
import { exportPbn } from "@contractplay/pbn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAction, createGameState } from "@contractplay/core";
import { loadSoloData, saveSoloData } from "@contractplay/persistence";
import { loadIdentity, saveIdentity } from "./identity.js";
import { Lobby, type LobbyApi, type LobbyProps } from "./Lobby.js";
import { boardSetFromPbn } from "../boardSet.js";
import { defaultSoloSetup, loadSoloSetup, saveSoloSetup } from "../soloSetup.js";

type User = ReturnType<typeof userEvent.setup>;
/** Switches the Play panel to an online table for other people. */
const withPeople = async (user: User) => user.click(await screen.findByRole("radio", { name: "With other people" }));

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const summaries: TableSummary[] = [
  { id: "ABC123", name: "Friday club", style: "SAYC", scoring: "rubber", handInProgress: true, seats: { north: { kind: "human", name: "Ann", away: false }, east: { kind: "bot", skill: "beginner" }, south: { kind: "empty" }, west: { kind: "empty" } } },
  { id: "DEF456", name: "Learners", style: "2/1", scoring: "duplicate", handInProgress: false, seats: { north: { kind: "empty" }, east: { kind: "empty" }, south: { kind: "empty" }, west: { kind: "empty" } } }
];

const signedIn = { currentAccount: async () => ({ playerId: "account-1", displayName: "Bob" }), requestMagicLink: async () => {}, signOut: async () => {} };

/** Renders the lobby; its Open tables and Play panels start open unless `collapsed` keeps the real default. */
function setup(options: { list?: () => Promise<TableSummary[]>; create?: () => Promise<{ id: string } | { error: string }>; named?: boolean; auth?: LobbyProps["auth"]; storage?: StorageLike; collapsed?: boolean } = {}) {
  const storage = options.storage ?? memoryStorage();
  if (options.named !== false) saveIdentity(storage, "Bob");
  const listTables = vi.fn(options.list ?? (() => Promise.resolve(summaries)));
  const createTable = vi.fn(options.create ?? (() => Promise.resolve({ id: "NEW123" })));
  const onOpenTable = vi.fn();
  const onPlaySolo = vi.fn();
  const onRecentHands = vi.fn();
  const createSession = vi.fn(async (baseUrl: string, input: Parameters<LobbyApi["createSession"]>[1]) => {
    void baseUrl;
    void input;
    return { sessionId: "SESSION1", tableIds: ["NEW123", "NEW456"] };
  });
  render(<Lobby baseUrl="https://x.test" storage={storage} onOpenTable={onOpenTable} onPlaySolo={onPlaySolo} onRecentHands={onRecentHands} api={{ listTables, createTable, createSession }} auth={options.auth ?? signedIn} expandedPanels={!options.collapsed} />);
  return { storage, listTables, createTable, createSession, onOpenTable, onPlaySolo, onRecentHands };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Lobby", () => {
  it("shows Open tables above Play, both collapsed to their headers until clicked", async () => {
    const { onPlaySolo } = setup({ collapsed: true });
    const user = userEvent.setup();
    const tablesToggle = await screen.findByRole("button", { name: /^Open tables/ });
    const playToggle = screen.getByRole("button", { name: /^Play/ });
    // Open tables comes first on the page.
    expect(tablesToggle.compareDocumentPosition(playToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablesToggle.getAttribute("aria-expanded")).toBe("false");
    expect(playToggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed, the headers carry the table count and the chosen mode; the list and form stay hidden.
    expect(await screen.findByLabelText("2 open")).toBeTruthy();
    expect(playToggle.textContent).toContain("Me and bots");
    expect(screen.queryByText("Friday club")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Me and bots" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    await user.click(tablesToggle);
    expect(tablesToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Friday club")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    await user.click(playToggle);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlaySolo).toHaveBeenCalledTimes(1);
    await user.click(tablesToggle);
    expect(screen.queryByText("Friday club")).toBeNull();
  });

  it("changes the account name from the lobby and uses it for new table names", async () => {
    const updateDisplayName = vi.fn(async (name: string) => ({ playerId: "account-1", displayName: name.trim() }));
    setup({ auth: { ...signedIn, updateDisplayName } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change name" }));
    const input = screen.getByLabelText("New name") as HTMLInputElement;
    expect(input.value).toBe("Bob");
    expect(input.maxLength).toBe(20);
    await user.clear(input);
    await user.type(input, " Irek ");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect(updateDisplayName).toHaveBeenCalledWith("Irek");
    expect(await screen.findByText("Signed in as Irek")).toBeTruthy();
    expect(screen.queryByLabelText("New name")).toBeNull();
    await withPeople(user);
    expect((screen.getByLabelText("Table name") as HTMLInputElement).value).toBe("Irek's table");
  });

  it("keeps the old name and reports a failed rename; Cancel closes the form", async () => {
    const updateDisplayName = vi.fn(async () => { throw new Error("nope"); });
    setup({ auth: { ...signedIn, updateDisplayName } });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Change name" }));
    await user.clear(screen.getByLabelText("New name"));
    expect((screen.getByRole("button", { name: "Save name" }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("New name"), "Irek");
    await user.click(screen.getByRole("button", { name: "Save name" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't change your name. Try again.");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New name")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Signed in as Bob")).toBeTruthy();
  });

  it("requires sign-in before showing tables or lobby actions", async () => {
    const { storage, listTables } = setup({ named: false, auth: { ...signedIn, currentAccount: async () => null } });
    expect(await screen.findByLabelText("Email sign-in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send sign-in link" })).toBeTruthy();
    expect(screen.queryByText("Open tables")).toBeNull();
    expect(screen.queryByRole("button", { name: "Solo play" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(loadIdentity(storage)).toBeUndefined();
    expect(listTables).not.toHaveBeenCalled();
  });

  it("lists tables with seat labels and play state", async () => {
    setup();
    expect(await screen.findByText("Friday club")).toBeTruthy();
    expect(screen.getByText("Learners")).toBeTruthy();
    expect(screen.getByText("Ann")).toBeTruthy();
    expect(screen.getByText("Bot")).toBeTruthy();
    expect(screen.getAllByText("Open").length).toBe(2 + 4);
    expect(screen.getAllByText("Playing").length).toBe(1);
    expect(screen.getByText("2/1 · Running totals").tagName).toBe("SPAN");
  });

  it("opens a listed table", async () => {
    const user = userEvent.setup();
    const { onOpenTable } = setup();
    await user.click(await screen.findByRole("button", { name: "Join Friday club" }));
    expect(onOpenTable).toHaveBeenCalledWith("ABC123");
  });

  it("explains an empty list", async () => {
    setup({ list: () => Promise.resolve([]) });
    expect(await screen.findByText("No open tables yet. Create one to start.")).toBeTruthy();
  });

  it("creates a table from the form and opens it", async () => {
    const user = userEvent.setup();
    const { createTable, onOpenTable, onPlaySolo } = setup({ list: () => Promise.resolve([]) });
    await withPeople(user);
    const name = await screen.findByLabelText("Table name");
    expect((name as HTMLInputElement).value).toBe("Bob's table");
    await user.clear(name);
    await user.type(name, "Evening");
    await user.selectOptions(screen.getByLabelText("Bidding style"), "2/1");
    await user.click(screen.getByLabelText("Show in lobby"));
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(createTable).toHaveBeenCalledWith("https://x.test", { name: "Evening", style: "2/1", scoring: "rubber", listed: false });
    await waitFor(() => expect(onOpenTable).toHaveBeenCalledWith("NEW123"));
    expect(onPlaySolo).not.toHaveBeenCalled();
  });

  it("creates a multi-table duplicate session and opens its first table", async () => {
    const user = userEvent.setup();
    const { createSession, onOpenTable } = setup({ list: () => Promise.resolve([]) });
    await screen.findByRole("heading", { name: "New duplicate session" });
    await user.selectOptions(screen.getByLabelText("Session tables"), "4");
    await user.selectOptions(screen.getByLabelText("Session boards"), "12");
    await user.selectOptions(screen.getByLabelText("Session scoring"), "imps");
    await user.click(screen.getByRole("button", { name: "Create session" }));
    expect(createSession).toHaveBeenCalledWith("https://x.test", { name: "Bob's duplicate", style: "SAYC", tableCount: 4, boardCount: 12, scoring: "imps", listed: true });
    await waitFor(() => expect(onOpenTable).toHaveBeenCalledWith("NEW123"));
  });

  it("imports only deals and board metadata from a PBN set into an online session", async () => {
    const user = userEvent.setup();
    const { createSession } = setup({ list: () => Promise.resolve([]) });
    const pbn = exportPbn({ dealer: "east", vulnerability: "Both", actions: [], deal: deal(createDeck()), tags: [
      { name: "Board", value: "7" }, { name: "Event", value: "Club Pairs" }, { name: "Names", value: "Smith - Jones" }
    ] }) + `\n[ScoreTable "Names_NS;Contract;Declarer;Result;Score_NS"]\n"Smith - Jones" 4S N 10 420`;
    await user.upload(await screen.findByLabelText("PBN board set"), new File([pbn], "club.pbn", { type: "text/plain" }));
    expect(await screen.findByText(/Loaded 1 board from club.pbn/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create session" }));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
    const input = createSession.mock.calls[0]![1];
    const expectedDeal = boardSetFromPbn(pbn).set!.records[0]!.deal;
    expect(input.boards).toEqual([{ number: 7, deal: expectedDeal, dealer: "east", vulnerability: "Both" }]);
    expect(JSON.stringify(input)).not.toContain("Smith");
    expect(input.boardCount).toBe(1);
  });

  it("offers rubber scoring by default and running totals as a choice", async () => {
    const user = userEvent.setup();
    const { createTable } = setup({ list: () => Promise.resolve([]) });
    await withPeople(user);
    expect(((await screen.findByLabelText("Scoring")) as HTMLSelectElement).value).toBe("rubber");
    await user.selectOptions(screen.getByLabelText("Scoring"), "duplicate");
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(createTable).toHaveBeenCalledWith("https://x.test", { name: "Bob's table", style: "SAYC", scoring: "duplicate", listed: true });
  });

  it("shows each table's scoring in the list", async () => {
    setup();
    expect(await screen.findByText("SAYC · Rubber bridge")).toBeTruthy();
    expect(screen.getByText("2/1 · Running totals")).toBeTruthy();
  });

  it("names a table listed without a scoring (from before rubber tables) as running totals", async () => {
    const legacy = Object.fromEntries(Object.entries(summaries[0]!).filter(([key]) => key !== "scoring")) as TableSummary;
    setup({ list: () => Promise.resolve([legacy]) });
    expect(await screen.findByText("SAYC · Running totals")).toBeTruthy();
  });

  it("shows a creation error in an alert", async () => {
    const user = userEvent.setup();
    setup({ create: () => Promise.resolve({ error: "too-many-tables" }) });
    await withPeople(user);
    await user.click(await screen.findByRole("button", { name: "Play" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There are too many open tables right now. Try again later.");
  });

  it("keeps the page usable when listing fails", async () => {
    const user = userEvent.setup();
    const { onPlaySolo } = setup({ list: () => Promise.reject(new Error("offline")) });
    expect((await screen.findByRole("alert")).textContent).toBe("Can't reach the tables right now.");
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlaySolo).toHaveBeenCalled();
  });

  it("opens recent hands", async () => {
    const user = userEvent.setup();
    const { onRecentHands } = setup();
    await user.click(await screen.findByRole("button", { name: "Recent hands" }));
    expect(onRecentHands).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Solo play" })).toBeNull();
  });

  it("shows the authenticated display name in the lobby", async () => {
    setup();
    expect(await screen.findByText("Signed in as Bob")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change name" })).toBeTruthy();
  });

  it("refreshes every five seconds without stacking requests and stops on unmount", async () => {
    vi.useFakeTimers();
    let resolve!: (value: TableSummary[]) => void;
    const list = vi.fn(() => new Promise<TableSummary[]>((r) => { resolve = r; }));
    const storage = memoryStorage();
    saveIdentity(storage, "Bob");
    const { unmount } = render(<Lobby baseUrl="x" storage={storage} onOpenTable={vi.fn()} onPlaySolo={vi.fn()} onRecentHands={vi.fn()} api={{ listTables: list, createTable: vi.fn(), createSession: vi.fn() }} auth={signedIn} />);
    await act(async () => {});
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => { resolve([]); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(list).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("requires an email address before requesting a link", async () => {
    const user = userEvent.setup();
    setup({ named: false, auth: { ...signedIn, currentAccount: async () => null } });
    const button = await screen.findByRole("button", { name: "Send sign-in link" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText("Email"), "alex@example.com");
    expect(button.disabled).toBe(false);
  });

  it.each([
    ["too-many-requests", "Limit: 10 tables per public IP in a rolling hour. Removing tables doesn't reset it; try again later."],
    ["network", "Couldn't create the table. Try again."]
  ])("shows copy for the %s creation error", async (error, copy) => {
    const user = userEvent.setup();
    setup({ create: () => Promise.resolve({ error }) });
    await withPeople(user);
    await user.click(await screen.findByRole("button", { name: "Play" }));
    expect((await screen.findByRole("alert")).textContent).toBe(copy);
  });

  it("shows the generic error when createTable rejects and re-enables the form", async () => {
    const user = userEvent.setup();
    setup({ create: () => Promise.reject(new Error("boom")) });
    await withPeople(user);
    await user.click(await screen.findByRole("button", { name: "Play" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't create the table. Try again.");
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears a creation error when the form is edited", async () => {
    const user = userEvent.setup();
    setup({ create: () => Promise.resolve({ error: "too-many-tables" }) });
    await withPeople(user);
    await user.click(await screen.findByRole("button", { name: "Play" }));
    await screen.findByRole("alert");
    await user.type(screen.getByLabelText("Table name"), "!");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates only one table on a double submit", async () => {
    const user = userEvent.setup();
    const { createTable } = setup({ create: () => new Promise(() => {}) });
    await withPeople(user);
    const name = await screen.findByLabelText("Table name");
    await user.type(name, "{Enter}{Enter}");
    expect(createTable).toHaveBeenCalledTimes(1);
  });

  it("starts solo against bots with the chosen settings, without creating a table", async () => {
    const user = userEvent.setup();
    const { storage, createTable, onPlaySolo } = setup({ list: () => Promise.resolve([]) });
    expect(((await screen.findByRole("radio", { name: "Me and bots" })) as HTMLInputElement).checked).toBe(true);
    await user.selectOptions(screen.getByLabelText("Your seat"), "west");
    await user.selectOptions(screen.getByLabelText("Bot skill"), "expert");
    await user.selectOptions(screen.getByLabelText("Bidding style"), "2/1");
    await user.selectOptions(screen.getByLabelText("Scoring"), "single");
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlaySolo).toHaveBeenCalledTimes(1);
    expect(createTable).not.toHaveBeenCalled();
    expect(loadSoloSetup(storage)).toEqual({ opponents: "bots", seat: "west", botSkill: "expert", biddingStyle: "2/1", scoring: "single" });
  });

  it("plays against bots even when solo was last left at a manual table", async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    saveSoloSetup(storage, { ...defaultSoloSetup, opponents: "manual" });
    setup({ storage, list: () => Promise.resolve([]) });
    await user.click(await screen.findByRole("button", { name: "Play" }));
    expect(loadSoloSetup(storage).opponents).toBe("bots");
  });

  it("fills Me and bots from the remembered solo setup", async () => {
    const storage = memoryStorage();
    saveSoloSetup(storage, { ...defaultSoloSetup, seat: "east", botSkill: "advanced" });
    setup({ storage, list: () => Promise.resolve([]) });
    expect(((await screen.findByLabelText("Your seat")) as HTMLSelectElement).value).toBe("east");
    expect((screen.getByLabelText("Bot skill") as HTMLSelectElement).value).toBe("advanced");
  });

  it("keeps the session's bidding style separate from the Play panel's", async () => {
    const user = userEvent.setup();
    const { createSession } = setup({ list: () => Promise.resolve([]) });
    await withPeople(user);
    await user.selectOptions(screen.getByLabelText("Bidding style"), "2/1");
    expect((screen.getByLabelText("Session bidding style") as HTMLSelectElement).value).toBe("SAYC");
    await user.click(screen.getByRole("button", { name: "Create session" }));
    expect(createSession.mock.calls[0]![1].style).toBe("SAYC");
  });

  it("leaves an unfinished solo hand's setup alone and says Play resumes it", async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    saveSoloSetup(storage, { ...defaultSoloSetup, opponents: "manual" });
    const started = applyAction(createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" }), { type: "bid", seat: "north", bid: "1clubs" });
    if (!started.ok) throw new Error(started.error.message);
    saveSoloData(storage, { ...loadSoloData(storage), currentGame: started.state });
    const { onPlaySolo } = setup({ storage, list: () => Promise.resolve([]) });
    expect(await screen.findByText("Your unfinished solo hand will resume; these settings apply from the next deal.")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Your seat"), "west");
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlaySolo).toHaveBeenCalledTimes(1);
    expect(loadSoloSetup(storage)).toEqual({ ...defaultSoloSetup, opponents: "manual" });
  });

  it("does not start solo while a table is being created", async () => {
    const user = userEvent.setup();
    const { onPlaySolo } = setup({ create: () => new Promise(() => {}), list: () => Promise.resolve([]) });
    await withPeople(user);
    await user.click(screen.getByRole("button", { name: "Play" }));
    await user.click(screen.getByRole("radio", { name: "Me and bots" }));
    expect((screen.getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onPlaySolo).not.toHaveBeenCalled();
  });
});
