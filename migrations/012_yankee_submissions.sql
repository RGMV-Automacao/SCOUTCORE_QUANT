-- Snapshot persistente das submissões de Yankee (Bloco 3.4).
-- Cada linha = um ato de submissão (dry-run OU real) sobre o board de um run.
-- Usado para auditar histórico de apostas registradas e cruzar com outcomes.
CREATE TABLE IF NOT EXISTS yankee_submissions (
  submission_id    TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  is_dry_run       INTEGER NOT NULL,         -- 0 ou 1
  stake_per_ticket REAL NOT NULL,
  tickets_count    INTEGER NOT NULL,
  stake_total      REAL NOT NULL,
  status           TEXT NOT NULL,            -- 'validated' | 'submitted' | 'rejected'
  warnings         TEXT,                     -- JSON array de strings
  tickets_json     TEXT NOT NULL,            -- JSON do snapshot dos tickets
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_yankee_subs_run     ON yankee_submissions(run_id);
CREATE INDEX IF NOT EXISTS idx_yankee_subs_status  ON yankee_submissions(status);
CREATE INDEX IF NOT EXISTS idx_yankee_subs_date    ON yankee_submissions(submitted_at);
