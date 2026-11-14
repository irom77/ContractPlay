// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { StorageLike } from "@contractplay/persistence";
import type { TableSummary } from "@contractplay/protocol";
import { createDeck, deal } from "@contractplay/core";
import { exportPbn } from "@contractplay/pbn";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadIdentity, saveIdentity } from "./identity.js";
import { Lobby, type LobbyApi } from "./Lobby.js";
import { boardSetFromPbn } from "../boardSet.js";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const summaries: TableSummary[] = [
  { id: "ABC123", name: "Friday club", style: "SAYC", scoring: "rubber", handInProgress: true, seats: { north: { kind: "human", name: "Ann", away: false }, east: { kind: "bot", skill: "beginner" }, south: { kind: "empty" }, west: { kind: "empty" } } },
  { id: "DEF456", name: "Learners", style: "2/1", scoring: "duplicate", handInProgress: false, seats: { north: { kind: "empty" }, east: { kind: "empty" }, south: { kind: "empty" }, west: { kind: "empty" } } }
];

function setup(options: { list?: () => Promise<TableSummary[]>; create?: () => Promise<{ id: string } | { error: string }>; named?: boolean } = {}) {
  const storage = memoryStorage();
  if (options.named !== false) saveIdentity(storage, "Bob");
  const listTables = vi.fn(options.list ?? (() => Promise.resolve(summaries)));
  const createTable = vi.fn(options.create ?? (() => Promise.resolve({ id: "NEW123" })));
  const onOpenTable = vi.fn();
  const onSolo = vi.fn();
  const onRecentHands = vi.fn();
  const createSession = vi.fn(async (baseUrl: string, input: Parameters<LobbyApi["createSession"]>[1]) => {
    void baseUrl;
    void input;
    return { sessionId: "SESSION1", tableIds: ["NEW123", "NEW456"] };
  });
  render(<Lobby baseUrl="https://x.test" storage={storage} onOpenTable={onOpenTable} onSolo={onSolo} onRecentHands={onRecentHands} api={{ listTables, createTable, createSession }} />);
  return { storage, listTables, createTable, createSession, onOpenTable, onSolo, onRecentHands };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Lobby", () => {
  it("asks for a name first and stores the identity on Continue", async () => {
    const user = userEvent.setup();
    const { storage, listTables } = setup({ named: false });
    expect(screen.queryByRole("button", { name: "New table" })).toBeNull();
    expect(listTables).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Your name"), "Carol");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(loadIdentity(storage)?.name).toBe("Carol");
    expect(await screen.findByText("Friday club")).toBeTruthy();
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
    const { createTable, onOpenTable } = setup({ list: () => Promise.resolve([]) });
    const name = await screen.findByLabelText("Table name");
    expect((name as HTMLInputElement).value).toBe("Bob's table");
    await user.clear(name);
    await user.type(name, "Evening");
    await user.selectOptions(screen.getByLabelText("Bidding style"), "2/1");
    await user.click(screen.getByLabelText("Show in lobby"));
    await user.click(screen.getByRole("button", { name: "New table" }));
    expect(createTable).toHaveBeenCalledWith("https://x.test", { name: "Evening", style: "2/1", scoring: "rubber", listed: false });
    await waitFor(() => expect(onOpenTable).toHaveBeenCalledWith("NEW123"));
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
    await user.upload(screen.getByLabelText("PBN board set"), new File([pbn], "club.pbn", { type: "text/plain" }));
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
    expect(((await screen.findByLabelText("Scoring")) as HTMLSelectElement).value).toBe("rubber");
    await user.selectOptions(screen.getByLabelText("Scoring"), "duplicate");
    await user.click(screen.getByRole("button", { name: "New table" }));
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
    await user.click(await screen.findByRole("button", { name: "New table" }));
    expect((await screen.findByRole("alert")).textContent).toBe("There are too many open tables right now. Try again later.");
  });

  it("keeps the page usable when listing fails", async () => {
    const user = userEvent.setup();
    const { onSolo } = setup({ list: () => Promise.reject(new Error("offline")) });
    expect((await screen.findByRole("alert")).textContent).toBe("Can't reach the tables right now.");
    await user.click(screen.getByRole("button", { name: "Solo play" }));
    expect(onSolo).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "New table" })).toBeTruthy();
  });

  it("opens recent hands", async () => {
    const user = userEvent.setup();
    const { onRecentHands } = setup();
    await user.click(await screen.findByRole("button", { name: "Recent hands" }));
    expect(onRecentHands).toHaveBeenCalled();
  });

  it("lets the player change their name", async () => {
    const user = userEvent.setup();
    const { storage } = setup();
    await user.click(await screen.findByRole("button", { name: "Change name" }));
    const field = screen.getByLabelText("Your name");
    await user.clear(field);
    await user.type(field, "Dana");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(loadIdentity(storage)?.name).toBe("Dana");
  });

  it("refreshes every five seconds without stacking requests and stops on unmount", async () => {
    vi.useFakeTimers();
    let resolve!: (value: TableSummary[]) => void;
    const list = vi.fn(() => new Promise<TableSummary[]>((r) => { resolve = r; }));
    const storage = memoryStorage();
    saveIdentity(storage, "Bob");
    const { unmount } = render(<Lobby baseUrl="x" storage={storage} onOpenTable={vi.fn()} onSolo={vi.fn()} onRecentHands={vi.fn()} api={{ listTables: list, createTable: vi.fn(), createSession: vi.fn() }} />);
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

  it("disables Continue for an empty or whitespace-only name", async () => {
    const user = userEvent.setup();
    setup({ named: false });
    const button = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText("Your name"), "   ");
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText("Your name"), "x");
    expect(button.disabled).toBe(false);
  });

  it.each([
    ["too-many-requests", "Limit: 10 tables per public IP in a rolling hour. Removing tables doesn't reset it; try again later."],
    ["network", "Couldn't create the table. Try again."]
  ])("shows copy for the %s creation error", async (error, copy) => {
    const user = userEvent.setup();
    setup({ create: () => Promise.resolve({ error }) });
    await user.click(await screen.findByRole("button", { name: "New table" }));
    expect((await screen.findByRole("alert")).textContent).toBe(copy);
  });

  it("shows the generic error when createTable rejects and re-enables the form", async () => {
    const user = userEvent.setup();
    setup({ create: () => Promise.reject(new Error("boom")) });
    await user.click(await screen.findByRole("button", { name: "New table" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't create the table. Try again.");
    expect((screen.getByRole("button", { name: "New table" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears a creation error when the form is edited", async () => {
    const user = userEvent.setup();
    setup({ create: () => Promise.resolve({ error: "too-many-tables" }) });
    await user.click(await screen.findByRole("button", { name: "New table" }));
    await screen.findByRole("alert");
    await user.type(screen.getByLabelText("Table name"), "!");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates only one table on a double submit", async () => {
    const user = userEvent.setup();
    const { createTable } = setup({ create: () => new Promise(() => {}) });
    const name = await screen.findByLabelText("Table name");
    await user.type(name, "{Enter}{Enter}");
    expect(createTable).toHaveBeenCalledTimes(1);
  });
});
