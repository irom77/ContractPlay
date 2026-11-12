import { useEffect, useRef } from "react";

/** One entry in the game menu. Add an entry here to offer a new table action; leave it out when it does not apply. */
export type GameMenuItem = {
  id: string;
  label: string;
  onSelect(): void;
  disabled?: boolean;
  /** Shown as a tooltip, for example to say why an entry is unavailable. */
  title?: string;
  /** Actions that end or abandon play are drawn apart from the others. */
  tone?: "danger";
};

export type GameMenuProps = { items: readonly GameMenuItem[]; label?: string; defaultOpen?: boolean };

/**
 * The collapsible table menu: a toggle button that opens a list of actions. Closed by default; choosing an
 * entry, pressing Escape, or clicking elsewhere closes it again.
 */
export function GameMenu({ items, label = "Game menu", defaultOpen = false }: GameMenuProps) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const details = menu.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, []);

  return <details ref={menu} className="table-menu game-menu" open={defaultOpen || undefined}>
    <summary className="icon-button" aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </summary>
    <div className="table-menu-content game-menu-content" role="group" aria-label={label}>
      {items.map((item) => <button key={item.id} type="button" disabled={item.disabled}
        className={`secondary-button menu-deal${item.tone === "danger" ? " menu-danger" : ""}`}
        title={item.title}
        onClick={() => { if (menu.current) menu.current.open = false; item.onSelect(); }}>{item.label}</button>)}
    </div>
  </details>;
}
