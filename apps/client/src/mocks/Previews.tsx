import { Fragment, useEffect, useMemo, useState } from "react";
import { saveSoloData } from "@contractplay/persistence";
import App from "../App.js";
import type { StorageLike } from "@contractplay/persistence";
import type { TableView } from "@contractplay/protocol";
import type { connectTable } from "../online/connection.js";
import { saveIdentity } from "../online/identity.js";
import { Lobby } from "../online/Lobby.js";
import { OnlineTable } from "../online/OnlineTable.js";
import { previewScreens, type PreviewData } from "./scenarios.js";

/** Keeps each preview's name, hints setting, and saved hands away from the real device storage. */
function memoryStorage(entries: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(entries));
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** A connection that delivers one fixed view and ignores whatever is sent: the preview is for looking, not playing. */
function fixedConnection(view: TableView): typeof connectTable {
  return (input) => {
    input.onStatus("open");
    input.onView(view);
    return { send() {}, close() {} };
  };
}

/** The solo App opened on an in-memory copy of its saved hand and settings. */
function SoloPreviewScreen({ data }: { data: Extract<PreviewData, { kind: "solo" }> }) {
  const preview = useMemo(() => {
    const storage = memoryStorage({ "contractplay.scoring": data.scoring });
    saveSoloData(storage, data.data);
    return { storage, ...data.table };
  }, [data]);
  return <App preview={preview} />;
}

function PreviewScreen({ data }: { data: PreviewData }) {
  if (data.kind === "solo") return <SoloPreviewScreen data={data} />;
  return <OnlineScreen data={data} />;
}

function OnlineScreen({ data }: { data: Exclude<PreviewData, { kind: "solo" }> }) {
  const storage = useMemo(() => {
    const store = memoryStorage(data.kind === "table" && data.hints ? { "contractplay.hints": "on" } : {});
    saveIdentity(store, data.viewerName);
    return store;
  }, [data]);
  const connect = useMemo(() => data.kind === "table" ? fixedConnection(data.view) : undefined, [data]);
  const lobbyApi = useMemo(() => data.kind === "lobby"
    ? { listTables: () => Promise.resolve(data.tables), createTable: () => Promise.resolve({ error: "preview" }) }
    : undefined, [data]);
  if (data.kind === "lobby") return <Lobby baseUrl="preview" storage={storage} api={lobbyApi!} onOpenTable={() => {}} onSolo={() => {}} onRecentHands={() => {}} />;
  return <OnlineTable baseUrl="preview" tableId={data.view.id} storage={storage} onLeave={() => {}} onRecentHands={() => {}} connect={connect!} menuOpen={data.menuOpen ?? false} rubberOpen={data.rubberOpen ?? false} {...(data.initialQueued ? { initialQueued: data.initialQueued } : {})} />;
}

export type PreviewsProps = { index: number; onIndex(next: number): void };

/** UI preview mode (`#/mocks`): one realistic screen at a time, full window, with Previous/Next. */
export function Previews({ index, onIndex }: PreviewsProps) {
  const last = previewScreens.length - 1;
  const current = Math.min(Math.max(index, 0), last);
  const screen = previewScreens[current]!;
  const data = useMemo(() => screen.build(), [screen]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.closest("input, select, textarea")) return;
      if (event.key === "ArrowRight" && current < last) onIndex(current + 1);
      else if (event.key === "ArrowLeft" && current > 0) onIndex(current - 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, last, onIndex]);

  return <>
    <Fragment key={screen.id}><PreviewScreen data={data} /></Fragment>
    {hidden
      ? <button className="preview-reveal" type="button" aria-label="Show preview controls" title="Show preview controls" onClick={() => setHidden(false)}>{current + 1}/{previewScreens.length}</button>
      : <nav className="preview-bar" aria-label="UI previews">
        <button className="preview-step" type="button" aria-label="Previous screen" title="Previous (←)" disabled={current === 0} onClick={() => onIndex(current - 1)}>‹</button>
        <span className="preview-count">{current + 1} / {previewScreens.length}</span>
        <span className="preview-title" title={screen.detail}><strong>{screen.title}</strong><span className="preview-detail">{screen.detail}</span></span>
        <button className="preview-step" type="button" aria-label="Next screen" title="Next (→)" disabled={current === last} onClick={() => onIndex(current + 1)}>›</button>
        <button className="preview-step" type="button" aria-label="Hide preview controls" title="Hide these controls" onClick={() => setHidden(true)}>×</button>
        <a className="preview-exit" href="#/">Exit</a>
      </nav>}
  </>;
}
