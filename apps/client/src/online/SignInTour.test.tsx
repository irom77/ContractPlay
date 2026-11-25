// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInTour, tourSlides, tourStepMs } from "./SignInTour.js";

const caption = () => document.querySelector(".tour-caption")?.textContent;
const shownLink = () => document.querySelector(".tour-slide.current")?.getAttribute("href");

describe("SignInTour", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("steps through the previews, loading only the shown slide and the next", () => {
    vi.useFakeTimers();
    render(<SignInTour />);
    expect(caption()).toBe(tourSlides[0].caption);
    expect(shownLink()).toBe("#/mocks/18");
    expect(document.querySelectorAll(".tour-slide img")).toHaveLength(2);
    act(() => { vi.advanceTimersByTime(tourStepMs); });
    expect(caption()).toBe(tourSlides[1].caption);
    expect(shownLink()).toBe("#/mocks/19");
    expect(document.querySelectorAll(".tour-slide img")).toHaveLength(3);
    for (let step = 1; step < tourSlides.length; step++) act(() => { vi.advanceTimersByTime(tourStepMs); });
    expect(caption()).toBe(tourSlides[0].caption);
  });

  it("pauses while hovered and jumps to a slide from its dot", () => {
    vi.useFakeTimers();
    render(<SignInTour />);
    fireEvent.mouseEnter(screen.getByRole("figure", { name: "A look at the table" }));
    act(() => { vi.advanceTimersByTime(tourStepMs * 3); });
    expect(caption()).toBe(tourSlides[0].caption);
    fireEvent.click(screen.getByRole("button", { name: "Show Auto play finishes a dull hand" }));
    expect(shownLink()).toBe("#/mocks/21");
  });

  it("does not advance on its own when reduced motion is asked for", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    vi.useFakeTimers();
    render(<SignInTour />);
    act(() => { vi.advanceTimersByTime(tourStepMs * 3); });
    expect(caption()).toBe(tourSlides[0].caption);
  });
});
