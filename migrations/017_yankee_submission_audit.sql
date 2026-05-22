CREATE TABLE IF NOT EXISTS yankee_submission_audit (
  submission_id            TEXT PRIMARY KEY,
  run_id                   TEXT NOT NULL,
  mode                     TEXT NOT NULL,
  validation_scope         TEXT NOT NULL,
  blocking_json            TEXT NOT NULL DEFAULT '[]',
  external_validation_json TEXT,
  repair_history_json      TEXT NOT NULL DEFAULT '[]',
  effective_overrides_json TEXT NOT NULL DEFAULT '{}',
  real_submit_summary_json TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (submission_id) REFERENCES yankee_submissions(submission_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_yankee_submission_audit_run ON yankee_submission_audit(run_id);

CREATE TABLE IF NOT EXISTS yankee_submission_tickets (
  submission_ticket_id TEXT PRIMARY KEY,
  submission_id        TEXT NOT NULL,
  run_id               TEXT NOT NULL,
  ticket_idx           INTEGER NOT NULL,
  ticket_hash          TEXT NOT NULL,
  match_ids_json       TEXT NOT NULL,
  stake_brl            REAL NOT NULL,
  expected_ticket_odd  REAL,
  actual_ticket_odd    REAL,
  status               TEXT NOT NULL,
  external_ticket_id   TEXT,
  payload_hash         TEXT,
  payload_json         TEXT,
  response_json        TEXT,
  error                TEXT,
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_attempt_at      TEXT,
  submitted_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (submission_id) REFERENCES yankee_submissions(submission_id) ON DELETE CASCADE,
  UNIQUE(submission_id, ticket_idx)
);

CREATE INDEX IF NOT EXISTS idx_yankee_submission_tickets_submission ON yankee_submission_tickets(submission_id);
CREATE INDEX IF NOT EXISTS idx_yankee_submission_tickets_run ON yankee_submission_tickets(run_id);
CREATE INDEX IF NOT EXISTS idx_yankee_submission_tickets_status ON yankee_submission_tickets(status);
CREATE INDEX IF NOT EXISTS idx_yankee_submission_tickets_external ON yankee_submission_tickets(external_ticket_id);
