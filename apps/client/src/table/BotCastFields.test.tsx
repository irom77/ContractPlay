// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TRAIT_PRESETS } from "@contractplay/core";
import type { OwnCharacter } from "@contractplay/persistence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customCast } from "../soloSetup.js";
import { BotCastFields } from "./BotCastFields.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const gina: OwnCharacter = { id: "own-abc123", name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced",
  traits: { ...TRAIT_PRESETS.normal, doubles: "cautious" }, updatedAt: 5 };

describe("bot cast fields with your characters", () => {
  it("offers your characters in every picker", () => {
    render(<BotCastFields cast={customCast} onChange={vi.fn()} own={[gina, { ...gina, id: "own-gone12", name: "Gone", deleted: true }]} onOwnChange={vi.fn()} />);
    for (const role of ["Partner", "Left opponent", "Right opponent"]) {
      const group = screen.getByRole("combobox", { name: role }).querySelector('optgroup[label="Your characters"]');
      expect([...group!.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Gentle Gina · Your character"]);
    }
  });

  it("creates a character", () => {
    const onOwnChange = vi.fn();
    render(<BotCastFields cast={customCast} onChange={vi.fn()} own={[]} onOwnChange={onOwnChange} />);
    fireEvent.click(screen.getByRole("button", { name: "New character" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Gina" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onOwnChange.mock.calls[0]![0]).toEqual([expect.objectContaining({ name: "Gina", skill: "intermediate" })]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("deleting a picked character returns its seat to the custom bot", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChange = vi.fn();
    const onOwnChange = vi.fn();
    render(<BotCastFields cast={{ ...customCast, left: gina.id }} onChange={onChange} own={[gina]} onOwnChange={onOwnChange} />);
    fireEvent.click(within(screen.getByRole("list", { name: "Your characters" })).getByRole("button", { name: "Delete Gentle Gina" }));
    expect(window.confirm).toHaveBeenCalledWith("Delete Gentle Gina? Its results stay in your record.");
    expect(onOwnChange.mock.calls[0]![0]).toEqual([expect.objectContaining({ id: gina.id, deleted: true })]);
    expect(onChange).toHaveBeenCalledWith(customCast);
  });

  it("stops at twelve", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => ({ ...gina, id: `own-abc12${index}`, name: `Bot ${index}` }));
    render(<BotCastFields cast={customCast} onChange={vi.fn()} own={twelve} onOwnChange={vi.fn()} />);
    expect((screen.getByRole("button", { name: "New character" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("You have 12 characters, the most you can keep.")).toBeTruthy();
  });
});
