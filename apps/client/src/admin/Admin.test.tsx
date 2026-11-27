// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Admin } from "./Admin.js";
import type { AdminAccounts, PlayersAdminApi } from "./PlayersAdmin.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState(null, "", "/admin"); });

const accounts: AdminAccounts = { users: [], blocked: [], signups: [{ email: "a@example.com", displayName: "A", requestedAt: 1 }, { email: "b@example.com", displayName: "B", requestedAt: 2 }] };
const players: PlayersAdminApi = { load: async () => accounts, setAdmin: async () => {}, approve: async () => ({ emailed: true }), deny: async () => ({ emailed: true }), block: async () => {}, unblock: async () => {} };

function stubService() {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const path = input.toString();
    if (path.endsWith("/api/admin/tables")) return Response.json({ tables: [] });
    if (path.includes("/profiles")) return Response.json({ profiles: [] });
    if (path.includes("/cohorts")) return Response.json({ cohorts: [] });
    if (path.includes("/jobs")) return Response.json({ jobs: [] });
    return Response.json({ imports: [] });
  }));
}

describe("Admin", () => {
  it("shows one box at a time, chosen with tabs that the address remembers", async () => {
    stubService();
    history.replaceState(null, "", "/admin#jobs");
    render(<Admin baseUrl="https://x.test" players={players} />);
    const tabs = within(screen.getByRole("tablist", { name: "Admin sections" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.firstChild?.textContent)).toEqual(["Players", "Online tables", "Profiles", "Cohorts", "Jobs"]);
    expect(tabs.getByRole("tab", { name: "Jobs" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("region", { name: "Benchmark jobs" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Players" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Online tables" })).toBeNull();
    // New players waiting show as a count on the Players tab from any tab.
    expect(await tabs.findByLabelText("2 waiting")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(tabs.getByRole("tab", { name: /^Players/ }));
    expect(screen.getByRole("region", { name: "Players" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Benchmark jobs" })).toBeNull();
    expect(location.hash).toBe("#players");
    await user.click(tabs.getByRole("tab", { name: "Online tables" }));
    expect(await screen.findByText("There are no open tables.")).toBeTruthy();
    expect(location.hash).toBe("#tables");
  });
});
