// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createDeck, deal, type HandRecord, type TravellerRow } from "@contractplay/core";
import { FieldResult } from "./FieldResult.js";

afterEach(cleanup);

const row = (nsScore?: number, extra: Partial<TravellerRow> = {}): TravellerRow => ({ ...(nsScore === undefined ? {} : { nsScore }), multiplicity: 1, artificial: false, ...extra });
const field: TravellerRow[] = [
  row(420, { contract: "4S", declarer: "north", tricks: 10 }),
  row(-50, { contract: "4S", declarer: "north", tricks: 9 }),
  row(430, { contract: "3NT", declarer: "south", tricks: 10 }),
  row(0, { contract: "Pass" }),
  row(420, { contract: "4S", declarer: "north", tricks: 10 }),
  row(420, { contract: "4S", declarer: "north", tricks: 10, artificial: true }),
  row(undefined)
];
const record = (scoring: string | undefined, rows: readonly TravellerRow[] = field): HandRecord => ({
  ...(scoring ? { scoring } : {}),
  dealer: "north",
  vulnerability: "None",
  deal: deal(createDeck()),
  field: rows
});

const panel = () => within(screen.getByRole("region", { name: "Result against the field" }));
const tableRows = () => [...panel().getAllByRole("row")].slice(1);

describe("FieldResult", () => {
  it("states the points when the field has no scores, but not for a passed-out hand", () => {
    const { rerender } = render(<FieldResult record={record("MP", [])} nsScore={-420} side="NS" />);
    expect(panel().getByText("No field results for this board.")).toBeTruthy();
    expect(document.querySelector(".hand-points-line")?.textContent).toBe("EW +420");
    rerender(<FieldResult record={record("MP", [])} nsScore={0} side="NS" showPoints={false} />);
    expect(document.querySelector(".hand-points-line")).toBeNull();
  });

  it("states the matchpoint result and labels the board", () => {
    render(<FieldResult record={record("MP")} nsScore={420} side="NS" label="Board 7 · 1 of 3" />);
    expect(panel().getByRole("heading", { name: "Against the field" })).toBeTruthy();
    expect(panel().getByText("Board 7 · 1 of 3")).toBeTruthy();
    expect(panel().getByText("60.0% · 6 of 10 matchpoints")).toBeTruthy();
  });

  it("states IMPs against the datum, and across the field", () => {
    render(<FieldResult record={record("IMP")} nsScore={420} side="NS" />);
    expect(panel().getByText("+5 IMPs against a datum of NS +240")).toBeTruthy();
    cleanup();
    render(<FieldResult record={record("IMP;Cross")} nsScore={420} side="NS" />);
    expect(panel().getByText("+19 IMPs across the field · 3.8 per comparison")).toBeTruthy();
  });

  it("shows a PBN-provided double-dummy par score", () => {
    render(<FieldResult record={{ ...record("MP", []), doubleDummyPar: -420 }} nsScore={420} side="NS" />);
    expect(panel().getByText("Double-dummy par: NS -420")).toBeTruthy();
    expect(panel().getByText("No field results for this board.")).toBeTruthy();
  });

  it("shows the Butler-2 datum after dropping the high and low results", () => {
    render(<FieldResult record={record("IMP;Butler-2")} nsScore={420} side="NS" />);
    expect(panel().getByText("+4 IMPs against a Butler-2 datum of NS +280")).toBeTruthy();
  });

  it("shows the datum from East-West's side when the player sits East-West", () => {
    render(<FieldResult record={record("IMP")} nsScore={-50} side="EW" />);
    expect(panel().getByText(/against a datum of EW -240$/)).toBeTruthy();
  });

  it("lists the field by NS score with the player's row in place and the void rows last", () => {
    render(<FieldResult record={record("MP")} nsScore={420} side="NS" />);
    expect(panel().getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Contract", "By", "Tricks", "NS score"]);
    const rows = tableRows();
    expect(rows.map((line) => line.querySelector("td")!.textContent)).toEqual(["3NT", "You", "4S", "4S", "Pass", "4S", "4S", "—"]);
    expect(rows[1]!.classList).toContain("field-row-you");
    expect(rows.slice(-2).every((line) => line.classList.contains("field-row-void"))).toBe(true);
    expect(rows.slice(0, -2).some((line) => line.classList.contains("field-row-void"))).toBe(false);
  });

  it("marks a result shared by several tables", () => {
    render(<FieldResult record={record("MP", [row(100, { contract: "2S", declarer: "east", tricks: 8, multiplicity: 3 })])} nsScore={0} side="NS" />);
    expect(tableRows()[0]!.textContent).toContain("100 ×3");
  });

  it("scores East-West from their side", () => {
    render(<FieldResult record={record("MP")} nsScore={-50} side="EW" />);
    expect(panel().getByText("90.0% · 9 of 10 matchpoints")).toBeTruthy();
  });

  it("says so when the field has no scores", () => {
    render(<FieldResult record={record("MP", [row(undefined), row(420, { artificial: true })])} nsScore={420} side="NS" actions={<button type="button">Next deal</button>} />);
    expect(panel().getByText("No field results for this board.")).toBeTruthy();
    expect(panel().getByRole("button", { name: "Next deal" })).toBeTruthy();
  });
});
