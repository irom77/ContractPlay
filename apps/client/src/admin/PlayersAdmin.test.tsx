// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminRequestError, PlayersAdmin, type AdminAccounts, type PlayersAdminApi } from "./PlayersAdmin.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function fakeApi(): PlayersAdminApi & { state: AdminAccounts } {
  const state: AdminAccounts = {
    users: [
      { id: "me", email: "me@example.com", displayName: "Irek", createdAt: 1, admin: true, bootstrapAdmin: true, blocked: false, you: true },
      { id: "ann", email: "ann@example.com", displayName: "Ann", createdAt: 2, admin: false, bootstrapAdmin: false, blocked: false, you: false }
    ],
    signups: [{ email: "new@example.com", displayName: "Newcomer", requestedAt: 3 }, { email: "spam@example.com", displayName: "Spam", requestedAt: 4 }],
    blocked: []
  };
  return {
    state,
    load: vi.fn(async () => structuredClone(state)),
    setAdmin: vi.fn(async (id: string, admin: boolean) => { state.users = state.users.map((user) => user.id === id ? { ...user, admin } : user); }),
    approve: vi.fn(async (email: string) => { state.signups = state.signups.filter((s) => s.email !== email); return { emailed: true }; }),
    deny: vi.fn(async (email: string) => { state.signups = state.signups.filter((s) => s.email !== email); return { emailed: true }; }),
    block: vi.fn(async (email: string) => { state.signups = state.signups.filter((s) => s.email !== email); state.blocked = [{ email, blockedAt: 5 }, ...state.blocked]; }),
    unblock: vi.fn(async (email: string) => { state.blocked = state.blocked.filter((b) => b.email !== email); })
  };
}

describe("PlayersAdmin", () => {
  it("approves, denies and blocks new players from the queue", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeApi();
    render(<PlayersAdmin api={api} />);
    const user = userEvent.setup();
    const queue = await screen.findByRole("region", { name: "Waiting for approval" });
    expect(within(queue).getByRole("heading").textContent).toBe("Waiting for approval (2)");
    await user.click(within(queue).getByRole("button", { name: "Approve new@example.com" }));
    expect(api.approve).toHaveBeenCalledWith("new@example.com");
    expect((await screen.findByRole("status")).textContent).toBe("Approved new@example.com and sent a sign-in link.");
    await user.click(screen.getByRole("button", { name: "Deny spam@example.com" }));
    expect(api.deny).toHaveBeenCalledWith("spam@example.com");
    expect(await screen.findByText("No one is waiting.")).toBeTruthy();
  });

  it("grants admin rights, and never offers to remove your own or a deployment admin's", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeApi();
    render(<PlayersAdmin api={api} />);
    const user = userEvent.setup();
    const mine = await screen.findByRole("button", { name: "Remove admin from me@example.com" }) as HTMLButtonElement;
    expect(mine.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Block me@example.com" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Make ann@example.com an admin" }));
    expect(api.setAdmin).toHaveBeenCalledWith("ann", true);
    expect(await screen.findByRole("button", { name: "Remove admin from ann@example.com" })).toBeTruthy();
  });

  it("blocks a typed address and unblocks it", async () => {
    const api = fakeApi();
    render(<PlayersAdmin api={api} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Email to block"), "Troll@Example.com");
    await user.click(within(screen.getByRole("form", { name: "Block an address" })).getByRole("button", { name: "Block" }));
    expect(api.block).toHaveBeenCalledWith("troll@example.com");
    await user.click(await screen.findByRole("button", { name: "Unblock troll@example.com" }));
    expect(api.unblock).toHaveBeenCalledWith("troll@example.com");
    expect(await screen.findByText("No addresses are blocked.")).toBeTruthy();
  });

  it("explains a refusal and reports a non-admin session", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeApi();
    api.setAdmin = vi.fn(async () => { throw new AdminRequestError(409, "self"); });
    render(<PlayersAdmin api={api} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Make ann@example.com an admin" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't change ann@example.com. You can't do that to your own account.");
    cleanup();
    const onDenied = vi.fn();
    render(<PlayersAdmin api={{ ...fakeApi(), load: async () => { throw new AdminRequestError(403, "forbidden"); } }} onDenied={onDenied} />);
    await vi.waitFor(() => expect(onDenied).toHaveBeenCalledWith(403));
  });
});
