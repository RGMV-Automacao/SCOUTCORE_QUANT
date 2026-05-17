-- ============================================================
-- MIGRATION 002 — Motor 4x4 CORE tables (SPEC §6.2)
-- ============================================================
-- Convivem com o schema legado (partidas/eventos_faixa/odds/team_profiles)
-- que vem do dual-write. Estas são as tabelas que o motor usa direto.
-- Não há FK para o legado: integridade referencial é por convenção.
-- ============================================================

-- match (visão canônica do motor; pode ser populada por ETL a partir de partidas)
CREATE TABLE IF NOT EXISTS match (
  id           TEXT PRIMARY KEY,         -- external_id namespaced ex: opta:2877441
  liga         TEXT NOT NULL,
  home         TEXT NOT NULL,
  away         TEXT NOT NULL,
  date         TEXT NOT NULL,            -- ISO YYYY-MM-DD
  hora         TEXT,                     -- HH:MM
  external_ids TEXT NOT NULL DEFAULT '{}',  -- JSON
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_match_liga_date ON match(liga, date);

-- team_stat (PIT — D9)
CREATE TABLE IF NOT EXISTS team_stat (
  team         TEXT NOT NULL,
  liga         TEXT NOT NULL,
  match_date   TEXT NOT NULL,
  stat_payload TEXT NOT NULL,            -- JSON
  valid_from   TEXT NOT NULL,            -- nunca consultar com asOf < valid_from
  PRIMARY KEY (team, liga, match_date)
);

-- feature_snapshot (PIT)
CREATE TABLE IF NOT EXISTS feature_snapshot (
  match_id     TEXT NOT NULL,
  feature_set  TEXT NOT NULL,
  payload      TEXT NOT NULL,            -- JSON
  generated_at TEXT NOT NULL,
  valid_from   TEXT NOT NULL,
  PRIMARY KEY (match_id, feature_set)
);

-- calib_state (idempotente; uma linha por engine×family×liga)
CREATE TABLE IF NOT EXISTS calib_state (
  engine             TEXT NOT NULL,      -- 'A' | 'B'
  family             TEXT NOT NULL,      -- gols, btts, 1x2, escanteios, ...
  liga               TEXT NOT NULL,
  ewma_hr            REAL NOT NULL DEFAULT 0,
  ewma_brier         REAL,
  clv_score          REAL,
  isotonic_blob      BLOB,
  isotonic_version   TEXT,
  sample_size        INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (engine, family, liga)
);

-- motor_run (auditoria/replay)
CREATE TABLE IF NOT EXISTS motor_run (
  run_id           TEXT PRIMARY KEY,
  match_id         TEXT NOT NULL,
  engine_signature TEXT NOT NULL,        -- JSON
  request_payload  TEXT NOT NULL,
  response_payload TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_motor_run_match ON motor_run(match_id, created_at);

-- team_profile_v2 (motor recompute, separado do legacy team_profiles)
-- O motor reconstrói este via job rebuild-team-profiles, sem depender do FutMax.
CREATE TABLE IF NOT EXISTS team_profile_v2 (
  team       TEXT NOT NULL,
  liga       TEXT NOT NULL,
  temporada  TEXT NOT NULL,
  side       TEXT NOT NULL CHECK(side IN ('home','away','overall')),
  as_of      TEXT NOT NULL,              -- data-corte (PIT)
  n          INTEGER NOT NULL,
  payload    TEXT NOT NULL,              -- JSON com avg_*, var_*, splits
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team, liga, temporada, side, as_of)
);
CREATE INDEX IF NOT EXISTS idx_tp_v2_team_liga_asof ON team_profile_v2(team, liga, as_of);

-- league_priors (baseline por liga × temporada × período)
CREATE TABLE IF NOT EXISTS league_priors (
  liga       TEXT NOT NULL,
  temporada  TEXT NOT NULL,
  period     TEXT NOT NULL,              -- FT | HT | 2T
  payload    TEXT NOT NULL,              -- JSON: avg_goals_total, btts_rate, over_25_rate, avg_corners_total, ...
  as_of      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (liga, temporada, period, as_of)
);
