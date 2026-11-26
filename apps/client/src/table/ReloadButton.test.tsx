// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReloadButton } from "./ReloadButton.js";

afterEach(cleanup);

describe("reload button", () => {
  it("reloads the page and says it is not Take back", () => {
    const onReload = vi.fn();
    render(<ReloadButton onReload={onReload} />);
    const button = screen.getByRole("button", { name: "Reload page" });
    expect(button.getAttribute("title")).toMatch(/not Take back/);
    expect(screen.queryByRole("button", { name: /take back|undo/i })).toBeNull();
    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledOnce();
  });
});
