-- ============================================================
-- MIGRATION 006 — Fix prediction PRIMARY KEY para suportar batch runs
-- ============================================================
-- Problem: PK (run_id, market_key) foi desenhada para predições individuais
-- onde run_id é UUID único por partida. Com batch runs, run_id é compartilhado
-- entre N partidas → INSERT OR IGNORE descarta silenciosamente partidas 2..N.
-- Fix: incluir match_id na PK → (run_id, match_id, market_key).
-- ============================================================

PRAGMA journal_mode = WAL;

-- Preservar dados existentes
CREATE TABLE prediction_old AS SELECT * FROM prediction;

DROP TABLE prediction;

CREATE TABLE prediction (
  run_id        TEXT NOT NULL,
  match_id      TEXT NOT NULL,
  match_date    TEXT NOT NULL,
  liga          TEXT NOT NULL,
  family        TEXT NOT NULL,
  scope         TEXT NOT NULL,
  period        TEXT NOT NULL,
  direction     TEXT NOT NULL,
  line          REAL,
  market_key    TEXT NOT NULL,
  fair_prob     REAL NOT NULL,
  market_odd    REAL,
  edge_pct      REAL,
  confidence    REAL NOT NULL,
  certified     INTEGER NOT NULL DEFAULT 0,
  result        TEXT,
  settled_at    TEXT,
  provenance    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, match_id, market_key)
);

INSERT INTO prediction SELECT * FROM prediction_old;
DROP TABLE prediction_old;

CREATE INDEX IF NOT EXISTS idx_prediction_run      ON prediction(run_id);
CREATE INDEX IF NOT EXISTS idx_prediction_match    ON prediction(match_id, match_date);
CREATE INDEX IF NOT EXISTS idx_prediction_unset    ON prediction(result) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS idx_prediction_calib    ON prediction(family, direction, liga, result);

INSERT OR IGNORE INTO schema_version(version) VALUES (6);
