import { useCallback, useEffect, useRef, useState } from "react";
import type { StorageLike } from "@contractplay/persistence";
import type { SeatInfo, TableStyle, TableSummary } from "@contractplay/protocol";
import { seatNames, seats } from "../table/labels.js";
import { createTable as defaultCreateTable, listTables as defaultListTables } from "./connection.js";
import { loadIdentity, saveIdentity, type Identity } from "./identity.js";

const REFRESH_MS = 5000;

export type LobbyApi = {
  listTables(baseUrl: string): Promise<TableSummary[]>;
  createTable: typeof defaultCreateTable;
};

export type LobbyProps = {
  baseUrl: string;
  storage: StorageLike;
  onOpenTable(id: string): void;
  onSolo(): void;
  api?: LobbyApi;
};

const defaultApi: LobbyApi = { listTables: defaultListTables, createTable: defaultCreateTable };

function createErrorText(error: string): string {
  if (error === "too-many-tables") return "There are too many open tables right now. Try again later.";
  if (error === "too-many-requests") return "You've created a lot of tables. Try again in a while.";
  return "Couldn't create the table. Try again.";
}

function seatLabel(seat: SeatInfo): string {
  return seat.kind === "human" ? seat.name : seat.kind === "bot" ? "Bot" : "Open";
}

export function Lobby({ baseUrl, storage, onOpenTable, onSolo, api = defaultApi }: LobbyProps) {
  const [identity, setIdentity] = useState<Identity | undefined>(() => loadIdentity(storage));
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  if (!identity || editingName) {
    const submit = () => {
      const name = nameDraft.trim();
      if (name === "") return;
      setIdentity(saveIdentity(storage, name));
      setEditingName(false);
    };
    return (
      <main className="app-shell">
        <section className="empty-table lobby" aria-label="Choose a name">
          <div className="start-bar"><span className="brand"><span className="brand-mark">C</span>ContractPlay</span></div>
          <form className="lobby-panel" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <label>Your name<input aria-label="Your name" value={nameDraft} maxLength={20} autoFocus onChange={(event) => setNameDraft(event.target.value)} /></label>
            <button className="primary-button" type="submit" disabled={nameDraft.trim() === ""}>Continue</button>
            <button className="secondary-button" type="button" onClick={onSolo}>Solo play</button>
          </form>
        </section>
      </main>
    );
  }

  return <LobbyTables identity={identity} baseUrl={baseUrl} api={api} onOpenTable={onOpenTable} onSolo={onSolo}
    onChangeName={() => { setNameDraft(identity.name); setEditingName(true); }} />;
}

function LobbyTables({ identity, baseUrl, api, onOpenTable, onSolo, onChangeName }: {
  identity: Identity; baseUrl: string; api: LobbyApi; onOpenTable(id: string): void; onSolo(): void; onChangeName(): void;
}) {
  const [tables, setTables] = useState<TableSummary[] | undefined>();
  const [listError, setListError] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [tableName, setTableName] = useState<string | undefined>();
  const [style, setStyle] = useState<TableStyle>("SAYC");
  const [listed, setListed] = useState(true);
  const [creating, setCreating] = useState(false);
  const inFlight = useRef(false);
  const latestRequest = useRef(0);
  const mounted = useRef(true);
  const apiRef = useRef(api);
  apiRef.current = api;

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++latestRequest.current;
    try {
      const result = await apiRef.current.listTables(baseUrl);
      if (mounted.current && request === latestRequest.current) { setTables(result); setListError(false); }
    } catch {
      if (mounted.current && request === latestRequest.current) setListError(true);
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
    if (name === "" || creating) return;
    setCreating(true);
    setCreateError(undefined);
    const result = await api.createTable(baseUrl, { name, style, listed });
    if (!mounted.current) return;
    setCreating(false);
    if ("id" in result) onOpenTable(result.id);
    else setCreateError(createErrorText(result.error));
  }

  const alert = createError ?? (listError ? "Can't reach the tables right now." : undefined);

  return (
    <main className="app-shell">
      <section className="empty-table lobby" aria-label="Online tables">
        <div className="start-bar">
          <span className="brand"><span className="brand-mark">C</span>ContractPlay</span>
          <span className="table-tools-row">
            <button className="secondary-button" type="button" onClick={onChangeName}>Change name</button>
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
                  <span className="quiet-copy">{table.style}</span>
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
          <label>Table name<input aria-label="Table name" value={effectiveName} maxLength={40} onChange={(event) => setTableName(event.target.value)} /></label>
          <label>Bidding style<select aria-label="Bidding style" value={style} onChange={(event) => setStyle(event.target.value as TableStyle)}><option value="SAYC">SAYC</option><option value="2/1">2/1</option></select></label>
          <label className="lobby-check"><input type="checkbox" aria-label="Show in lobby" checked={listed} onChange={(event) => setListed(event.target.checked)} />Show in lobby</label>
          <button className="primary-button" type="submit" disabled={creating || effectiveName.trim() === ""}>New table</button>
        </form>
        {alert ? <p className="error-message" role="alert">{alert}</p> : null}
      </section>
    </main>
  );
}
