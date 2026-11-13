import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/** Where a moved banner sits, as a share (0–1) of the room it can move in, so it stays on the table when the window resizes. */
export type BannerSpot = { x: number; y: number };

const keyStep = 0.05;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function readBannerSpot(storage: Storage | undefined, key: string): BannerSpot | undefined {
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? "null") as Partial<BannerSpot> | null;
    return typeof saved?.x === "number" && typeof saved.y === "number" ? { x: clamp(saved.x), y: clamp(saved.y) } : undefined;
  } catch { return undefined; }
}

function saveBannerSpot(storage: Storage | undefined, key: string, spot: BannerSpot | undefined) {
  try { if (spot) storage?.setItem(key, JSON.stringify(spot)); else storage?.removeItem(key); } catch { /* private window or blocked storage: the spot lasts this visit only */ }
}

function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

/**
 * A banner that floats over the table without covering the cards: it starts in the top-left corner under the status card,
 * and the player can drag it (or move it from its grip with the arrow keys) anywhere on the table. Home, or a double-click
 * on the grip, puts it back. The spot is remembered on this device.
 */
export function DraggableBanner({ label, storageKey, className = "", children }: { label: string; storageKey: string; className?: string; children: ReactNode }) {
  const storage = browserStorage();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; dx: number; dy: number; spot?: BannerSpot } | undefined>(undefined);
  const [spot, setSpot] = useState<BannerSpot | undefined>(() => readBannerSpot(storage, storageKey));
  const [place, setPlace] = useState<{ left: number; top: number }>();

  const room = useCallback(() => {
    const element = ref.current;
    const surface = element?.offsetParent as HTMLElement | null | undefined;
    if (!element || !surface) return undefined;
    return { element, surface, width: Math.max(0, surface.clientWidth - element.offsetWidth), height: Math.max(0, surface.clientHeight - element.offsetHeight) };
  }, []);

  useLayoutEffect(() => {
    const layout = () => {
      const space = room();
      if (!space) return setPlace(undefined);
      if (spot) return setPlace({ left: spot.x * space.width, top: spot.y * space.height });
      // Default: the top-right corner, just under the menu and the last trick, where no seat or hand sits (on the left the
      // side seat's badge and dummy start just under the status card). Tall, narrow windows have no room there (the top
      // hand reaches the corner), so the banner sits on the open felt just above the player's seat.
      const tools = space.surface.querySelector<HTMLElement>(".table-tools");
      const status = space.surface.querySelector<HTMLElement>(".table-status");
      const bottomSeat = space.surface.querySelector<HTMLElement>(".pos-bottom");
      if (bottomSeat && space.surface.clientHeight > space.surface.clientWidth * 1.25) {
        setPlace({ left: status?.offsetLeft ?? 0, top: Math.max(0, Math.min(space.height, bottomSeat.offsetTop - space.element.offsetHeight - 12)) });
      } else if (tools) {
        setPlace({ left: Math.max(0, Math.min(space.width, tools.offsetLeft + tools.offsetWidth - space.element.offsetWidth)), top: Math.min(space.height, tools.offsetTop + tools.offsetHeight + 8) });
      } else setPlace(undefined);
    };
    layout();
    window.addEventListener("resize", layout);
    // The corner moves when the last trick appears under the menu, or the status card changes size.
    const watched = [...(ref.current?.offsetParent?.querySelectorAll(".table-tools, .table-status") ?? [])];
    const observer = typeof ResizeObserver === "function" && watched.length ? new ResizeObserver(layout) : undefined;
    for (const element of watched) observer?.observe(element);
    return () => { window.removeEventListener("resize", layout); observer?.disconnect(); };
  }, [spot, room]);

  const moveTo = (next: BannerSpot | undefined) => { setSpot(next); saveBannerSpot(storage, storageKey, next); };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button:not(.banner-grip), a, input, select")) return;
    const element = ref.current;
    if (!element) return;
    drag.current = { pointerId: event.pointerId, dx: event.clientX - element.offsetLeft, dy: event.clientY - element.offsetTop };
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const space = room();
    if (!drag.current || drag.current.pointerId !== event.pointerId || !space) return;
    const left = Math.min(space.width, Math.max(0, event.clientX - drag.current.dx));
    const top = Math.min(space.height, Math.max(0, event.clientY - drag.current.dy));
    drag.current.spot = { x: space.width ? left / space.width : 0, y: space.height ? top / space.height : 0 };
    setSpot(drag.current.spot);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const moved = drag.current.spot;
    drag.current = undefined;
    ref.current?.releasePointerCapture?.(event.pointerId);
    if (moved) saveBannerSpot(storage, storageKey, moved);
  };

  const onGripKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const space = room();
    const current = spot ?? (place && space ? { x: space.width ? place.left / space.width : 0, y: space.height ? place.top / space.height : 0 } : { x: 0, y: 0 });
    const moves: Record<string, [number, number]> = { ArrowLeft: [-keyStep, 0], ArrowRight: [keyStep, 0], ArrowUp: [0, -keyStep], ArrowDown: [0, keyStep] };
    const move = moves[event.key];
    if (move) moveTo({ x: clamp(current.x + move[0]), y: clamp(current.y + move[1]) });
    else if (event.key === "Home") moveTo(undefined);
    else return;
    event.preventDefault();
  };

  return <div ref={ref} className={`draggable-banner ${spot ? "moved" : ""} ${className}`.trim()} role="group" aria-label={label}
    style={place ? { left: place.left, top: place.top } : undefined}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <button className="banner-grip" type="button" aria-label="Move this banner" title="Drag to move; arrow keys move it, Home or a double-click puts it back"
      onKeyDown={onGripKey} onDoubleClick={() => moveTo(undefined)}><span aria-hidden="true">⠿</span></button>
    {children}
  </div>;
}
