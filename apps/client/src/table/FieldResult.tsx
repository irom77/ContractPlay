import type { ReactNode } from "react";
import { compareWithField, fieldMethod, type FieldComparison, type HandRecord, type TravellerRow } from "@contractplay/core";

export type FieldResultProps = Readonly<{
  record: HandRecord;
  /** The player's table result, North-South signed. */
  nsScore: number;
  /** The partnership the player sat in; every figure is from its side. */
  side: "NS" | "EW";
  /** Which board this is, for example "Board 7 · 1 of 3". */
  label?: string;
  /** The panel's buttons. */
  actions?: ReactNode;
}>;

const signed = (value: number): string => (value > 0 ? `+${value}` : `${value}`);
const imps = (value: number): string => `${signed(value)} ${Math.abs(value) === 1 ? "IMP" : "IMPs"}`;

function headline(comparison: FieldComparison, side: "NS" | "EW"): string {
  if (comparison.method === "butler") return `${imps(comparison.butler.imps)} against a datum of ${side} ${signed(comparison.butler.datum)}`;
  if (comparison.method === "cross") return `${imps(comparison.cross.total)} across the field · ${comparison.cross.perComparison.toFixed(1)} per comparison`;
  const { percentage, points, top } = comparison.matchpoints;
  return `${percentage.toFixed(1)}% · ${points} of ${top} matchpoints`;
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
export function FieldResult({ record, nsScore, side, label, actions }: FieldResultProps) {
  const comparison = compareWithField(record.field, nsScore, side, fieldMethod(record.scoring));
  return <section className="field-result" aria-label="Result against the field">
    <h3>Against the field</h3>
    {label ? <p className="field-label">{label}</p> : null}
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
    </> : <p className="field-headline">No field results for this board.</p>}
    {actions ? <div className="field-actions">{actions}</div> : null}
  </section>;
}
