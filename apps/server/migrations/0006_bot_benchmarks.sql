-- Benchmark records are independent of personal bot results and account hand history.
CREATE TABLE benchmark_profiles (
  id TEXT NOT NULL PRIMARY KEY
);

CREATE TABLE benchmark_profile_versions (
  profile_id TEXT NOT NULL REFERENCES benchmark_profiles(id),
  version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retired_at INTEGER,
  PRIMARY KEY (profile_id, version)
);
CREATE INDEX benchmark_profile_versions_recent ON benchmark_profile_versions(created_at DESC, profile_id, version);

CREATE TABLE benchmark_imports (
  id TEXT NOT NULL PRIMARY KEY,
  board_count INTEGER NOT NULL CHECK (board_count BETWEEN 1 AND 32),
  boards_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX benchmark_imports_recent ON benchmark_imports(created_at DESC, id);

CREATE TABLE benchmark_cohorts (
  id TEXT NOT NULL PRIMARY KEY,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  retired_at INTEGER
);
CREATE INDEX benchmark_cohorts_recent ON benchmark_cohorts(updated_at DESC, id);

CREATE TABLE benchmark_jobs (
  id TEXT NOT NULL PRIMARY KEY,
  cohort_id TEXT NOT NULL REFERENCES benchmark_cohorts(id),
  cohort_json TEXT NOT NULL,
  profiles_json TEXT NOT NULL,
  import_id TEXT REFERENCES benchmark_imports(id),
  schema_version INTEGER NOT NULL,
  round_index INTEGER NOT NULL CHECK (round_index >= 0),
  rotation_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  score_transform_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'cancelled', 'completed', 'failed')),
  claim_token TEXT,
  claim_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK ((status = 'running') = (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL))
);
CREATE INDEX benchmark_jobs_claimable ON benchmark_jobs(status, claim_expires_at, created_at, id);
CREATE INDEX benchmark_jobs_cohort_recent ON benchmark_jobs(cohort_id, created_at DESC, id DESC);
CREATE INDEX benchmark_jobs_recent ON benchmark_jobs(created_at DESC, id);

CREATE TABLE benchmark_table_assignments (
  job_id TEXT NOT NULL REFERENCES benchmark_jobs(id),
  table_index INTEGER NOT NULL CHECK (table_index BETWEEN 0 AND 7),
  seats_json TEXT NOT NULL,
  PRIMARY KEY (job_id, table_index)
);

CREATE TABLE benchmark_boards (
  job_id TEXT NOT NULL REFERENCES benchmark_jobs(id),
  board_index INTEGER NOT NULL CHECK (board_index BETWEEN 0 AND 31),
  board_number INTEGER NOT NULL CHECK (board_number > 0),
  dealer TEXT NOT NULL CHECK (dealer IN ('north', 'east', 'south', 'west')),
  vulnerability TEXT NOT NULL CHECK (vulnerability IN ('None', 'NS', 'EW', 'Both')),
  deal_json TEXT NOT NULL,
  started_at INTEGER,
  PRIMARY KEY (job_id, board_index),
  UNIQUE (job_id, board_number)
);

CREATE TABLE benchmark_results (
  job_id TEXT NOT NULL,
  table_index INTEGER NOT NULL,
  board_index INTEGER NOT NULL,
  actions_json TEXT NOT NULL,
  contract_json TEXT,
  tricks INTEGER CHECK (tricks BETWEEN 0 AND 13),
  ns_score INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  released_at INTEGER,
  PRIMARY KEY (job_id, table_index, board_index),
  FOREIGN KEY (job_id, table_index) REFERENCES benchmark_table_assignments(job_id, table_index),
  FOREIGN KEY (job_id, board_index) REFERENCES benchmark_boards(job_id, board_index)
);
CREATE INDEX benchmark_results_board ON benchmark_results(job_id, board_index, table_index);
CREATE INDEX benchmark_results_released ON benchmark_results(released_at DESC, job_id, board_index, table_index) WHERE released_at IS NOT NULL;

CREATE TABLE benchmark_rating_periods (
  id TEXT NOT NULL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES benchmark_jobs(id),
  algorithm_version TEXT NOT NULL,
  score_transform_version TEXT NOT NULL,
  rated_at INTEGER NOT NULL,
  observations_json TEXT NOT NULL,
  UNIQUE (job_id, algorithm_version)
);
CREATE INDEX benchmark_rating_periods_recent ON benchmark_rating_periods(rated_at DESC, id DESC);

CREATE TABLE benchmark_rating_snapshots (
  period_id TEXT NOT NULL REFERENCES benchmark_rating_periods(id),
  competitor_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  rating REAL NOT NULL,
  deviation REAL NOT NULL CHECK (deviation > 0),
  volatility REAL NOT NULL CHECK (volatility > 0),
  sample_boards INTEGER NOT NULL CHECK (sample_boards >= 0),
  PRIMARY KEY (period_id, competitor_id),
  UNIQUE (period_id, position)
);
CREATE INDEX benchmark_rating_snapshots_history ON benchmark_rating_snapshots(competitor_id, period_id);
