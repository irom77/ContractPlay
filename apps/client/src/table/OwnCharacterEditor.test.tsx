// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TRAIT_PRESETS } from "@contractplay/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OwnCharacterEditor } from "./OwnCharacterEditor.js";

afterEach(cleanup);
const dial = (legend: string) => within(screen.getByRole("group", { name: legend }));

describe("own character editor", () => {
  it("starts from a cast member", () => {
    render(<OwnCharacterEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "Bold Bea" } });
    expect((screen.getByLabelText("Skill") as HTMLSelectElement).value).toBe("advanced");
    expect((dial("Openings").getByLabelText("Light") as HTMLInputElement).checked).toBe(true);
    expect((dial("Leads").getByLabelText("Attacking") as HTMLInputElement).checked).toBe(true);
    expect((dial("Preempts").getByLabelText("By the book") as HTMLInputElement).checked).toBe(true);
  });

  it("saves a named character", () => {
    const onSave = vi.fn();
    render(<OwnCharacterEditor onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Gentle Gina " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Never doubles." } });
    fireEvent.click(dial("Penalty doubles").getByLabelText("Often"));
    expect(dial("Penalty doubles").getByText(/Doubles the opponents' final contract/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Gentle Gina", blurb: "Never doubles.", skill: "intermediate", traits: { ...TRAIT_PRESETS.normal, doubles: "bold" } });
  });

  it("explains a bad name", () => {
    const onSave = vi.fn();
    render(<OwnCharacterEditor onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Give your character a name of up to 24 characters.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("edits a character without a starting point", () => {
    render(<OwnCharacterEditor initial={{ id: "own-abc123", name: "Gina", blurb: "", skill: "expert", traits: TRAIT_PRESETS.conservative, updatedAt: 1 }} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText("Start from")).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Gina");
    expect((dial("Second hand").getByLabelText("Low") as HTMLInputElement).checked).toBe(true);
  });

  it("saves on Enter without submitting a form around it", () => {
    const onSave = vi.fn();
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    render(<form onSubmit={onSubmit}><OwnCharacterEditor onSave={onSave} onCancel={vi.fn()} /><button type="submit">Play</button></form>);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Gina" } });
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
