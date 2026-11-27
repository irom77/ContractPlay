-- Admins granted on /admin. Bootstrap admins stay in the BENCHMARK_ADMIN_ACCOUNT_IDS Worker secret.
CREATE TABLE account_admins (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL
);
-- Addresses that never get sign-in mail and whose links and sessions stop working.
CREATE TABLE blocked_emails (
  email TEXT PRIMARY KEY CHECK (email = lower(trim(email))),
  blocked_at INTEGER NOT NULL
);
-- New players waiting for an admin; approved_at is set once approved, so later requests get links straight away.
-- No guest identity is kept: anyone can ask in a stranger's name, so an approval link never links a guest seat.
CREATE TABLE signup_requests (
  email TEXT PRIMARY KEY CHECK (email = lower(trim(email))),
  display_name TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  approved_at INTEGER
);
CREATE INDEX signup_requests_pending ON signup_requests(approved_at, requested_at);
