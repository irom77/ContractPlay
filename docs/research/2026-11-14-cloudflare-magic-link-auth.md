# Cloudflare email magic-link authentication research

**Checked:** 2026-11-14

**Scope:** Cloudflare Workers, D1, Email Service, and Durable Objects, for adding email sign-in to ContractPlay.

## Findings

### D1 schema, bindings, and migrations

- A Worker accesses D1 through a Wrangler `d1_databases` binding; its `binding` name becomes a property on `env` (for example, `DB`). `database_name` and `database_id` identify the actual database. [D1 getting started](https://developers.cloudflare.com/d1/get-started/)
- D1 migrations are sequentially named SQL files, normally under `migrations/`. Wrangler records applied migrations in `d1_migrations`; `wrangler d1 migrations apply` applies pending migrations. Use the stable database name when targeting migrations to avoid ambiguity if a binding is renamed. [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- For this project, a dedicated `apps/server/migrations/` directory and a production D1 binding in `apps/server/wrangler.jsonc` fit the existing Worker layout. This is an implementation suggestion, not a Cloudflare requirement.

### Atomicity and one-time token use

- D1 auto-commits individual statements. `env.DB.batch([...])` runs prepared statements sequentially within one SQL transaction; on a statement failure D1 aborts and rolls back the whole batch. [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- This supports an atomic consume operation: in one batch, validate and mark a token used and create/update the authenticated session (with uniqueness/constraints in the schema). Ensure the consume statement itself only changes an eligible, unexpired, unused token; inspect its result so a zero-row update does not create a session. This is design guidance inferred from the documented batch semantics.
- Email delivery is an external service call and cannot be included in D1's SQL transaction. A request-token row committed before sending can therefore outlive a failed send; decide on expiration, retry, and cleanup behavior. This follows from D1 transaction scope and the separate Email Service API.

### Sending sign-in links

- Cloudflare Email Service supports outbound transactional mail through a Workers `send_email` binding, REST API, or authenticated SMTP. Email Sending is marked **Beta**. The Worker binding is configured in Wrangler and exposes `env.EMAIL.send(...)`. [Email Service](https://developers.cloudflare.com/email-service/) [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) [Email Service beta announcement](https://developers.cloudflare.com/changelog/post/2026-04-16-email-sending-public-beta/)
- Arbitrary recipient sending requires **Workers Paid**. On Free, mail can be sent only to verified destination addresses in the Cloudflare account; that restricted sending is free. After onboarding a sending domain, arbitrary recipients can be used, subject to account quotas and limits. New accounts have a conservative daily quota that can scale; exact limits are account-dependent. [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/) [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)
- Email Service requires Cloudflare DNS, and the sender domain must be onboarded. Setup adds/uses SPF and DKIM records (and MX for bounce handling). [Send first email / domain setup](https://developers.cloudflare.com/email-service/get-started/send-emails/) The binding can be restricted to approved sender addresses; the sender must belong to an onboarded domain. [Send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/)
- Relevant documented constraints include a 50-recipient combined `to`/`cc`/`bcc` maximum and 25 MiB maximum message size. A magic-link email is far below those limits, but rate and daily quotas still matter. [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/)
- Email Service is the supported Cloudflare first-party sending option found for Workers. The built-in `Email Routing` product is for inbound forwarding/Worker processing, not outbound sign-in mail; sending is the distinct Email Sending capability. The Email Service docs also support external providers through their REST/SMTP integrations, but those are third-party choices.

### Configuration and secrets

- Non-sensitive settings (for example, public origin and sender address) can be ordinary Wrangler vars. Keep signing/encryption keys and any external provider credentials in Worker secrets, not `vars` or committed config. A secret is exposed to code as an environment binding but its value is hidden in the dashboard/Wrangler after setting it. Use `wrangler secret put`; local development supports `.dev.vars` or `.env` (choose one and do not commit it). [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- Wrangler's `secrets.required` can declare required secret names for type generation and fail deploy/version upload when a required value is missing. [Wrangler secrets configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- Cloudflare Email Service's native Worker binding avoids an API token secret for basic sending. If using the REST API instead, keep its bearer token secret. In either case, cryptographically generated one-time tokens and a server-held hash/HMAC key are application design choices, not services provided by D1 or Email Service.

### Durable Objects and D1 together

- Durable Objects are single-instance coordination points with private, strongly consistent, transactional attached storage. They are appropriate for the current table/session coordination model; Cloudflare recommends SQLite-backed Durable Objects for new namespaces. [What are Durable Objects?](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- D1 is a separately bound database with SQL migrations and a Worker binding. A Worker or Durable Object can use configured bindings, but D1 and a DO's private SQLite storage are separate stores; Cloudflare documents transactions for each store separately, not a transaction spanning both. Keep account/session/token invariants in D1 and use identity/session claims to authorize requests to the existing table Durable Objects. This separation recommendation is inferred from the documented storage boundaries.
- Durable Objects should handle coordination rather than general stateless request work. Their transaction API is for atomic read-modify-write against that object's own storage; `blockConcurrencyWhile()` is meant sparingly, such as initialization, and should not wrap external I/O. [DO rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) [DO storage access](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)

## Project-specific note

At research time the Worker has Durable Object bindings for `TABLES`, `LOBBY`, and `SESSIONS`, but no D1 binding. Sign-in therefore introduces the first SQL database and its deployment/migration lifecycle. Existing Worker configuration is [apps/server/wrangler.jsonc](../../apps/server/wrangler.jsonc). Cloudflare's docs establish the platform behavior above; they do not specify the application's account linking, email normalization, token lifetime, session-cookie policy, abuse controls, or user-to-seat authorization rules.
