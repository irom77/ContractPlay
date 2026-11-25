-- A signed-in player's results with and against named bots, solo and online: personal records synced from their devices.
CREATE TABLE bot_results (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hand_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  data_json TEXT NOT NULL,             -- BotResult, without the device's owner tag
  PRIMARY KEY (account_id, hand_id)
);
CREATE INDEX bot_results_recent ON bot_results(account_id, recorded_at DESC, hand_id DESC);
