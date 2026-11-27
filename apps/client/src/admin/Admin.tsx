import { useCallback, useEffect, useMemo, useState } from "react";
import type { Seat } from "@contractplay/core";
import type { SeatInfo, TableSummary } from "@contractplay/protocol";
import { botName, seatNames, seats } from "../table/labels.js";
import { BenchmarkAdmin, type BenchmarkTab } from "./BenchmarkAdmin.js";
import { PlayersAdmin, playersAdminApi, type PlayersAdminApi } from "./PlayersAdmin.js";
import { ReloadButton } from "../table/ReloadButton.js";

type AdminTable = TableSummary & { listed: boolean };

function seatDescription(seat: SeatInfo): string {
  if (seat.kind === "empty") return "Open";
  if (seat.kind === "bot") return `${botName(seat)} · ${seat.skill}`;
  return `${seat.name}${seat.away ? " · away" : ""}`;
}

type AdminTab = "players" | "tables" | BenchmarkTab;
const TABS: readonly { id: AdminTab; label: string }[] = [
  { id: "players", label: "Players" }, { id: "tables", label: "Online tables" },
  { id: "profiles", label: "Profiles" }, { id: "cohorts", label: "Cohorts" }, { id: "jobs", label: "Jobs" }
];
/** The tab named in the address (`/admin#jobs`), so a reload or bookmark keeps it; Players otherwise. */
const tabFromHash = (): AdminTab => TABS.find((tab) => `#${tab.id}` === location.hash)?.id ?? "players";

/** /admin, for signed-in admins only: one box at a time (players, online tables, and bot benchmarks), chosen with tabs. */
export function Admin({ baseUrl, players }: { baseUrl: string; players?: PlayersAdminApi }) {
  const [tables, setTables] = useState<AdminTable[]>();
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [denied, setDenied] = useState<401 | 403>();
  const [tab, setTab] = useState<AdminTab>(tabFromHash);
  const [waiting, setWaiting] = useState(0);
  const choose = (next: AdminTab) => { setTab(next); history.replaceState(null, "", `#${next}`); };
  const apiUrl = baseUrl.replace(/\/+$/, "");
  const playersApi = useMemo(() => players ?? playersAdminApi(baseUrl), [players, baseUrl]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`${apiUrl}/api/admin/tables`, { credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) { setDenied(response.status); return; }
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const result = await response.json() as { tables: AdminTable[] };
      setTables(result.tables);
    } catch {
      setError("Couldn't load the tables. Check the service and try again.");
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function remove(table: AdminTable) {
    if (!window.confirm(`Remove “${table.name}” (${table.id})? All players will be disconnected.`)) return;
    setRemovingId(table.id);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(`${apiUrl}/api/admin/tables/${encodeURIComponent(table.id)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setTables((current) => current?.filter((item) => item.id !== table.id));
      setNotice(`Removed ${table.name}.`);
    } catch {
      setError(`Couldn't remove ${table.name}. Refresh the list and try again.`);
    } finally {
      setRemovingId(undefined);
    }
  }

  if (denied) return <main className="app-shell">
    <section className="empty-table lobby admin-page" aria-label="Administration">
      <div className="start-bar"><span className="brand"><span className="brand-mark">C</span>ContractPlay admin</span></div>
      <section className="lobby-panel admin-panel">
        <h1>Admins only</h1>
        <p className="quiet-copy">{denied === 401 ? "Sign in with an admin account to use this page." : "Your account isn't an admin. Ask an admin to give you admin rights."}</p>
        <a className="secondary-button admin-back" href="/#/online">Back to lobby</a>
      </section>
    </section>
  </main>;

  return (
    <main className="app-shell">
      <section className="empty-table lobby admin-page" aria-label="Online table administration">
        <div className="start-bar">
          <span className="brand"><span className="brand-mark">C</span>ContractPlay admin</span>
          <span className="table-tools-row"><a className="secondary-button admin-back" href="/#/online">Back to lobby</a><ReloadButton /></span>
        </div>
        <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
          {TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : undefined}
            onClick={() => choose(item.id)}>{item.label}{item.id === "players" && waiting > 0 ? <span className="admin-tab-count" aria-label={`${waiting} waiting`}>{waiting}</span> : null}</button>)}
        </nav>
        <section className="lobby-panel admin-panel" hidden={tab !== "players"}>
          <PlayersAdmin api={playersApi} onDenied={setDenied} onWaiting={setWaiting} />
        </section>
        <section className="lobby-panel admin-panel" aria-label="Online tables" hidden={tab !== "tables"}>
          <div className="section-heading">
            <div><h1>Online tables</h1><p className="quiet-copy">Removing a table disconnects everyone at it.</p></div>
            <button className="secondary-button" type="button" onClick={() => { void refresh(); }} disabled={loading}>Refresh</button>
          </div>
          {loading ? <p className="quiet-copy" role="status">Loading tables…</p> : null}
          {!loading && tables?.length === 0 ? <p className="quiet-copy">There are no open tables.</p> : null}
          {tables && tables.length > 0 ? (
            <ul className="admin-tables">
              {tables.map((table) => (
                <li className="admin-table" key={table.id}>
                  <div className="admin-table-heading">
                    <div><h2>{table.name}</h2><span className="admin-table-id">{table.id}</span></div>
                    <div className="admin-badges">
                      <span className="admin-badge">{table.listed ? "Listed" : "Unlisted"}</span>
                      <span className={`admin-badge${table.handInProgress ? " admin-playing" : ""}`}>
                        {table.handInProgress ? "Hand in progress" : "Between hands"}
                      </span>
                      <span className="admin-badge">{table.style}</span>
                    </div>
                  </div>
                  <ul className="admin-seats">
                    {seats.map((seat: Seat) => (
                      <li key={seat}><span className="quiet-copy">{seatNames[seat]}</span><span>{seatDescription(table.seats[seat])}</span></li>
                    ))}
                  </ul>
                  <button className="admin-remove" type="button" onClick={() => { void remove(table); }} disabled={removingId !== undefined}>
                    {removingId === table.id ? "Removing…" : "Remove table"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="error-message admin-message" role="alert">{error}</p> : null}
          {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
        </section>
        <BenchmarkAdmin baseUrl={baseUrl} tab={tab} />
      </section>
    </main>
  );
}
