import { useEffect, useState, type ReactNode } from "react";
import { compareWithField, fieldMethod, type FieldComparison, type HandRecord, type TravellerRow } from "@contractplay/core";
import { calculateDoubleDummyPar, serializeDdsDeal } from "../doubleDummy.js";

export type FieldResultProps = Readonly<{
  record: HandRecord;
  /** The player's table result, North-South signed. */
  nsScore: number;
  /** The partnership the player sat in; every figure is from its side. */
  side: "NS" | "EW";
  /** Which board this is, for example "Board 7 · 1 of 3". */
  label?: string;
  /** Whether to state the points when there is no field to compare with; false for a passed-out hand. Defaults to true. */
  showPoints?: boolean;
  /** The panel's buttons. */
  actions?: ReactNode;
}>;

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);
const imps = (value: number): string => `${signed(value)} ${Math.abs(value) === 1 ? "IMP" : "IMPs"}`;

function headline(comparison: FieldComparison, side: "NS" | "EW"): string {
  if (comparison.method === "butler" || comparison.method === "butler-2") return `${imps(comparison.butler.imps)} against a ${comparison.method === "butler-2" ? "Butler-2 " : ""}datum of ${side} ${signed(comparison.butler.datum)}`;
  if (comparison.method === "cross") return `${imps(comparison.cross.total)} across the field · ${comparison.cross.perComparison.toFixed(1)} per comparison`;
  const { percentage, points, top } = comparison.matchpoints;
  return `${percentage.toFixed(1)}% · ${comparison.matchpoints.neuberg ? points.toFixed(1) : points} of ${top} matchpoints${comparison.matchpoints.neuberg ? " (Neuberg)" : ""}`;
}

const seatLetter = (seat: string): string => seat[0]!.toUpperCase();
const isVoid = (row: TravellerRow): boolean => row.artificial || row.nsScore === undefined;

type Line = Readonly<{ key: string; row?: TravellerRow }>;

/** The scored rows highest first with the player's row placed above any equal score, then the rows that do not count. */
function lines(field: readonly TravellerRow[], nsScore: number): Line[] {
  const rows = field.map((row, index) => ({ key: `row-${index}`, row }));
  const scored = rows.filter(({ row }) => !isVoid(row)).sort((a, b) => b.row.nsScore! - a.row.nsScore!);
  const place = scored.findIndex(({ row }) => row.nsScore! <= nsScore);
  const you: Line = { key: "you" };
  return [...(place < 0 ? [...scored, you] : [...scored.slice(0, place), you, ...scored.slice(place)]), ...rows.filter(({ row }) => isVoid(row))];
}

/** How a board-set result compares with the field that played the board elsewhere. Pair names are never shown. */
export function FieldResult({ record, nsScore, side, label, showPoints = true, actions }: FieldResultProps) {
  const comparison = compareWithField(record.field, nsScore, side, fieldMethod(record.scoring), record.expectedFieldCount);
  const parKey = record.dealer + "|" + record.vulnerability + "|" + serializeDdsDeal(record.deal);
  const [calculated, setCalculated] = useState<Readonly<{ key: string; status: "loading" | "ready" | "unavailable"; score?: number }>>();
  useEffect(() => {
    if (record.doubleDummyPar !== undefined) {
      setCalculated({ key: parKey, status: "ready", score: record.doubleDummyPar });
      return;
    }
    let current = true;
    setCalculated({ key: parKey, status: "loading" });
    void calculateDoubleDummyPar(record).then((score) => {
      if (current) setCalculated({ key: parKey, status: "ready", score });
    }).catch(() => {
      if (current) setCalculated({ key: parKey, status: "unavailable" });
    });
    return () => { current = false; };
  }, [parKey, record.doubleDummyPar, record]);
  const parScore = record.doubleDummyPar ?? (calculated?.key === parKey ? calculated.score : undefined);
  const parLoading = record.doubleDummyPar === undefined && (calculated?.key !== parKey || calculated.status === "loading");
  const parUnavailable = record.doubleDummyPar === undefined && calculated?.key === parKey && calculated.status === "unavailable";
  return <section className="field-result" aria-label="Result against the field">
    <h3>Against the field</h3>
    {label ? <p className="field-label">{label}</p> : null}
    {parScore !== undefined ? <p className="field-par">Double-dummy par: NS {signed(parScore)}</p>
      : parLoading ? <p className="field-par" aria-live="polite">Calculating double-dummy par…</p>
        : parUnavailable ? <p className="field-par">Double-dummy par unavailable.</p> : null}
    {comparison ? <>
      <p className="field-headline">{headline(comparison, side)}</p>
      <table className="field-table">
        <thead><tr><th scope="col">Contract</th><th scope="col">By</th><th scope="col">Tricks</th><th scope="col">NS score</th></tr></thead>
        <tbody>{lines(record.field, nsScore).map(({ key, row }) => row
          ? <tr key={key} className={isVoid(row) ? "field-row-void" : undefined}>
            <td>{row.contract ?? "—"}</td>
            <td>{row.declarer ? seatLetter(row.declarer) : ""}</td>
            <td>{row.tricks ?? ""}</td>
            <td>{row.nsScore ?? "?"}{row.multiplicity > 1 ? ` ×${row.multiplicity}` : ""}</td>
          </tr>
          : <tr key={key} className="field-row-you"><td>You</td><td /><td /><td>{nsScore}</td></tr>)}</tbody>
      </table>
    </> : <>
      {showPoints ? <p className="hand-points-line">{`${nsScore >= 0 ? "NS" : "EW"} +${Math.abs(nsScore)}`}</p> : null}
      <p className="field-headline">No field results for this board.</p>
    </>}
    {actions ? <div className="field-actions">{actions}</div> : null}
  </section>;
}
