import { useCallback, useEffect, useRef, useState } from "react";
import type { StorageLike } from "@contractplay/persistence";
import { MAX_PLAYER_NAME, type SeatInfo, type TableScoring, type TableStyle, type TableSummary } from "@contractplay/protocol";
import { seatNames, seats } from "../table/labels.js";
import { boardSetFromPbn } from "../boardSet.js";
import { loadSoloSetup, saveSoloSetup, type SoloSetup } from "../soloSetup.js";
import { createSession as defaultCreateSession, createTable as defaultCreateTable, listTables as defaultListTables } from "./connection.js";
import type { SessionBoardInput } from "./connection.js";
import { loadIdentity, saveIdentity, type Identity } from "./identity.js";
import { currentAccount, requestMagicLink, signOut, updateDisplayName, type AccountSession } from "./auth.js";

import { syncOnlineHands } from "./handHistory.js";

const REFRESH_MS = 5000;
/** How the lobby names a table's scoring; lobby entries from before rubber tables have none and keep running totals. */
const scoringNames: Record<TableScoring, string> = { rubber: "Rubber bridge", duplicate: "Running totals" };

function fileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("File is not text"));
    reader.readAsText(file);
  });
}

export type LobbyApi = {
  listTables(baseUrl: string): Promise<TableSummary[]>;
  createTable: typeof defaultCreateTable;
  createSession: typeof defaultCreateSession;
};

export type LobbyProps = {
  baseUrl: string;
  storage: StorageLike;
  onOpenTable(id: string): void;
  /** Opens solo play and deals at once, with the setup the Play panel just saved. */
  onPlaySolo(): void;
  /** Opens the device's recent hands, solo and online alike. */
  onRecentHands(): void;
  api?: LobbyApi;
  auth?: { currentAccount: typeof currentAccount; requestMagicLink: typeof requestMagicLink; signOut: typeof signOut; updateDisplayName?: typeof updateDisplayName; syncHistory?: typeof syncOnlineHands };
};

const defaultApi: LobbyApi = { listTables: defaultListTables, createTable: defaultCreateTable, createSession: defaultCreateSession };

function createErrorText(error: string): string {
  if (error === "too-many-tables") return "There are too many open tables right now. Try again later.";
  if (error === "too-many-requests") return "Limit: 10 tables per public IP in a rolling hour. Removing tables doesn't reset it; try again later.";
  return "Couldn't create the table. Try again.";
}

function seatLabel(seat: SeatInfo): string {
  return seat.kind === "human" ? seat.name : seat.kind === "bot" ? "Bot" : "Open";
}

const defaultAuth = { currentAccount, requestMagicLink, signOut, updateDisplayName, syncHistory: syncOnlineHands };

export function Lobby({ baseUrl, storage, onOpenTable, onPlaySolo, onRecentHands, api = defaultApi, auth = defaultAuth }: LobbyProps) {
  const [identity] = useState<Identity | undefined>(() => loadIdentity(storage));
  const [account, setAccount] = useState<AccountSession | null>(null);
  const [accountResolved, setAccountResolved] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  useEffect(() => {
    let active = true;
    void auth.currentAccount().then((session) => {
      if (!active) return;
      setAccount(session);
      setAccountResolved(true);
      if (session && auth.syncHistory) void auth.syncHistory(storage, session).catch(() => { if (active) setHistoryError(true); });
    }).catch(() => { if (active) setAccountResolved(true); });
    return () => { active = false; };
  }, [storage, auth]);

  if (!accountResolved) return <main className="app-shell"><section className="empty-table lobby" aria-label="Loading account"><span className="brand"><span className="brand-mark">C</span>ContractPlay</span></section></main>;
  if (!account) return <EmailGate identity={identity} requestLink={auth.requestMagicLink} />;
  return <>
    {historyError ? <p className="error-message" role="status">Online history could not sync. Your local hands are still available; reopen Recent hands to retry.</p> : null}
    {signOutError ? <p className="error-message" role="alert">Couldn't sign out. Try again.</p> : null}
    <LobbyTables identity={{ name: account.displayName }} baseUrl={baseUrl} api={api} storage={storage} onOpenTable={onOpenTable} onPlaySolo={onPlaySolo} onRecentHands={onRecentHands}
      account={account} onRename={async (name) => setAccount(await (auth.updateDisplayName ?? updateDisplayName)(name))} onSignOut={() => {
        void auth.signOut().then(() => { setAccount(null); setSignOutError(false); }).catch(() => setSignOutError(true));
      }} />
  </>;
}

export function EmailGate({ identity, onBack, initialEmail = "", initialSent = false, requestLink = requestMagicLink }: {
  identity: Identity | undefined; onBack?(): void; initialEmail?: string; initialSent?: boolean;
  requestLink?: typeof requestMagicLink;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(initialSent);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function submit() {
    setPending(true); setError(false);
    try { await requestLink(email.trim(), identity?.secret, identity?.name); setSent(true); }
    catch { setError(true); }
    finally { setPending(false); }
  }
  return <main className="app-shell"><section className="empty-table lobby" aria-label="Email sign-in">
    <div className="start-bar"><span className="brand"><span className="brand-mark">C</span>ContractPlay</span></div>
    <form className="lobby-panel" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {sent ? <p role="status">Check your email for a sign-in link.</p> : <>
        <label>Email<input type="email" aria-label="Email" value={email} required autoFocus onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={pending || !email.trim()}>Send sign-in link</button>
        {error ? <p className="error-message" role="alert">Couldn't request a link. Try again.</p> : null}
      </>}
      {onBack ? <button className="secondary-button" type="button" onClick={onBack}>Back</button> : null}
    </form>
  </section></main>;
}

/** The online name form: saves the display name (keeping the device secret) and hands back the identity. */
export function NameGate({ storage, initialName = "", onSaved, secondary, onSignIn }: {
  storage: StorageLike; initialName?: string; onSaved(identity: Identity): void; secondary: { label: string; onClick(): void }; onSignIn?(): void;
}) {
  const [nameDraft, setNameDraft] = useState(initialName);
  const submit = () => {
    const name = nameDraft.trim();
    if (name !== "") onSaved(saveIdentity(storage, name));
  };
  return (
    <main className="app-shell">
      <section className="empty-table lobby" aria-label="Choose a name">
        <div className="start-bar"><span className="brand"><span className="brand-mark">C</span>ContractPlay</span></div>
        <form className="lobby-panel" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <label>Your name<input aria-label="Your name" value={nameDraft} maxLength={20} autoFocus onChange={(event) => setNameDraft(event.target.value)} /></label>
          <button className="primary-button" type="submit" disabled={nameDraft.trim() === ""}>Continue</button>
          {onSignIn ? <button className="secondary-button" type="button" onClick={onSignIn}>Sign in or register</button> : null}
          <button className="secondary-button" type="button" onClick={secondary.onClick}>{secondary.label}</button>
        </form>
      </section>
    </main>
  );
}

/** The lobby's account name: shown with a Change name button that opens an inline rename form. */
function AccountName({ name, onRename }: { name: string; onRename(name: string): Promise<void> }) {
  const [draft, setDraft] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const close = () => { setDraft(undefined); setError(false); };
  async function save() {
    const next = draft?.trim() ?? "";
    if (next === "" || saving) return;
    setSaving(true); setError(false);
    try { await onRename(next); close(); }
    catch { setError(true); }
    finally { setSaving(false); }
  }
  if (draft === undefined) {
    return <><span>Signed in as {name}</span><button className="secondary-button" type="button" onClick={() => setDraft(name)}>Change name</button></>;
  }
  return <form className="table-tools-row" aria-label="Change name" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <input aria-label="New name" value={draft} maxLength={MAX_PLAYER_NAME} autoFocus onChange={(event) => setDraft(event.target.value)} />
    <button className="primary-button" type="submit" disabled={saving || draft.trim() === ""}>Save name</button>
    <button className="secondary-button" type="button" onClick={close}>Cancel</button>
    {error ? <span className="error-message" role="alert">Couldn't change your name. Try again.</span> : null}
  </form>;
}

function LobbyTables({ identity, baseUrl, storage, api, onOpenTable, onPlaySolo, onRecentHands, account, onRename, onSignOut }: {
  identity: { name: string }; baseUrl: string; storage: StorageLike; api: LobbyApi; onOpenTable(id: string): void; onPlaySolo(): void; onRecentHands(): void;
  account: AccountSession; onRename(name: string): Promise<void>; onSignOut(): void;
}) {
  const [tables, setTables] = useState<TableSummary[] | undefined>();
  const [listError, setListError] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [tableName, setTableName] = useState<string | undefined>();
  const [style, setStyle] = useState<TableStyle>("SAYC");
  const [scoring, setScoring] = useState<TableScoring>("rubber");
  const [listed, setListed] = useState(true);
  const [mode, setMode] = useState<"bots" | "people">("bots");
  // The Play panel always starts solo against bots, whatever solo was last left at.
  const [soloSetup, setSoloSetup] = useState<SoloSetup>(() => ({ ...loadSoloSetup(storage), opponents: "bots" }));
  const [sessionStyle, setSessionStyle] = useState<TableStyle>("SAYC");
  const [sessionTables, setSessionTables] = useState(2);
  const [sessionBoards, setSessionBoards] = useState(8);
  const [sessionScoring, setSessionScoring] = useState<"matchpoints" | "imps">("matchpoints");
  const [importedBoards, setImportedBoards] = useState<{ fileName: string; boards: SessionBoardInput[]; skipped: number }>();
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  const creatingNow = useRef(false);
  const mounted = useRef(true);
  const apiRef = useRef(api);
  apiRef.current = api;

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await apiRef.current.listTables(baseUrl);
      if (mounted.current) { setTables(result); setListError(false); }
    } catch {
      if (mounted.current) { setListError(true); setCreateError(undefined); }
    } finally {
      inFlight.current = false;
    }
  }, [baseUrl]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  const effectiveName = tableName ?? `${identity.name}'s table`;

  async function create() {
    const name = effectiveName.trim();
    if (name === "" || creatingNow.current) return;
    creatingNow.current = true;
    setCreating(true);
    setCreateError(undefined);
    let result: { id: string } | { error: string };
    try {
      result = await api.createTable(baseUrl, { name, style, scoring, listed });
    } catch {
      result = { error: "failed" };
    }
    creatingNow.current = false;
    if (!mounted.current) return;
    setCreating(false);
    if ("id" in result) onOpenTable(result.id);
    else { setListError(false); setCreateError(createErrorText(result.error)); }
  }

  function chooseSolo(change: Partial<SoloSetup>) {
    setSoloSetup((current) => ({ ...current, ...change }));
  }

  // Me and bots never reaches the table server: solo deals on this device with the setup saved here.
  function play() {
    if (mode === "people") { void create(); return; }
    saveSoloSetup(storage, soloSetup);
    onPlaySolo();
  }

  async function createDuplicateSession() {
    const name = `${identity.name}'s duplicate`.slice(0, 40);
    if (creatingNow.current) return;
    creatingNow.current = true;
    setCreating(true);
    setCreateError(undefined);
    let result: Awaited<ReturnType<typeof defaultCreateSession>>;
    try { result = await api.createSession(baseUrl, { name, style: sessionStyle, tableCount: sessionTables, boardCount: importedBoards?.boards.length ?? sessionBoards,
      scoring: sessionScoring, listed: true, ...(importedBoards ? { boards: importedBoards.boards } : {}) }); }
    catch { result = { error: "failed" }; }
    creatingNow.current = false;
    if (!mounted.current) return;
    setCreating(false);
    if (!("error" in result) && result.tableIds.length > 0) {
      void refresh();
      onOpenTable(result.tableIds[0]!);
    } else {
      setListError(false);
      setCreateError(createErrorText("error" in result ? result.error : "failed"));
    }
  }

  async function loadSessionPbn(file: File | undefined) {
    setCreateError(undefined);
    if (!file) { setImportedBoards(undefined); return; }
    let parsed: ReturnType<typeof boardSetFromPbn>;
    try { parsed = boardSetFromPbn(await fileText(file)); }
    catch { setImportedBoards(undefined); setCreateError("Couldn't read that PBN file."); return; }
    if (!parsed.set) {
      setImportedBoards(undefined);
      setCreateError("No readable boards were found in that PBN file.");
      return;
    }
    if (parsed.set.records.length > 32) {
      setImportedBoards(undefined);
      setCreateError("An online session can import at most 32 boards.");
      return;
    }
    const boards = parsed.set.records.map((record, index) => {
      const labelNumber = Number(record.board);
      return { number: Number.isSafeInteger(labelNumber) && labelNumber > 0 ? labelNumber : index + 1,
        deal: record.deal, dealer: record.dealer, vulnerability: record.vulnerability };
    });
    setImportedBoards({ fileName: file.name, boards, skipped: parsed.skipped });
  }

  // Whichever failed most recently wins: each failure clears the other.
  const alert = createError ?? (listError ? "Can't reach the tables right now." : undefined);

  return (
    <main className="app-shell">
      <section className="empty-table lobby" aria-label="Online tables">
        <div className="start-bar">
          <span className="brand"><span className="brand-mark">C</span>ContractPlay</span>
          <span className="table-tools-row">
            <AccountName name={account.displayName} onRename={onRename} /><button className="secondary-button" type="button" onClick={onSignOut}>Sign out</button>
            <button className="secondary-button" type="button" onClick={onRecentHands}>Recent hands</button>
          </span>
        </div>
        <form className="lobby-panel" aria-label="Play" onSubmit={(event) => { event.preventDefault(); play(); }}>
          <h2>Play</h2>
          <div className="lobby-choice" role="radiogroup" aria-label="Who's playing">
            <label className="lobby-check"><input type="radio" name="play-mode" checked={mode === "bots"} onChange={() => { setCreateError(undefined); setMode("bots"); }} />Me and bots</label>
            <label className="lobby-check"><input type="radio" name="play-mode" checked={mode === "people"} onChange={() => { setCreateError(undefined); setMode("people"); }} />With other people</label>
          </div>
          {mode === "bots" ? <>
            <label>Your seat<select aria-label="Your seat" value={soloSetup.seat} onChange={(event) => chooseSolo({ seat: event.target.value as SoloSetup["seat"] })}>{seats.map((seat) => <option key={seat} value={seat}>{seatNames[seat]}</option>)}</select></label>
            <label>Bot skill<select aria-label="Bot skill" value={soloSetup.botSkill} onChange={(event) => chooseSolo({ botSkill: event.target.value as SoloSetup["botSkill"] })}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select></label>
            <label>Bidding style<select aria-label="Bidding style" value={soloSetup.biddingStyle} onChange={(event) => chooseSolo({ biddingStyle: event.target.value as SoloSetup["biddingStyle"] })}><option value="SAYC">SAYC</option><option value="2/1">2/1</option></select></label>
            <label>Scoring<select aria-label="Scoring" value={soloSetup.scoring} onChange={(event) => chooseSolo({ scoring: event.target.value as SoloSetup["scoring"] })}><option value="rubber">Rubber bridge</option><option value="single">Single deals</option></select></label>
          </> : <>
            <label>Table name<input aria-label="Table name" value={effectiveName} maxLength={40} onChange={(event) => { setCreateError(undefined); setTableName(event.target.value); }} /></label>
            <label>Bidding style<select aria-label="Bidding style" value={style} onChange={(event) => { setCreateError(undefined); setStyle(event.target.value as TableStyle); }}><option value="SAYC">SAYC</option><option value="2/1">2/1</option></select></label>
            <label>Scoring<select aria-label="Scoring" value={scoring} onChange={(event) => { setCreateError(undefined); setScoring(event.target.value as TableScoring); }}><option value="rubber">{scoringNames.rubber}</option><option value="duplicate">{scoringNames.duplicate}</option></select></label>
            <label className="lobby-check"><input type="checkbox" aria-label="Show in lobby" checked={listed} onChange={(event) => { setCreateError(undefined); setListed(event.target.checked); }} />Show in lobby</label>
          </>}
          <button className="primary-button" type="submit" disabled={mode === "people" && (creating || effectiveName.trim() === "")}>Play</button>
        </form>
        <div className="lobby-panel">
          <div className="section-heading">
            <h2>Open tables</h2>
            <button className="secondary-button" type="button" onClick={() => { void refresh(); }}>Refresh</button>
          </div>
          {tables?.length === 0 ? <p className="quiet-copy">No open tables yet. Create one to start.</p> : null}
          <ul className="lobby-tables">
            {(tables ?? []).map((table) => (
              <li key={table.id} className="lobby-table">
                <div className="lobby-table-head">
                  <strong>{table.name}</strong>
                  <span className="quiet-copy">{table.style} · {scoringNames[table.scoring ?? "duplicate"]}</span>
                  {table.handInProgress ? <span className="lobby-playing">Playing</span> : null}
                </div>
                <ul className="lobby-seats">
                  {seats.map((seat) => (
                    <li key={seat}><span className="quiet-copy">{seatNames[seat]}</span> <span>{seatLabel(table.seats[seat])}</span></li>
                  ))}
                </ul>
                <button className="secondary-button" type="button" aria-label={`Join ${table.name}`} onClick={() => onOpenTable(table.id)}>Join</button>
              </li>
            ))}
          </ul>
        </div>

        <form className="lobby-panel" aria-label="New duplicate session" onSubmit={(event) => { event.preventDefault(); void createDuplicateSession(); }}>
          <h2>New duplicate session</h2>
          <label>Tables<select aria-label="Session tables" value={sessionTables} onChange={(event) => setSessionTables(Number(event.target.value))}>{[2, 3, 4, 6, 8].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label>Boards<select aria-label="Session boards" disabled={!!importedBoards} value={sessionBoards} onChange={(event) => setSessionBoards(Number(event.target.value))}>{[4, 8, 12, 16, 24, 32].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label>Scoring method<select aria-label="Session scoring" value={sessionScoring} onChange={(event) => setSessionScoring(event.target.value as "matchpoints" | "imps")}><option value="matchpoints">Matchpoints</option><option value="imps">Cross-IMPs</option></select></label>
          <label>Session bidding style<select aria-label="Session bidding style" value={sessionStyle} onChange={(event) => setSessionStyle(event.target.value as TableStyle)}><option value="SAYC">SAYC</option><option value="2/1">2/1</option></select></label>
          <label>PBN board set<input aria-label="PBN board set" type="file" accept=".pbn,text/plain" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void loadSessionPbn(file); }} /></label>
          {importedBoards ? <p className="quiet-copy">Loaded {importedBoards.boards.length} board{importedBoards.boards.length === 1 ? "" : "s"} from {importedBoards.fileName}{importedBoards.skipped ? ` · skipped ${importedBoards.skipped} unreadable` : ""}. Only deal and board details are sent. <button className="secondary-button" type="button" onClick={() => setImportedBoards(undefined)}>Remove PBN set</button></p> : null}
          <p className="quiet-copy">Session tables appear in the open lobby so players can join different tables.</p>
          <button className="primary-button" type="submit" disabled={creating}>Create session</button>
        </form>
        {alert ? <p className="error-message" role="alert">{alert}</p> : null}
      </section>
    </main>
  );
}
