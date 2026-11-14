import type { LobbyObject } from "./lobby-object.js";
import type { TableObject } from "./table-object.js";
import type { SessionObject } from "./session-object.js";

declare global {
  namespace Cloudflare {
    interface Env {
      ASSETS: Fetcher;
      DB: D1Database;
      AUTH_PUBLIC_ORIGIN?: string;
      AUTH_ALLOW_INSECURE_LOCALHOST?: string;
      AUTH_EMAIL_FROM?: string;
      EMAIL?: SendEmail;
      AUTH_EMAIL_PROVIDER?: "resend";
      RESEND_API_KEY?: string;
      TABLES: DurableObjectNamespace<TableObject>;
      LOBBY: DurableObjectNamespace<LobbyObject>;
      SESSIONS: DurableObjectNamespace<SessionObject>;
    }
  }
  type Env = Cloudflare.Env;
}
