// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BenchmarkAdmin } from "./BenchmarkAdmin.js";

vi.mock("../doubleDummy.js", () => ({ calculateDoubleDummyBaseline: vi.fn(async () => ({ source: "bridge-dds-1.4.0", parNS: 0, tricks: Array.from({ length: 5 }, () => [7, 7, 7, 7]) })) }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("BenchmarkAdmin", () => {
  it("manages profiles, cohorts, scheduled jobs and resumable DD analysis using the signed-in session", async () => {
    const bots = ["timid", "rookie", "eager", "careful", "bold"];
    const profiles = bots.map((profileId) => ({ profile: { profileId, version: "v1", skill: "beginner", aggression: "conservative", biddingStyle: "SAYC", engineVersion: "build-1" }, status: "active" }));
    const profile = profiles[0]!;
    let cohort = { id: "pool", name: "Main", profiles: profiles.slice(0, 4).map(({ profile }) => ({ profileId: profile.profileId, version: "v1" })), boardCount: 1, maxTables: 2, biddingStyle: "SAYC", scoring: "imps", rotationSeed: 4, intervalMinutes: 60 };
    let jobStatus = "running";
    const job = { id: "job1", status: jobStatus, roundIndex: 0, cohortId: "pool", cohort, profiles: profiles.map(({ profile }) => profile) };
    const completed = { ...job, id: "job2", status: "completed" };
    let analyzed = false;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = input.toString();
      if (path.endsWith("/profiles") && !init?.method) return Response.json({ profiles });
      if (path.endsWith("/cohorts") && !init?.method) return Response.json({ cohorts: [cohort] });
      if (path.endsWith("/jobs") && !init?.method) return Response.json({ jobs: [{ ...job, status: jobStatus }, completed, { ...job, id: "job3", roundIndex: 1, status: "failed" }] });
      if (path.endsWith("/imports") && !init?.method) return Response.json({ imports: [{ id: "private-set", boardCount: 5 }] });
      if (path.includes("double-dummy") && init?.method === "POST") { analyzed = true; return Response.json({ analyzed: true }, { status: 201 }); }
      if (path.includes("double-dummy")) return Response.json(analyzed ? { analyzed: true } : { analyzed: false, board: {} });
      if (path.endsWith("/profiles") && init?.method === "POST") return Response.json(profile, { status: 201 });
      if (path.endsWith("/profiles/timid/v1") && init?.method === "DELETE") { profiles[0] = { ...profile, status: "retired" }; return new Response(null, { status: 204 }); }
      if (path.endsWith("/jobs") && init?.method === "POST") return Response.json({ ...job, id: "next" }, { status: 201 });
      if (path.endsWith("/cohorts/pool") && init?.method === "PUT") { cohort = { ...cohort, ...JSON.parse(String(init.body)) }; return Response.json(cohort); }
      if (path.endsWith("/jobs/job1/pause")) { jobStatus = "paused"; return Response.json({ ...job, status: jobStatus }); }
      if (path.endsWith("/jobs/job1/resume")) { jobStatus = "running"; return Response.json({ ...job, status: jobStatus }); }
      if (path.endsWith("/jobs/job1/cancel")) { jobStatus = "cancelled"; return Response.json({ ...job, status: jobStatus }); }
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<BenchmarkAdmin baseUrl="https://x.test" />);
    // Profiles, Cohorts and Jobs are boxes of their own, in that order.
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Profiles", "Cohorts", "Jobs"]);
    expect(await screen.findByText("timid · v1")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add profile" }));
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await user.click(screen.getByRole("button", { name: "Create cohort" }));
    await user.selectOptions(screen.getByLabelText("PBN board set"), "private-set");
    await user.click(screen.getAllByRole("button", { name: "Create cohort" }).filter((button) => button.textContent === "Create cohort")[1]!);
    expect((await screen.findByRole("alert")).textContent).toContain("contains 5 boards");
    expect(fetcher.mock.calls.some(([url, init]) => url.toString().endsWith("/cohorts") && init?.method === "POST")).toBe(false);
    await user.clear(screen.getByRole("spinbutton", { name: "Boards" }));
    await user.type(screen.getByRole("spinbutton", { name: "Boards" }), "5");
    await user.click(screen.getAllByRole("button", { name: "Create cohort" }).filter((button) => button.textContent === "Create cohort")[1]!);
    await user.click(screen.getAllByRole("button", { name: "Retire profile" })[0]!);
    expect((await screen.findAllByText("retired", { exact: false })).length).toBe(2);
    await user.click(screen.getByRole("button", { name: "Edit cohort" }));
    expect(screen.getByText(/1 retired profile version is excluded/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "bold · v1 · SAYC" }));
    await user.clear(screen.getByRole("textbox", { name: "Cohort name" }));
    await user.type(screen.getByRole("textbox", { name: "Cohort name" }), "Updated Main");
    await user.click(screen.getByRole("button", { name: "Save cohort" }));
    await user.click(screen.getByRole("button", { name: "Start job for Updated Main" }));
    await user.click(screen.getByRole("button", { name: "Analyze completed job job2" }));
    // A job action's message shows in the Jobs box, not the others.
    const jobsBox = screen.getByRole("region", { name: "Benchmark jobs" });
    await user.click(within(jobsBox).getByRole("button", { name: "Pause job job1" }));
    expect((await within(jobsBox).findByRole("status")).textContent).toBe("Job paused.");
    expect(within(screen.getByRole("region", { name: "Benchmark cohorts" })).queryByRole("status")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Resume job job1" }));
    await user.click(screen.getByRole("button", { name: "Cancel job job1" }));
    await user.click(screen.getByRole("button", { name: "Retry job job3" }));
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/jobs/job1/pause"), expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/profiles"), expect.objectContaining({ method: "POST" }));
    expect(fetcher.mock.calls.some(([url, init]) => url.toString().endsWith("/cohorts/pool") && init?.method === "PUT")).toBe(true);
    const savedCohort = fetcher.mock.calls.find(([url, init]) => url.toString().endsWith("/cohorts/pool") && init?.method === "PUT")?.[1];
    expect(JSON.parse(String(savedCohort?.body)).profiles.map((entry: { profileId: string }) => entry.profileId)).toContain("bold");
    expect(JSON.parse(String(savedCohort?.body)).profiles.map((entry: { profileId: string }) => entry.profileId)).not.toContain("timid");
    const manualStarts = fetcher.mock.calls.filter(([url, init]) => url.toString().endsWith("/jobs") && init?.method === "POST");
    expect(manualStarts.length).toBeGreaterThanOrEqual(2);
    expect(manualStarts.every(([, init]) => JSON.parse(String(init!.body)).roundIndex === undefined)).toBe(true);
    expect(fetcher.mock.calls.some(([url, init]) => url.toString().endsWith("/profiles/timid/v1") && init?.method === "DELETE")).toBe(true);
  });

  it("keeps benchmark controls hidden unless the protected admin endpoint accepts the session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    render(<BenchmarkAdmin baseUrl="https://x.test" />);
    expect((await screen.findByRole("alert")).textContent).toContain("allowlisted benchmark administrator");
    expect(screen.queryByRole("button", { name: "Start job" })).toBeNull();
  });

  it("loads exact older active cohort versions before deciding which members retired", async () => {
    const profile = (profileId: string, version = "v1") => ({ profile: { profileId, version, skill: "beginner", aggression: "normal", biddingStyle: "SAYC", engineVersion: "build-1" }, status: "active" });
    const recent = Array.from({ length: 25 }, (_, index) => profile(`recent-${index}`));
    const old = profile("older-profile");
    const cohort = { id: "old-pool", name: "Older cohort", profiles: [old, ...recent.slice(0, 3)].map(({ profile: item }) => ({ profileId: item.profileId, version: item.version })), boardCount: 1, maxTables: 2, biddingStyle: "SAYC", scoring: "imps", rotationSeed: 1, importId: null, intervalMinutes: null };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = input.toString();
      if (path.endsWith("/profiles")) return Response.json({ profiles: recent });
      if (path.endsWith("/profiles/older-profile/v1")) return Response.json(old);
      if (path.endsWith("/cohorts")) return Response.json({ cohorts: [cohort] });
      if (path.endsWith("/jobs")) return Response.json({ jobs: [] });
      if (path.endsWith("/imports")) return Response.json({ imports: [] });
      return Response.json({});
    });
    vi.stubGlobal("fetch", fetcher);
    render(<BenchmarkAdmin baseUrl="https://x.test" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Edit cohort" }));
    expect((await screen.findByRole("checkbox", { name: "older-profile · v1 · SAYC" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(/retired profile/)).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/profiles/older-profile/v1"), expect.objectContaining({ credentials: "same-origin" }));
  });

  it("says when a saved profile version already exists instead of claiming it was added", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = input.toString();
      if (init?.method === "POST") { calls += 1; return calls === 1 ? Response.json({}, { status: 201 }) : calls === 2 ? Response.json({}, { status: 200 }) : Response.json({}, { status: 409 }); }
      return Response.json(path.endsWith("/profiles") ? { profiles: [] } : path.endsWith("/cohorts") ? { cohorts: [] } : path.endsWith("/jobs") ? { jobs: [] } : { imports: [] });
    }));
    render(<BenchmarkAdmin baseUrl="https://x.test" />);
    await screen.findByRole("heading", { name: "Profiles" });
    const user = userEvent.setup();
    const save = async () => {
      await user.click(screen.getByRole("button", { name: "Add profile" }));
      await user.click(screen.getByRole("button", { name: "Save profile" }));
    };
    await save();
    expect(await screen.findByText("Profile version saved.")).toBeTruthy();
    await save();
    expect(await screen.findByText(/A beginner · normal profile v1 already exists; nothing was added/)).toBeTruthy();
    expect(screen.queryByText("Profile version saved.")).toBeNull();
    await save();
    expect((await screen.findByRole("alert")).textContent).toContain("already exists with other settings. Save it under a new version.");
  });
});
