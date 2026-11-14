import { useCallback, useEffect, useRef, useState } from "react";
import type { StorageLike } from "@contractplay/persistence";
import type { SeatInfo, TableScoring, TableStyle, TableSummary } from "@contractplay/protocol";
import { seatNames, seats } from "../table/labels.js";
import { createSession as defaultCreateSession, createTable as defaultCreateTable, listTables as defaultListTables } from "./connection.js";
import { loadIdentity, saveIdentity, type Identity } from "./identity.js";

const REFRESH_MS = 5000;
/** How the lobby names a table's scoring; lobby entries from before rubber tables have none and keep running totals. */
const scoringNames: Record<TableScoring, string> = { rubber: "Rubber bridge", duplicate: "Running totals" };

export type LobbyApi = {
  listTables(baseUrl: string): Promise<TableSummary[]>;
  createTable: typeof defaultCreateTable;
  createSession: typeof defaultCreateSession;
};

export type LobbyProps = {
  baseUrl: string;
  storage: StorageLike;
  onOpenTable(id: string): void;
  onSolo(): void;
  /** Opens the device's recent hands, solo and online alike. */
  onRecentHands(): void;
  api?: LobbyApi;
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

export function Lobby({ baseUrl, storage, onOpenTable, onSolo, onRecentHands, api = defaultApi }: LobbyProps) {
  const [identity, setIdentity] = useState<Identity | undefined>(() => loadIdentity(storage));
  const [editingName, setEditingName] = useState(false);

  if (!identity || editingName) {
    return <NameGate storage={storage} initialName={editingName ? identity?.name ?? "" : ""}
      onSaved={(saved) => { setIdentity(saved); setEditingName(false); }} secondary={{ label: "Solo play", onClick: onSolo }} />;
  }

  return <LobbyTables identity={identity} baseUrl={baseUrl} api={api} onOpenTable={onOpenTable} onSolo={onSolo} onRecentHands={onRecentHands}
    onChangeName={() => setEditingName(true)} />;
}

/** The online name form: saves the display name (keeping the device secret) and hands back the identity. */
export function NameGate({ storage, initialName = "", onSaved, secondary }: {
  storage: StorageLike; initialName?: string; onSaved(identity: Identity): void; secondary: { label: string; onClick(): void };
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
          <button className="secondary-button" type="button" onClick={secondary.onClick}>{secondary.label}</button>
        </form>
      </section>
    </main>
  );
}

function LobbyTables({ identity, baseUrl, api, onOpenTable, onSolo, onRecentHands, onChangeName }: {
  identity: Identity; baseUrl: string; api: LobbyApi; onOpenTable(id: string): void; onSolo(): void; onRecentHands(): void; onChangeName(): void;
}) {
  const [tables, setTables] = useState<TableSummary[] | undefined>();
  const [listError, setListError] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [tableName, setTableName] = useState<string | undefined>();
  const [style, setStyle] = useState<TableStyle>("SAYC");
  const [scoring, setScoring] = useState<TableScoring>("rubber");
  const [listed, setListed] = useState(true);
  const [sessionTables, setSessionTables] = useState(2);
  const [sessionBoards, setSessionBoards] = useState(8);
  const [sessionScoring, setSessionScoring] = useState<"matchpoints" | "imps">("matchpoints");
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

  async function createDuplicateSession() {
    const name = `${identity.name}'s duplicate`.slice(0, 40);
    if (creatingNow.current) return;
    creatingNow.current = true;
    setCreating(true);
    setCreateError(undefined);
    let result: Awaited<ReturnType<typeof defaultCreateSession>>;
    try { result = await api.createSession(baseUrl, { name, style, tableCount: sessionTables, boardCount: sessionBoards, scoring: sessionScoring, listed: true }); }
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

  // Whichever failed most recently wins: each failure clears the other.
  const alert = createError ?? (listError ? "Can't reach the tables right now." : undefined);

  return (
    <main className="app-shell">
      <section className="empty-table lobby" aria-label="Online tables">
        <div className="start-bar">
          <span className="brand"><span className="brand-mark">C</span>ContractPlay</span>
          <span className="table-tools-row">
            <button className="secondary-button" type="button" onClick={onChangeName}>Change name</button>
            <button className="secondary-button" type="button" onClick={onRecentHands}>Recent hands</button>
            <button className="secondary-button" type="button" onClick={onSolo}>Solo play</button>
          </span>
        </div>
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
        <form className="lobby-panel" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label>Table name<input aria-label="Table name" value={effectiveName} maxLength={40} onChange={(event) => { setCreateError(undefined); setTableName(event.target.value); }} /></label>
          <label>Bidding style<select aria-label="Bidding style" value={style} onChange={(event) => { setCreateError(undefined); setStyle(event.target.value as TableStyle); }}><option value="SAYC">SAYC</option><option value="2/1">2/1</option></select></label>
          <label>Scoring<select aria-label="Scoring" value={scoring} onChange={(event) => { setCreateError(undefined); setScoring(event.target.value as TableScoring); }}><option value="rubber">{scoringNames.rubber}</option><option value="duplicate">{scoringNames.duplicate}</option></select></label>
          <label className="lobby-check"><input type="checkbox" aria-label="Show in lobby" checked={listed} onChange={(event) => { setCreateError(undefined); setListed(event.target.checked); }} />Show in lobby</label>
          <button className="primary-button" type="submit" disabled={creating || effectiveName.trim() === ""}>New table</button>
        </form>
        <form className="lobby-panel" aria-label="New duplicate session" onSubmit={(event) => { event.preventDefault(); void createDuplicateSession(); }}>
          <h2>New duplicate session</h2>
          <label>Tables<select aria-label="Session tables" value={sessionTables} onChange={(event) => setSessionTables(Number(event.target.value))}>{[2, 3, 4, 6, 8].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label>Boards<select aria-label="Session boards" value={sessionBoards} onChange={(event) => setSessionBoards(Number(event.target.value))}>{[4, 8, 12, 16, 24, 32].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label>Scoring method<select aria-label="Session scoring" value={sessionScoring} onChange={(event) => setSessionScoring(event.target.value as "matchpoints" | "imps")}><option value="matchpoints">Matchpoints</option><option value="imps">Cross-IMPs</option></select></label>
          <label>Session bidding style<select aria-label="Session bidding style" value={style} onChange={(event) => setStyle(event.target.value as TableStyle)}><option value="SAYC">SAYC</option><option value="2/1">2/1</option></select></label>
          <p className="quiet-copy">Session tables appear in the open lobby so players can join different tables.</p>
          <button className="primary-button" type="submit" disabled={creating}>Create session</button>
        </form>
        {alert ? <p className="error-message" role="alert">{alert}</p> : null}
      </section>
    </main>
  );
}
