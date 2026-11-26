import type { BenchmarkObject } from "./benchmark-object.js";
import type { LobbyObject } from "./lobby-object.js";
import type { TableObject } from "./table-object.js";
import type { SessionObject } from "./session-object.js";

declare global {
  namespace Cloudflare {
    interface Env {
      ASSETS: Fetcher;
      DB: D1Database;
      /** Exact app origin; HTTPS required outside explicitly enabled localhost development. */
      AUTH_PUBLIC_ORIGIN?: string;
      AUTH_ALLOW_INSECURE_LOCALHOST?: string;
      /** Comma-separated internal account IDs allowed to manage benchmarks. */
      BENCHMARK_ADMIN_ACCOUNT_IDS?: string;
      /** Approved sender on the configured provider's verified/onboarded domain. */
      AUTH_EMAIL_FROM?: string;
      /** Cloudflare Email Service binding; takes precedence over the Resend adapter. */
      EMAIL?: SendEmail;
      AUTH_EMAIL_PROVIDER?: "resend";
      /** Worker secret (or ignored local .dev.vars); never store in Wrangler vars. */
      RESEND_API_KEY?: string;
      TABLES: DurableObjectNamespace<TableObject>;
      BENCHMARKS: DurableObjectNamespace<BenchmarkObject>;
      LOBBY: DurableObjectNamespace<LobbyObject>;
      SESSIONS: DurableObjectNamespace<SessionObject>;
    }
  }
  type Env = Cloudflare.Env;
}
