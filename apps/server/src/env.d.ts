import type { LobbyObject } from "./lobby-object.js";
import type { TableObject } from "./table-object.js";

declare global {
  namespace Cloudflare {
    interface Env {
      ASSETS: Fetcher;
      TABLES: DurableObjectNamespace<TableObject>;
      LOBBY: DurableObjectNamespace<LobbyObject>;
    }
  }
  type Env = Cloudflare.Env;
}
