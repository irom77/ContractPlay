import { useEffect, useState } from "react";
import autoPlay from "./tour/auto-play.webp";
import declaring from "./tour/declaring.webp";
import hints from "./tour/hints.webp";
import lastTrick from "./tour/last-trick.webp";
import lobby from "./tour/lobby.webp";
import replay from "./tour/replay.webp";
import result from "./tour/result.webp";

/** The tour's slides, screenshots of the UI previews taken by scripts/capture-sign-in-tour.mjs (keep the two lists in step). */
export const tourSlides = [
  { src: hints, mock: 18, caption: "Hints explain any call" },
  { src: declaring, mock: 19, caption: "Declare with dummy in view" },
  { src: lastTrick, mock: 22, caption: "Lay the last trick out again" },
  { src: autoPlay, mock: 21, caption: "Auto play finishes a dull hand" },
  { src: result, mock: 26, caption: "The auction stays beside the hands" },
  { src: replay, mock: 32, caption: "Replayed deals scored in IMPs" },
  { src: lobby, mock: 1, caption: "Play with bots or with people" }
] as const;

export const tourStepMs = 4000;

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A slow crossfade through screenshots of the table under the sign-in form. Each slide opens its preview;
 *  it pauses while hovered or focused and does not advance on its own when reduced motion is asked for. */
export function SignInTour() {
  const [current, setCurrent] = useState(0);
  // Only the shown slide and the next one are loaded, so the sign-in page fetches one image up front.
  const [loaded, setLoaded] = useState(2);
  const [paused, setPaused] = useState(false);
  const [still] = useState(prefersReducedMotion);
  useEffect(() => {
    if (paused || still) return;
    const timer = window.setTimeout(() => setCurrent((index) => (index + 1) % tourSlides.length), tourStepMs);
    return () => window.clearTimeout(timer);
  }, [current, paused, still]);
  useEffect(() => { setLoaded((count) => Math.max(count, Math.min(current + 2, tourSlides.length))); }, [current]);

  return <figure className="sign-in-tour" aria-roledescription="carousel" aria-label="A look at the table"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <div className="tour-frame">
      {tourSlides.slice(0, loaded).map((slide, index) => <a key={slide.mock + slide.caption} href={`#/mocks/${slide.mock}`}
        className={`tour-slide${index === current ? " current" : ""}`} aria-hidden={index !== current} tabIndex={index === current ? 0 : -1}
        title={`Open preview ${slide.mock}`}>
        <img src={slide.src} alt={slide.caption} width={960} height={600} decoding="async" />
      </a>)}
    </div>
    <figcaption>
      <span className="tour-caption" aria-live={paused || still ? "polite" : "off"}>{tourSlides[current]?.caption}</span>
      <span className="tour-dots">{tourSlides.map((slide, index) => <button key={slide.caption} type="button"
        className={index === current ? "current" : ""} aria-label={`Show ${slide.caption}`} aria-current={index === current}
        onClick={() => setCurrent(index)} />)}</span>
    </figcaption>
  </figure>;
}
