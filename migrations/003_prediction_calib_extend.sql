-- ============================================================
-- MIGRATION 003 — Prediction + extend calib_state
-- ============================================================
-- Objetivo: persistir slots gerados pelo /v1/predict para que o
-- settler possa avaliar resultado real e atualizar calib_state via EWMA.
--
-- Mudanças:
--   1. Recria calib_state com PK estendida incluindo `direction`,
--      adiciona lambda_mult, confidence_factor, line_shift, ewma_brier.
--   2. Cria tabela `prediction` (slots persistidos, idempotente por hash).
-- ============================================================

-- 1) calib_state (recriado — vazio em produção)
DROP TABLE IF EXISTS calib_state;
CREATE TABLE calib_state (
  engine             TEXT NOT NULL,                -- 'A' | 'B'
  family             TEXT NOT NULL,                -- gols, btts, escanteios, ...
  direction          TEXT NOT NULL,                -- 'over' | 'under' | 'label' | 'handicap'
  liga               TEXT NOT NULL,
  lambda_mult        REAL NOT NULL DEFAULT 1.0,    -- multiplicador a aplicar em λ predito (over/under)
  confidence_factor  REAL NOT NULL DEFAULT 1.0,    -- multiplicador de confidence final (0.40..1.20)
  line_shift         REAL NOT NULL DEFAULT 0.0,    -- shift aditivo na line (futuro)
  ewma_hr            REAL NOT NULL DEFAULT 0.5,    -- EWMA hit-rate observado
  ewma_brier         REAL,                         -- EWMA Brier score (futuro)
  clv_score          REAL,                         -- CLV (futuro)
  isotonic_blob      BLOB,
  isotonic_version   TEXT,
  sample_size        INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (engine, family, direction, liga)
);
CREATE INDEX IF NOT EXISTS idx_calib_state_lookup ON calib_state(family, direction, liga);

-- 2) prediction (slots persistidos)
-- Idempotência: PK (run_id, market_key). run_id já é UUID por chamada do /v1/predict.
CREATE TABLE IF NOT EXISTS prediction (
  run_id        TEXT NOT NULL,
  match_id      TEXT NOT NULL,             -- match.id (external_id namespaced)
  match_date    TEXT NOT NULL,
  liga          TEXT NOT NULL,
  family        TEXT NOT NULL,
  scope         TEXT NOT NULL,             -- total | home | away
  period        TEXT NOT NULL,             -- FT | HT | 2T
  direction     TEXT NOT NULL,
  line          REAL,
  market_key    TEXT NOT NULL,
  fair_prob     REAL NOT NULL,
  market_odd    REAL,
  edge_pct      REAL,
  confidence    REAL NOT NULL,
  certified     INTEGER NOT NULL DEFAULT 0,
  result        TEXT,                      -- 'green' | 'red' | NULL
  settled_at    TEXT,
  provenance    TEXT,                      -- JSON
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, market_key)
);
CREATE INDEX IF NOT EXISTS idx_prediction_match  ON prediction(match_id, match_date);
CREATE INDEX IF NOT EXISTS idx_prediction_unset  ON prediction(result) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS idx_prediction_calib  ON prediction(family, direction, liga, result);
