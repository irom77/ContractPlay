import { useCallback, useEffect, useState } from "react";
import type { Seat } from "@contractplay/core";
import type { SeatInfo, TableSummary } from "@contractplay/protocol";
import { seatNames, seats } from "../table/labels.js";

type AdminTable = TableSummary & { listed: boolean };

function seatDescription(seat: SeatInfo): string {
  if (seat.kind === "empty") return "Open";
  if (seat.kind === "bot") return `Bot · ${seat.skill}`;
  return `${seat.name}${seat.away ? " · away" : ""}`;
}

export function Admin({ baseUrl }: { baseUrl: string }) {
  const [tables, setTables] = useState<AdminTable[]>();
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const apiUrl = baseUrl.replace(/\/+$/, "");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`${apiUrl}/api/admin/tables`);
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
      const response = await fetch(`${apiUrl}/api/admin/tables/${encodeURIComponent(table.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setTables((current) => current?.filter((item) => item.id !== table.id));
      setNotice(`Removed ${table.name}.`);
    } catch {
      setError(`Couldn't remove ${table.name}. Refresh the list and try again.`);
    } finally {
      setRemovingId(undefined);
    }
  }

  return (
    <main className="app-shell">
      <section className="empty-table lobby admin-page" aria-label="Online table administration">
        <div className="start-bar">
          <span className="brand"><span className="brand-mark">C</span>ContractPlay admin</span>
          <a className="secondary-button admin-back" href="/#/online">Back to lobby</a>
        </div>
        <section className="lobby-panel admin-panel">
          <div className="section-heading">
            <div><h1>Online tables</h1><p className="quiet-copy">Development admin · anyone with this page can remove tables.</p></div>
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
        </section>
        {error ? <p className="error-message admin-message" role="alert">{error}</p> : null}
        {notice ? <p className="admin-notice" role="status">{notice}</p> : null}
      </section>
    </main>
  );
}
