-- ============================================================
-- MIGRATION 005 — Attach CLV rows to prediction runs
-- ============================================================
-- The settlement loop promises run-level auditability/idempotence.
-- Future rows carry `run_id`; historical rows remain nullable because
-- older clv_history entries did not persist it.
-- ============================================================

ALTER TABLE clv_history ADD COLUMN run_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_clv_run_market
  ON clv_history(run_id, market_key)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clv_run_id ON clv_history(run_id);

INSERT OR IGNORE INTO schema_version (version) VALUES (5);