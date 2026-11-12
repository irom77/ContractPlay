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
