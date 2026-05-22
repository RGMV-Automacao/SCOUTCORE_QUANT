-- migrations/extraction/006_motor_state.sql
-- Tabelas de estado do motor scout (calibracao, predicoes, runs, yankee, clv).
-- Schema introspectado de data/scout_extraction.db em 2026-05-17 apos cutover real (single-db).
-- Idempotente: usa CREATE ... IF NOT EXISTS para permitir re-aplicar sem erro.

-- ======================================================================
-- calib_state
-- ======================================================================
CREATE TABLE IF NOT EXISTS calib_state (
  engine             TEXT NOT NULL,
  family             TEXT NOT NULL,
  direction          TEXT NOT NULL,
  liga               TEXT NOT NULL,
  lambda_mult        REAL NOT NULL DEFAULT 1.0,
  confidence_factor  REAL NOT NULL DEFAULT 1.0,
  line_shift         REAL NOT NULL DEFAULT 0.0,
  ewma_hr            REAL NOT NULL DEFAULT 0.5,
  ewma_brier         REAL,
  clv_score          REAL,
  isotonic_blob      BLOB,
  isotonic_version   TEXT,
  sample_size        INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (engine, family, direction, liga)
);
CREATE INDEX IF NOT EXISTS idx_calib_state_lookup ON calib_state(family, direction, liga);

-- ======================================================================
-- isotonic_blob
-- ======================================================================
CREATE TABLE IF NOT EXISTS isotonic_blob (
  family     TEXT NOT NULL,
  liga       TEXT NOT NULL,
  period     TEXT NOT NULL DEFAULT 'FT',
  direction  TEXT NOT NULL,
  blob_bytes BLOB NOT NULL,
  n_samples  INTEGER NOT NULL,
  fit_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (family, liga, period, direction)
);

-- ======================================================================
-- team_profile_v2
-- ======================================================================
CREATE TABLE IF NOT EXISTS team_profile_v2 (
  team       TEXT NOT NULL,
  liga       TEXT NOT NULL,
  temporada  TEXT NOT NULL,
  side       TEXT NOT NULL CHECK(side IN ('home','away','overall')),
  as_of      TEXT NOT NULL,
  n          INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team, liga, temporada, side, as_of)
);
CREATE INDEX IF NOT EXISTS idx_tp_v2_team_liga_asof ON team_profile_v2(team, liga, as_of);

-- ======================================================================
-- team_profiles
-- ======================================================================
CREATE TABLE IF NOT EXISTS team_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT NOT NULL,
  liga TEXT NOT NULL,
  temporada TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('home', 'away', 'overall')),
  n INTEGER NOT NULL DEFAULT 0,
  avg_gols_marcados REAL,
  avg_gols_sofridos REAL,
  avg_gols_total REAL,
  avg_escanteios REAL,
  avg_escanteios_sofridos REAL,
  var_escanteios REAL,
  avg_chutes REAL,
  avg_chutes_no_alvo REAL,
  avg_chutes_bloqueados REAL,
  avg_chutes_sofridos REAL,
  var_chutes REAL,
  avg_cartoes_amarelos REAL,
  avg_cartoes_vermelhos REAL,
  var_cartoes REAL,
  avg_faltas_cometidas REAL,
  avg_faltas_sofridas REAL,
  var_faltas REAL,
  avg_posse REAL,
  avg_passes REAL,
  avg_passes_certos REAL,
  pass_accuracy REAL,
  avg_cruzamentos REAL,
  avg_desarmes REAL,
  avg_desarmes_certos REAL,
  avg_impedimentos REAL,
  avg_defesas REAL,
  clean_sheet_rate REAL,
  avg_intensity REAL,
  std_intensity REAL,
  last_intensity_zscore REAL,
  ht1_share REAL,
  ht2_share REAL,
  front_loaded INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(team, liga, temporada, side)
);
CREATE INDEX IF NOT EXISTS idx_team_profiles_lookup ON team_profiles(team, liga, temporada);

-- ======================================================================
-- league_priors
-- ======================================================================
CREATE TABLE IF NOT EXISTS league_priors (
  liga       TEXT NOT NULL,
  temporada  TEXT NOT NULL,
  period     TEXT NOT NULL,
  payload    TEXT NOT NULL,
  as_of      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (liga, temporada, period, as_of)
);

-- ======================================================================
-- prediction
-- ======================================================================
CREATE TABLE IF NOT EXISTS prediction (
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
  actual_value  REAL,
  PRIMARY KEY (run_id, match_id, market_key)
);
CREATE INDEX IF NOT EXISTS idx_prediction_calib ON prediction(family, direction, liga, result);
CREATE INDEX IF NOT EXISTS idx_prediction_match ON prediction(match_id, match_date);
CREATE INDEX IF NOT EXISTS idx_prediction_run ON prediction(run_id);
CREATE INDEX IF NOT EXISTS idx_prediction_unset ON prediction(result) WHERE result IS NULL;

-- ======================================================================
-- motor_run
-- ======================================================================
CREATE TABLE IF NOT EXISTS motor_run (
  run_id           TEXT PRIMARY KEY,
  match_id         TEXT NOT NULL,
  engine_signature TEXT NOT NULL,
  request_payload  TEXT NOT NULL,
  response_payload TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_motor_run_match ON motor_run(match_id, created_at);

-- ======================================================================
-- runs
-- ======================================================================
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  date_start  TEXT NOT NULL,
  date_end    TEXT NOT NULL,
  matches     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_seq     INTEGER,
  run_label   TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at);

-- ======================================================================
-- run_slots
-- ======================================================================
CREATE TABLE IF NOT EXISTS run_slots (
  run_id      TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  match_id    TEXT,
  market_key  TEXT NOT NULL,
  payload     TEXT NOT NULL,
  PRIMARY KEY (run_id, idx),
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_run_slots_run ON run_slots(run_id);

-- ======================================================================
-- clv_history
-- ======================================================================
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
  result              TEXT NOT NULL,
  brier_a             REAL,
  brier_b             REAL,
  clv_pct             REAL,
  source              TEXT NOT NULL,
  settled_at          TEXT NOT NULL DEFAULT (datetime('now')),
  run_id              TEXT
);
CREATE INDEX IF NOT EXISTS idx_clv_family_liga ON clv_history(family, liga);
CREATE INDEX IF NOT EXISTS idx_clv_match ON clv_history(match_id);
CREATE INDEX IF NOT EXISTS idx_clv_run_id ON clv_history(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clv_run_market
  ON clv_history(run_id, market_key)
  WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clv_settled ON clv_history(settled_at);

-- ======================================================================
-- yankee_submissions
-- ======================================================================
CREATE TABLE IF NOT EXISTS yankee_submissions (
  submission_id    TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
  is_dry_run       INTEGER NOT NULL,
  stake_per_ticket REAL NOT NULL,
  tickets_count    INTEGER NOT NULL,
  stake_total      REAL NOT NULL,
  status           TEXT NOT NULL,
  warnings         TEXT,
  tickets_json     TEXT NOT NULL,
  settled_at       TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_yankee_subs_date ON yankee_submissions(submitted_at);
CREATE INDEX IF NOT EXISTS idx_yankee_subs_run ON yankee_submissions(run_id);
CREATE INDEX IF NOT EXISTS idx_yankee_subs_settled_at ON yankee_submissions(settled_at);
CREATE INDEX IF NOT EXISTS idx_yankee_subs_status ON yankee_submissions(status);

-- ======================================================================
-- schema_migrations
-- ======================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
