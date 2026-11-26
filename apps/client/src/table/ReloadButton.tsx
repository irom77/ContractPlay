/**
 * Reloads the page, to reconnect and fetch the latest state without the browser's own refresh (which the desktop app
 * lacks). A clockwise arrow and the words "Reload page", so it is never mistaken for Take back, which undoes a call or
 * card. Games in progress are kept: solo hands are saved locally and online seats rejoin.
 */
export function ReloadButton({ onReload = () => window.location.reload() }: { onReload?: () => void }) {
  return <button className="icon-button reload-button" type="button" aria-label="Reload page"
    title="Reload page: reconnect and fetch the latest. Your game is kept (this is not Take back)" onClick={onReload}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15" /></svg>
  </button>;
}
