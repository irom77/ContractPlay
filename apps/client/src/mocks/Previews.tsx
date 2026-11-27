import { Fragment, useEffect, useMemo, useState } from "react";
import { saveSoloData } from "@contractplay/persistence";
import App from "../App.js";
import type { StorageLike } from "@contractplay/persistence";
import type { TableView } from "@contractplay/protocol";
import type { connectTable } from "../online/connection.js";
import { saveIdentity } from "../online/identity.js";
import { EmailGate, Lobby } from "../online/Lobby.js";
import type { AccountSession } from "../online/auth.js";
import { OnlineTable } from "../online/OnlineTable.js";
import { previewCategories, previewScreens, type PreviewData } from "./scenarios.js";

const previewAccount: AccountSession = { playerId: "preview-player", displayName: "Alex" };
const previewAuth = { currentAccount: async () => previewAccount, requestMagicLink: async () => {}, signOut: async () => {}, syncHistory: async () => {},
  updateDisplayName: async (displayName: string) => ({ ...previewAccount, displayName }) };

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
    const storage = memoryStorage({ "contractplay.scoring": data.scoring,
      ...(data.partnerResults ? { "contractplay.partnerResults": JSON.stringify(data.partnerResults) } : {}),
      ...(data.ownCharacters ? { "contractplay.ownCharacters": JSON.stringify(data.ownCharacters) } : {}) });
    saveSoloData(storage, data.data);
    return { storage, ...data.table };
  }, [data]);
  return <App preview={preview} />;
}

function PreviewScreen({ data }: { data: PreviewData }) {
  if (data.kind === "solo") return <SoloPreviewScreen data={data} />;
  if (data.kind === "auth") return <EmailGate identity={undefined} initialEmail="alex@example.com" initialSent={data.sent}
    requestLink={async () => {}} />;
  return <OnlineScreen data={data} />;
}

function OnlineScreen({ data }: { data: Exclude<PreviewData, { kind: "solo" } | { kind: "auth" }> }) {
  const storage = useMemo(() => {
    const store = memoryStorage({
      ...(data.kind === "table" && data.hints ? { "contractplay.hints": "on" } : {}),
      ...(data.kind === "table" && data.ownCharacters ? { "contractplay.ownCharacters": JSON.stringify(data.ownCharacters) } : {})
    });
    saveIdentity(store, data.viewerName);
    return store;
  }, [data]);
  const connect = useMemo(() => data.kind === "table" ? fixedConnection(data.view) : undefined, [data]);
  const lobbyApi = useMemo(() => {
    if (data.kind !== "lobby") return undefined;
    // A rename changes only this preview's list.
    let tables = data.tables;
    return { listTables: () => Promise.resolve(tables), createTable: () => Promise.resolve({ error: "preview" }), createSession: () => Promise.resolve({ error: "preview" }),
      renameTable: (_baseUrl: string, id: string, name: string) => {
        tables = tables.map((table) => table.id === id ? { ...table, name } : table);
        return Promise.resolve({ name });
      },
      ...(data.leaderboard ? { listLeaderboard: () => Promise.resolve(data.leaderboard!) } : {}) };
  }, [data]);
  if (data.kind === "lobby") return <Lobby baseUrl="preview" storage={storage} api={lobbyApi!} auth={previewAuth} onOpenTable={() => {}} onPlaySolo={() => {}} onRecentHands={() => {}} />;
  return <OnlineTable account={null} baseUrl="preview" tableId={data.view.id} storage={storage} onLeave={() => {}} onRecentHands={() => {}} connect={connect!} menuOpen={data.menuOpen ?? false} rubberOpen={data.rubberOpen ?? false} {...(data.initialQueued ? { initialQueued: data.initialQueued } : {})} {...(data.selectedCall ? { initialSelectedCall: data.selectedCall } : {})} {...(data.observer ? { observer: true as const } : {})} />;
}

export type PreviewsProps = { index: number; onIndex(next: number): void };

/** UI preview mode (`#/mocks`): one realistic screen at a time, full window, with Previous/Next and a grouped picker. */
export function Previews({ index, onIndex }: PreviewsProps) {
  const last = previewScreens.length - 1;
  const current = Math.min(Math.max(index, 0), last);
  const screen = previewScreens[current]!;
  const data = useMemo(() => screen.build(), [screen]);
  const [hidden, setHidden] = useState(false);

  // A screen whose form focuses a field by itself (the email sign-in) would otherwise take Space and the arrows as typing,
  // so the reviewer could not step on; a field the reviewer clicks into still takes their typing.
  useEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest("input, select, textarea") && !focused.closest(".preview-bar")) focused.blur();
  }, [current]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.closest("input, select, textarea")) return;
      const space = event.key === " ";
      const forward = event.key === "ArrowRight" || (space && !event.shiftKey);
      const back = event.key === "ArrowLeft" || (space && event.shiftKey);
      if (!forward && !back) return;
      event.preventDefault();
      // Space would otherwise also press whatever button has focus (such as › after a click) when the key comes up.
      if (space && target instanceof HTMLElement && target !== document.body) target.blur();
      if (forward && current < last) onIndex(current + 1);
      else if (back && current > 0) onIndex(current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, last, onIndex]);

  return <>
    <Fragment key={screen.id}><PreviewScreen data={data} /></Fragment>
    {hidden
      ? <button className="preview-reveal" type="button" aria-label="Show preview controls" title="Show preview controls" onClick={() => setHidden(false)}>{current + 1}/{previewScreens.length}</button>
      : <nav className="preview-bar" aria-label="UI previews">
        <button className="preview-step" type="button" aria-label="Previous screen" title="Previous (← or Shift+Space)" disabled={current === 0} onClick={() => onIndex(current - 1)}>‹</button>
        <span className="preview-count">{current + 1} / {previewScreens.length}</span>
        <select className="preview-jump" aria-label="Jump to a screen" title="Jump to a screen" value={current}
          onChange={(event) => { onIndex(Number(event.target.value)); event.target.blur(); }}>
          {previewCategories.map((category) => <optgroup key={category.name} label={category.name}>
            {category.ids.map((id) => {
              const at = previewScreens.findIndex((s) => s.id === id);
              return <option key={id} value={at}>{at + 1}. {previewScreens[at]!.title}</option>;
            })}
          </optgroup>)}
        </select>
        <span className="preview-title" title={screen.detail}><strong>{screen.title}</strong><span className="preview-detail">{screen.detail}</span></span>
        <button className="preview-step" type="button" aria-label="Next screen" title="Next (→ or Space)" disabled={current === last} onClick={() => onIndex(current + 1)}>›</button>
        <button className="preview-step" type="button" aria-label="Hide preview controls" title="Hide these controls" onClick={() => setHidden(true)}>×</button>
        <a className="preview-exit" href="#/">Exit</a>
      </nav>}
  </>;
}
