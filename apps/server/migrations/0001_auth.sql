CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  display_name TEXT NOT NULL,
  primary_player_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE account_player_identities (
  player_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX account_player_identities_account ON account_player_identities(account_id);
CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  guest_player_id TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  redemption_id TEXT UNIQUE
);
CREATE INDEX magic_links_expiry ON magic_links(expires_at);
CREATE TABLE sessions (
  session_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE online_hands (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hand_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (account_id, hand_id)
);
CREATE INDEX online_hands_recent ON online_hands(account_id, completed_at DESC, hand_id DESC);
