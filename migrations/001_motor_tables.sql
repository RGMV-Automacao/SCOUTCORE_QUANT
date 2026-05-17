-- SCOUTCORE_QUANT — Migration 001: tabelas próprias do motor
-- Aplicada em scout.db DEPOIS do wipe das tabelas de motor antigo.
-- Roda via: npm run setup:migrate

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── isotonic_blob: calibradores serializados ─────────────────────
CREATE TABLE IF NOT EXISTS isotonic_blob (
  family              TEXT NOT NULL,
  liga                TEXT NOT NULL,
  direction           TEXT NOT NULL,
  blob_bytes          BLOB NOT NULL,
  n_samples           INTEGER NOT NULL,
  fit_at              TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (family, liga, direction)
);

-- ─── clv_history: settlement econômico (brier + CLV) ───────────────
CREATE TABLE IF NOT EXISTS clv_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id            TEXT NOT NULL,
  market_key          TEXT NOT NULL,
  family              TEXT NOT NULL,
  liga                TEXT NOT NULL,
  fair_prob_motor     REAL NOT NULL,
  fair_odd_motor      REAL NOT NULL,
  prob_a              REAL,
  prob_b              REAL,
  odd_open            REAL,
  odd_close           REAL,
  result              TEXT NOT NULL,        -- 'green' | 'red' | 'void'
  brier_a             REAL,
  brier_b             REAL,
  clv_pct             REAL,
  source              TEXT NOT NULL,        -- 'replay_v1' | 'live'
  settled_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clv_match ON clv_history(match_id);
CREATE INDEX IF NOT EXISTS idx_clv_family_liga ON clv_history(family, liga);
CREATE INDEX IF NOT EXISTS idx_clv_settled ON clv_history(settled_at);

-- ─── feature_snapshot_cache: PIT enforced ──────────────────────────
CREATE TABLE IF NOT EXISTS feature_snapshot_cache (
  match_id            TEXT NOT NULL,
  feature_set         TEXT NOT NULL,        -- 'v3-bands' | 'v3-base' etc
  payload             TEXT NOT NULL,        -- JSON
  built_at            TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (match_id, feature_set)
);

-- ─── replay_progress: controle do backfill (one-time) ──────────────
CREATE TABLE IF NOT EXISTS replay_progress (
  key                 TEXT PRIMARY KEY,
  value               TEXT NOT NULL,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── sync_check_log: ops do dual-write ─────────────────────────────
CREATE TABLE IF NOT EXISTS sync_check_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at              TEXT NOT NULL,
  payload             TEXT NOT NULL,        -- JSON com drift por tabela
  has_drift           INTEGER NOT NULL DEFAULT 0
);

-- ─── schema_version ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
  version             INTEGER PRIMARY KEY,
  applied_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
