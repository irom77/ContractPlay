// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { StorageLike } from "@contractplay/persistence";
import type { TableSummary } from "@contractplay/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadIdentity, saveIdentity } from "./identity.js";
import { Lobby } from "./Lobby.js";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const summaries: TableSummary[] = [
  { id: "ABC123", name: "Friday club", style: "SAYC", handInProgress: true, seats: { north: { kind: "human", name: "Ann", away: false }, east: { kind: "bot", skill: "beginner" }, south: { kind: "empty" }, west: { kind: "empty" } } },
  { id: "DEF456", name: "Learners", style: "2/1", handInProgress: false, seats: { north: { kind: "empty" }, east: { kind: "empty" }, south: { kind: "empty" }, west: { kind: "empty" } } }
];

function setup(options: { list?: () => Promise<TableSummary[]>; create?: () => Promise<{ id: string } | { error: string }>; named?: boolean } = {}) {
  const storage = memoryStorage();
  if (options.named !== false) saveIdentity(storage, "Bob");
  const listTables = vi.fn(options.list ?? (() => Promise.resolve(summaries)));
  const createTable = vi.fn(options.create ?? (() => Promise.resolve({ id: "NEW123" })));
  const onOpenTable = vi.fn();
  const onSolo = vi.fn();
  render(<Lobby baseUrl="https://x.test" storage={storage} onOpenTable={onOpenTable} onSolo={onSolo} api={{ listTables, createTable }} />);
  return { storage, listTables, createTable, onOpenTable, onSolo };
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
    expect(screen.getAllByText("2/1").some((el) => el.tagName === "SPAN")).toBe(true);
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
    expect(createTable).toHaveBeenCalledWith("https://x.test", { name: "Evening", style: "2/1", listed: false });
    await waitFor(() => expect(onOpenTable).toHaveBeenCalledWith("NEW123"));
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
    const { unmount } = render(<Lobby baseUrl="x" storage={storage} onOpenTable={vi.fn()} onSolo={vi.fn()} api={{ listTables: list, createTable: vi.fn() }} />);
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
});
