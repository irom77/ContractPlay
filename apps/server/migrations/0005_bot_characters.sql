-- A signed-in player's own bot characters, synced from their devices; deletions stay as tombstones (deleted = 1).
CREATE TABLE bot_characters (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,             -- OwnCharacter, without the device's owner tag
  PRIMARY KEY (account_id, character_id)
);
