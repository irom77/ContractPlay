CREATE TABLE archived_deals (
  id TEXT PRIMARY KEY,                 -- random id
  pool TEXT NOT NULL CHECK (pool IN ('solo', 'online')), -- where it was first played; replays stay in their pool
  deal_key TEXT NOT NULL,              -- canonical cards + dealer, so one deal is archived once per pool
  deal_json TEXT NOT NULL,             -- Deal
  dealer TEXT NOT NULL,
  vulnerability TEXT NOT NULL,        -- as first played
  first_played_at INTEGER NOT NULL,
  original_actions_json TEXT NOT NULL, -- the first play's GameAction[], for "View original"
  UNIQUE (pool, deal_key)
);
CREATE INDEX archived_deals_age ON archived_deals(pool, first_played_at);
CREATE TABLE deal_results (
  deal_id TEXT NOT NULL REFERENCES archived_deals(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('solo', 'online')),
  vulnerability TEXT NOT NULL,         -- as this result was played (rubber replays may differ from the deal's)
  contract TEXT NOT NULL,              -- PBN text: "4S", "3NTX", "Pass"
  declarer TEXT,
  tricks INTEGER,
  ns_score INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0   -- 1 when the hand ended in a claim
);
CREATE INDEX deal_results_deal ON deal_results(deal_id, played_at);
