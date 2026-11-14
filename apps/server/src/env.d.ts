import type { LobbyObject } from "./lobby-object.js";
import type { TableObject } from "./table-object.js";
import type { SessionObject } from "./session-object.js";

declare global {
  namespace Cloudflare {
    interface Env {
      ASSETS: Fetcher;
      TABLES: DurableObjectNamespace<TableObject>;
      LOBBY: DurableObjectNamespace<LobbyObject>;
      SESSIONS: DurableObjectNamespace<SessionObject>;
    }
  }
  type Env = Cloudflare.Env;
}
