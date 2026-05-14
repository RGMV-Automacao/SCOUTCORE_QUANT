-- Persistência de runs (substitui RUNS_CACHE in-memory).
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  date_start  TEXT NOT NULL,
  date_end    TEXT NOT NULL,
  matches     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS run_slots (
  run_id      TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  match_id    TEXT,
  market_key  TEXT NOT NULL,
  payload     TEXT NOT NULL,  -- JSON do slot completo (com home/away/liga/date)
  PRIMARY KEY (run_id, idx),
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_slots_run ON run_slots(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);
