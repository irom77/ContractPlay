import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { calculateDoubleDummyBaseline } from "../doubleDummy.js";
import { analyzeBenchmarkJob } from "../online/benchmarkAnalysis.js";

type Profile = { profile: { profileId: string; version: string; skill: string; aggression: string; biddingStyle: string; engineVersion: string }; status: string };
type Cohort = { id: string; name: string; profiles: { profileId: string; version: string }[]; boardCount: number; maxTables: number; biddingStyle: string; scoring: string; rotationSeed: number; importId: string | null; intervalMinutes: number | null };
type Job = { id: string; status: string; roundIndex: number; cohortId: string; cohort: Cohort; profiles: Profile["profile"][] };
const prefix = "/api/admin/benchmarks";
const jsonHeaders = { "Content-Type": "application/json" };

/** Protected benchmark controls are separate from the legacy open table-removal page. */
export type BenchmarkTab = "profiles" | "cohorts" | "jobs";

/**
 * Benchmark operations as three /admin boxes: profiles, cohorts (with PBN board sets), and jobs. With `tab`, only that
 * box shows (none for another admin tab); without it, all three do.
 */
export function BenchmarkAdmin({ baseUrl, tab }: { baseUrl: string; tab?: string }) {
  const api = baseUrl.replace(/\/+$/, "");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [imports, setImports] = useState<{ id: string; boardCount: number }[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [messageBox, setMessageBox] = useState<BenchmarkTab>("profiles");
  const [busy, setBusy] = useState(false);
  const [profileForm, setProfileForm] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ skill: "beginner", aggression: "normal", biddingStyle: "SAYC", version: "v1", engineVersion: "contractplay-bots-v1" });
  const [cohortForm, setCohortForm] = useState(false);
  const [editingCohort, setEditingCohort] = useState<string>();
  const [unavailableCohortMembers, setUnavailableCohortMembers] = useState(0);
  const [cohortDraft, setCohortDraft] = useState({ name: "Main", profileKeys: [] as string[], boardCount: 8, maxTables: 2, biddingStyle: "SAYC", scoring: "imps", rotationSeed: 1, importId: "", intervalMinutes: "" });
  const pendingJobIds = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [p, c, j, i] = await Promise.all([
        fetch(`${api}${prefix}/profiles`, { credentials: "same-origin" }),
        fetch(`${api}${prefix}/cohorts`, { credentials: "same-origin" }),
        fetch(`${api}${prefix}/jobs`, { credentials: "same-origin" }),
        fetch(`${api}${prefix}/imports`, { credentials: "same-origin" })
      ]);
      const denied = [p, c, j, i].find((response) => response.status === 401 || response.status === 403);
      if (denied) { setAuthorized(false); setError(denied.status === 401 ? "Sign in with an allowlisted benchmark administrator account." : "Your account is not an allowlisted benchmark administrator."); return; }
      if ([p, c, j, i].some((response) => !response.ok)) throw new Error("Request failed");
      setProfiles((await p.json() as { profiles: Profile[] }).profiles);
      setCohorts((await c.json() as { cohorts: Cohort[] }).cohorts);
      setJobs((await j.json() as { jobs: Job[] }).jobs);
      setImports((await i.json() as { imports: { id: string; boardCount: number }[] }).imports);
      setAuthorized(true);
    } catch { setError("Couldn't load benchmark operations. Check the service and try again."); }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  // A message belongs to the box it came from; switching tabs clears it.
  useEffect(() => { setNotice(""); }, [tab]);

  async function request(path: string, method = "POST", body?: unknown) {
    const response = await send(path, method, body);
    return response.status === 204 ? undefined : response.json();
  }
  async function send(path: string, method = "POST", body?: unknown) {
    const response = await fetch(`${api}${prefix}${path}`, { method, credentials: "same-origin", ...(body === undefined ? {} : { headers: jsonHeaders, body: JSON.stringify(body) }) });
    if (response.status === 401 || response.status === 403) { setAuthorized(false); throw new Error(response.status === 401 ? "Sign in with an allowlisted benchmark administrator account." : "Your account is not an allowlisted benchmark administrator."); }
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response;
  }
  async function mutate(work: () => Promise<unknown>, message: string | ((value: unknown) => string)) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await work(); await refresh(); setNotice(typeof message === "function" ? message(result) : message); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Benchmark operation failed."); return false; }
    finally { setBusy(false); }
  }
  async function startJob(operationKey: string, cohortId: string, message: string) {
    const id = pendingJobIds.current.get(operationKey) ?? crypto.randomUUID();
    pendingJobIds.current.set(operationKey, id);
    if (await mutate(() => request("/jobs", "POST", { id, cohortId }), message)) pendingJobIds.current.delete(operationKey);
  }
  async function addProfile() {
    const { skill, aggression, version } = profileDraft;
    await mutate(async () => {
      try { return (await send("/profiles", "POST", profileDraft)).status; }
      catch (cause) {
        if (cause instanceof Error && cause.message === "Request failed (409)") throw new Error(`A ${skill} · ${aggression} profile ${version} already exists with other settings. Save it under a new version.`);
        throw cause;
      }
    },
      (status) => status === 201 ? "Profile version saved." : `A ${skill} · ${aggression} profile ${version} already exists; nothing was added. Change the skill or aggressiveness, or use a new version.`);
    setProfileForm(false);
  }
  async function addCohort() {
    if (cohortDraft.profileKeys.length < 4) { setError("Select at least four active profiles for a cohort."); return; }
    const imported = imports.find((item) => item.id === cohortDraft.importId);
    if (imported && imported.boardCount !== Number(cohortDraft.boardCount)) { setError(`This PBN board set contains ${imported.boardCount} boards. Set the cohort board count to ${imported.boardCount}.`); return; }
    const value = { name: cohortDraft.name, profiles: cohortDraft.profileKeys.map((key) => { const [profileId, version] = key.split("\u0000"); return { profileId, version }; }), boardCount: Number(cohortDraft.boardCount), maxTables: Number(cohortDraft.maxTables), biddingStyle: cohortDraft.biddingStyle, scoring: cohortDraft.scoring, rotationSeed: Number(cohortDraft.rotationSeed), importId: cohortDraft.importId || null, intervalMinutes: cohortDraft.intervalMinutes ? Number(cohortDraft.intervalMinutes) : null };
    await mutate(() => request(`/cohorts${editingCohort ? `/${editingCohort}` : ""}`, editingCohort ? "PUT" : "POST", value), editingCohort ? "Cohort updated." : "Cohort created.");
    setCohortForm(false); setEditingCohort(undefined);
  }
  async function editCohort(cohort: Cohort) {
    const profileKeys = cohort.profiles.map(({ profileId, version }) => `${profileId}\u0000${version}`);
    const knownKeys = new Set(profiles.map(({ profile }) => `${profile.profileId}\u0000${profile.version}`));
    try {
      const missingProfiles = await Promise.all(profileKeys.filter((key) => !knownKeys.has(key)).map(async (key) => {
        const [profileId, version] = key.split("\u0000");
        const response = await fetch(`${api}${prefix}/profiles/${encodeURIComponent(profileId!)}/${encodeURIComponent(version!)}`, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Couldn't load every profile version in this cohort.");
        return await response.json() as Profile;
      }));
      const allProfiles = [...profiles, ...missingProfiles];
      setProfiles(allProfiles);
      const activeKeys = new Set(allProfiles.filter((item) => item.status === "active").map(({ profile }) => `${profile.profileId}\u0000${profile.version}`));
    setUnavailableCohortMembers(profileKeys.filter((key) => !activeKeys.has(key)).length);
    setEditingCohort(cohort.id); setCohortDraft({ name: cohort.name, profileKeys: profileKeys.filter((key) => activeKeys.has(key)), boardCount: cohort.boardCount, maxTables: cohort.maxTables, biddingStyle: cohort.biddingStyle, scoring: cohort.scoring, rotationSeed: cohort.rotationSeed, importId: cohort.importId ?? "", intervalMinutes: cohort.intervalMinutes?.toString() ?? "" }); setCohortForm(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't load cohort profiles."); }
  }
  async function uploadPbn(file?: File) {
    if (!file) return;
    await mutate(async () => {
      const response = await fetch(`${api}${prefix}/imports`, { method: "POST", credentials: "same-origin", body: await file.text() });
      if (!response.ok) throw new Error(`PBN upload failed (${response.status})`);
      return response.json();
    }, "PBN board set imported.");
  }
  async function analyze(job: Job) {
    await mutate(async () => {
      const count = Math.min(job.cohort.boardCount, 32);
      return analyzeBenchmarkJob(job.id, count, calculateDoubleDummyBaseline, (path, init) => fetch(`${api}${path}`, { ...init, credentials: "same-origin" }));
    }, (value) => { const result = value as { analyzed: number; existing: number; unavailable: number }; return `DD analysis: ${result.analyzed} analyzed, ${result.existing} already present, ${result.unavailable} unavailable.`; });
  }

  // A message shows in the box whose control was last used (with tabs, the one on screen).
  const messages = (id: BenchmarkTab) => (tab ?? messageBox) !== id ? null : <>
    {error ? <p className="error-message" role="alert">{error}</p> : null}
    {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
  </>;
  const refreshButton = <button className="secondary-button" type="button" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>;
  /** One admin box; `tab` set means only that tab's box shows, otherwise (as in tests) all three do. */
  const box = (id: BenchmarkTab, label: string, title: string, copy: string, actions: ReactNode, body: ReactNode) =>
    <section className="lobby-panel admin-panel" aria-label={label} hidden={tab !== undefined && tab !== id}
      onClickCapture={() => setMessageBox(id)} onChangeCapture={() => setMessageBox(id)}>
      <div className="section-heading"><div><h1>{title}</h1><p className="quiet-copy">{copy}</p></div><span className="admin-actions">{authorized ? actions : null}{refreshButton}</span></div>
      {messages(id)}
      {authorized ? body : null}
    </section>;

  return <>
    {box("profiles", "Benchmark profiles", "Profiles", "Bot profile versions that benchmark cohorts are built from.", <button className="secondary-button" type="button" onClick={() => setProfileForm((open) => !open)} disabled={busy}>Add profile</button>, <>
        {profileForm ? <form onSubmit={(event) => { event.preventDefault(); void addProfile(); }} className="benchmark-form">
          <label>Skill<select value={profileDraft.skill} onChange={(event) => setProfileDraft({ ...profileDraft, skill: event.target.value })}>{["beginner", "intermediate", "advanced", "expert"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Aggressiveness<select value={profileDraft.aggression} onChange={(event) => setProfileDraft({ ...profileDraft, aggression: event.target.value })}>{["conservative", "normal", "aggressive"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Bidding style<select value={profileDraft.biddingStyle} onChange={(event) => setProfileDraft({ ...profileDraft, biddingStyle: event.target.value })}>{["SAYC", "2/1"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Profile version<input aria-label="Profile version" value={profileDraft.version} onChange={(event) => setProfileDraft({ ...profileDraft, version: event.target.value })} /></label>
          <label>Engine version<input aria-label="Engine version" value={profileDraft.engineVersion} onChange={(event) => setProfileDraft({ ...profileDraft, engineVersion: event.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={busy}>Save profile</button>
        </form> : null}
        {profiles.map(({ profile, status }) => <div className="admin-table" key={`${profile.profileId}:${profile.version}`}><strong>{profile.profileId} · {profile.version}</strong><span>{profile.skill} · {profile.aggression} · {profile.biddingStyle} · engine {profile.engineVersion} · {status}</span>{status === "active" ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void mutate(() => request(`/profiles/${profile.profileId}/${profile.version}`, "DELETE"), "Profile retired; its history is retained.")}>Retire profile</button> : null}</div>)}
    </>)}
    {box("cohorts", "Benchmark cohorts", "Cohorts", "Duplicate cohorts: which profiles meet, on how many boards, and how often.", <button className="secondary-button" type="button" onClick={() => { setEditingCohort(undefined); setUnavailableCohortMembers(0); setCohortDraft({ name: "Main", profileKeys: profiles.filter((item) => item.status === "active").slice(0, 4).map(({ profile }) => `${profile.profileId}\u0000${profile.version}`), boardCount: 8, maxTables: 2, biddingStyle: "SAYC", scoring: "imps", rotationSeed: Date.now() >>> 0, importId: "", intervalMinutes: "" }); setCohortForm(true); }} disabled={busy}>Create cohort</button>, <>
        {cohortForm ? <form className="benchmark-form" onSubmit={(event) => { event.preventDefault(); void addCohort(); }}>
          {unavailableCohortMembers > 0 ? <p className="admin-notice">{unavailableCohortMembers} retired profile {unavailableCohortMembers === 1 ? "version is" : "versions are"} excluded. Select active replacement profiles before saving.</p> : null}
          <label>Cohort name<input value={cohortDraft.name} onChange={(event) => setCohortDraft({ ...cohortDraft, name: event.target.value })} /></label>
          <fieldset><legend>Profiles (select at least four)</legend>{profiles.filter((item) => item.status === "active").map(({ profile }) => { const key = `${profile.profileId}\u0000${profile.version}`; return <label key={key}><input type="checkbox" checked={cohortDraft.profileKeys.includes(key)} onChange={(event) => setCohortDraft({ ...cohortDraft, profileKeys: event.target.checked ? [...cohortDraft.profileKeys, key] : cohortDraft.profileKeys.filter((entry) => entry !== key) })} />{profile.profileId} · {profile.version} · {profile.biddingStyle}</label>; })}</fieldset>
          <label>Boards<input type="number" min={1} max={32} value={cohortDraft.boardCount} onChange={(event) => setCohortDraft({ ...cohortDraft, boardCount: Number(event.target.value) })} /></label>
          <label>Tables<input type="number" min={2} max={8} value={cohortDraft.maxTables} onChange={(event) => setCohortDraft({ ...cohortDraft, maxTables: Number(event.target.value) })} /></label>
          <label>Bidding style<select value={cohortDraft.biddingStyle} onChange={(event) => setCohortDraft({ ...cohortDraft, biddingStyle: event.target.value })}><option>SAYC</option><option>2/1</option></select></label>
          <label>Scoring<select value={cohortDraft.scoring} onChange={(event) => setCohortDraft({ ...cohortDraft, scoring: event.target.value })}><option value="imps">IMPs</option><option value="matchpoints">Matchpoints</option></select></label>
          <label>Rotation seed<input type="number" min={0} value={cohortDraft.rotationSeed} onChange={(event) => setCohortDraft({ ...cohortDraft, rotationSeed: Number(event.target.value) })} /></label>
          <label>PBN board set<select value={cohortDraft.importId} onChange={(event) => setCohortDraft({ ...cohortDraft, importId: event.target.value })}><option value="">Generated deals</option>{imports.map((item) => <option key={item.id} value={item.id}>{item.boardCount} boards · {item.id.slice(0, 12)}</option>)}</select></label>
          <label>Repeat every minutes (blank for manual)<input type="number" min={5} step={5} value={cohortDraft.intervalMinutes} onChange={(event) => setCohortDraft({ ...cohortDraft, intervalMinutes: event.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={busy}>{editingCohort ? "Save cohort" : "Create cohort"}</button><button className="secondary-button" type="button" onClick={() => setCohortForm(false)}>Cancel</button>
        </form> : null}
        {cohorts.map((cohort) => <div className="admin-table" key={cohort.id}><strong>{cohort.name}</strong><span>{cohort.boardCount} boards · {cohort.maxTables} tables · {cohort.scoring} · {cohort.biddingStyle} · {cohort.intervalMinutes ? `every ${cohort.intervalMinutes} min` : "manual"}</span><button className="secondary-button" type="button" onClick={() => void editCohort(cohort)}>Edit cohort</button><button className="secondary-button" type="button" aria-label={`Start job for ${cohort.name}`} disabled={busy} onClick={() => void startJob(`cohort:${cohort.id}`, cohort.id, "Job queued.")}>Start job</button></div>)}
      <section aria-label="Benchmark PBN uploads"><h2>Private PBN board sets</h2><label>Upload PBN<input aria-label="Upload PBN board set" type="file" accept=".pbn,text/plain" onChange={(event) => void uploadPbn(event.target.files?.[0])} /></label>{imports.map((item) => <p key={item.id}>{item.boardCount} boards · {item.id.slice(0, 12)}…</p>)}</section>
    </>)}
    {box("jobs", "Benchmark jobs", "Jobs", "Queued, running and finished benchmark rounds, newest first.", null, <>
        {jobs.map((job) => <div className="admin-table" key={job.id}><strong>{job.id} · {job.status}</strong><span>{job.cohort.name} · round {job.roundIndex} · {job.cohort.boardCount} boards</span>{job.status === "queued" || job.status === "running" ? <button className="secondary-button" aria-label={`Pause job ${job.id}`} onClick={() => void mutate(() => request(`/jobs/${job.id}/pause`), "Job paused.")}>Pause</button> : null}{job.status === "paused" ? <button className="secondary-button" aria-label={`Resume job ${job.id}`} onClick={() => void mutate(() => request(`/jobs/${job.id}/resume`), "Job resumed.")}>Resume</button> : null}{["queued", "running", "paused"].includes(job.status) ? <button className="secondary-button" aria-label={`Cancel job ${job.id}`} onClick={() => void mutate(() => request(`/jobs/${job.id}/cancel`), "Job cancelled.")}>Cancel</button> : null}{job.status === "failed" ? <button className="secondary-button" aria-label={`Retry job ${job.id}`} disabled={busy} onClick={() => void startJob(`retry:${job.id}`, job.cohortId, "Retry queued as a new round.")}>Retry as new round</button> : null}{job.status === "completed" ? <button className="secondary-button" aria-label={`Analyze completed job ${job.id}`} disabled={busy} onClick={() => void analyze(job)}>Analyze DD par and tricks</button> : null}</div>)}
      {jobs.length === 0 ? <p className="quiet-copy">No jobs yet.</p> : null}
    </>)}
  </>;
}
