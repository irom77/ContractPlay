// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deal } from "@contractplay/core";
import { BenchmarkLeaderboard, BenchmarkReplay } from "./BenchmarkPages.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("benchmark public pages", () => {
  it("shows provisional rating uncertainty, profile versions, diagnostics and replay privacy", async () => {
    const competitorId = JSON.stringify(["timid", "v3"]);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = input.toString();
      if (path.endsWith("/leaderboard")) return Response.json({ ratings: [
        { competitorId, rating: 1540, deviation: 140, volatility: 0.06, sampleBoards: 12, handsPlayed: 24, ratedAt: Date.UTC(2026, 10, 25), algorithmVersion: "glicko-2", scoreTransformVersion: "sigmoid-12", eligible: false },
        { competitorId: JSON.stringify(["bold", "v1"]), rating: 1600, deviation: 80, volatility: 0.05, sampleBoards: 24, ratedAt: Date.UTC(2026, 10, 25), algorithmVersion: "glicko-2", scoreTransformVersion: "sigmoid-12", eligible: true }
      ] });
      if (path.endsWith("/results")) return Response.json({ results: [
        { jobId: "generated", tableIndex: 0, boardIndex: 0, boardNumber: 1, nsScore: 90, ewScore: -90, completedAt: Date.UTC(2026, 10, 25), replayAvailable: true, replayStatus: "available" },
        { jobId: "imported", tableIndex: 0, boardIndex: 0, boardNumber: 2, nsScore: 110, ewScore: -110, completedAt: Date.UTC(2026, 10, 25), replayAvailable: false, replayStatus: "private-import" },
        { jobId: "expired", tableIndex: 0, boardIndex: 0, boardNumber: 3, nsScore: 130, ewScore: -130, completedAt: Date.UTC(2026, 10, 25), replayAvailable: false, replayStatus: "expired" }
      ] });
      if (path.endsWith("/profiles")) return Response.json({ profiles: [
        { profile: { profileId: "timid", version: "v3", skill: "beginner", aggression: "conservative", biddingStyle: "SAYC", engineVersion: "contractplay-bots-v1" }, status: "active" },
        { profile: { profileId: "bold", version: "v1", skill: "expert", aggression: "aggressive", biddingStyle: "2/1", engineVersion: "contractplay-bots-v1" }, status: "active" }
      ] });
      if (path.endsWith("/metrics")) return Response.json([{ scoring: "imps", sessions: 3, boards: 12, impsPerBoard: 0.5, matchpointPercentage: 53, wins: 2, ties: 0, losses: 1, winPercentage: 66.6 }]);
      if (path.endsWith("/diagnostics")) return Response.json({ source: "bridge-dds-1.4.0", maxTableResults: 128, analyzedTableResults: 4, auction: { samples: 4, meanAbsoluteParGapPoints: 20 }, declarer: { samples: 1, meanTricksBelowOptimum: 1 }, defense: { samples: 3, meanTricksPreventedVsDoubleDummy: 0.3 } });
      if (path.endsWith("/ratings")) return Response.json({ ratings: [{ competitorId, jobId: "r1", rating: 1540, deviation: 140, volatility: 0.06, sampleBoards: 12, ratedAt: Date.UTC(2026, 10, 25), algorithmVersion: "glicko-2", scoreTransformVersion: "sigmoid-12", eligible: false }] });
      return new Response(null, { status: 404 });
    }));
    render(<BenchmarkLeaderboard baseUrl="https://x.test" />);
    expect(await screen.findByText("Provisional")).toBeTruthy();
    expect(screen.getByText("Eligible")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Eligible rankings" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Provisional ratings" })).toBeTruthy();
    expect(screen.getByText("timid · v3")).toBeTruthy();
    expect(screen.getAllByRole("columnheader", { name: "Hands" })).toHaveLength(2);
    const timidRow = screen.getByText("timid · v3").closest("tr")!;
    expect([...timidRow.querySelectorAll("td")].map((cell) => cell.textContent)).toContain("24");
    expect(screen.getByText(/Imported deal replay is private/)).toBeTruthy();
    expect(screen.getByText(/Replay expired under the retention policy/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Replay" }).getAttribute("href")).toContain("/generated/");
    await userEvent.setup().click(screen.getByRole("button", { name: "timid · v3" }));
    expect(await screen.findByText(/Auction: mean absolute par gap/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rating history" })).toBeTruthy();
  });

  it("ignores stale selected-profile metrics after the user changes profiles", async () => {
    let resolveTimid!: (response: Response) => void;
    const delayedTimid = new Promise<Response>((resolve) => { resolveTimid = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = input.toString();
      if (path.endsWith("/leaderboard")) return Response.json({ ratings: [
        { competitorId: JSON.stringify(["timid", "v1"]), rating: 1500, deviation: 150, volatility: 0.06, sampleBoards: 2, ratedAt: 1, algorithmVersion: "glicko-2", scoreTransformVersion: "sigmoid-12", eligible: false },
        { competitorId: JSON.stringify(["bold", "v1"]), rating: 1550, deviation: 90, volatility: 0.05, sampleBoards: 24, ratedAt: 1, algorithmVersion: "glicko-2", scoreTransformVersion: "sigmoid-12", eligible: true }
      ] });
      if (path.endsWith("/results")) return Response.json({ results: [] });
      if (path.endsWith("/profiles")) return Response.json({ profiles: [
        { profile: { profileId: "timid", version: "v1", skill: "beginner", aggression: "conservative", biddingStyle: "SAYC", engineVersion: "v1" }, status: "active" },
        { profile: { profileId: "bold", version: "v1", skill: "expert", aggression: "aggressive", biddingStyle: "2/1", engineVersion: "v1" }, status: "active" }
      ] });
      if (path.endsWith("/metrics")) return path.includes("/timid/") ? delayedTimid : Response.json([{ scoring: "imps", sessions: 1, boards: 24, impsPerBoard: 4.25, matchpointPercentage: 60, wins: 1, ties: 0, losses: 0, winPercentage: 100 }]);
      if (path.endsWith("/diagnostics")) return Response.json({ source: "dds", maxTableResults: 10, analyzedTableResults: 1, auction: { samples: 1 }, declarer: { samples: 1 }, defense: { samples: 1 } });
      if (path.endsWith("/ratings")) return Response.json({ ratings: [] });
      return new Response(null, { status: 404 });
    }));
    render(<BenchmarkLeaderboard baseUrl="https://x.test" />);
    await screen.findByRole("button", { name: "timid · v1" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "timid · v1" }));
    await user.click(screen.getByRole("button", { name: "bold · v1" }));
    expect(await screen.findByText(/24 boards \/ 1 sessions · 4.25 IMP\/board/)).toBeTruthy();
    resolveTimid(Response.json([{ scoring: "imps", sessions: 1, boards: 2, impsPerBoard: -8, matchpointPercentage: 10, wins: 0, ties: 0, losses: 1, winPercentage: 0 }]));
    await Promise.resolve();
    expect(screen.getByText(/24 boards \/ 1 sessions · 4.25 IMP\/board/)).toBeTruthy();
  });

  it("keeps replay hands hidden until the final stored action, then exposes the completed deal", async () => {
    const boardDeal = deal();
    const makeProfile = (profileId: string, aggression: "conservative" | "normal" | "aggressive") => ({ profileId, version: "v1", skill: "beginner" as const, aggression, biddingStyle: "SAYC" as const, engineVersion: "contractplay-bots-v1" });
    const payload = { jobId: "job1", tableIndex: 0, boardIndex: 0, scoring: "imps", board: { number: 4, deal: boardDeal, dealer: "north", vulnerability: "None" },
      assignment: { north: makeProfile("tess", "conservative"), east: makeProfile("ray", "normal"), south: makeProfile("eddie", "aggressive"), west: makeProfile("cora", "conservative") },
      field: [{ tableIndex: 0, nsScore: 0, contract: null, tricks: null }, { tableIndex: 1, nsScore: 40, contract: null, tricks: null }],
      actions: [{ type: "bid", seat: "north", bid: "pass" }, { type: "bid", seat: "east", bid: "pass" }, { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "pass" }], contract: null, tricks: null, nsScore: 0 };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    const { container } = render(<BenchmarkReplay baseUrl="https://x.test" jobId="job1" tableIndex={0} boardIndex={0} />);
    expect(await screen.findByRole("region", { name: "Benchmark deal replay" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Play as Timid Tess · v1" }).getAttribute("href")).toContain("#/benchmark/practice/job1/0/0/tess/v1");
    expect(container.querySelectorAll(".table-card")).toHaveLength(0);
    const user = userEvent.setup();
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole("button", { name: "Next action" }));
    expect(container.querySelectorAll(".table-card")).toHaveLength(52);
  });
});
