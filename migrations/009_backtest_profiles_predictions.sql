-- 009_backtest_profiles_predictions.sql
-- Rolling profiles pré-jogo (sem leakage) + predictions históricas dos 576 mercados.

-- Perfil de cada time, snapshot ANTES de cada partida (rolling).
-- Uma linha por (id_confronto, team, side) onde side ∈ {home, away}.
CREATE TABLE IF NOT EXISTS backtest_team_profiles (
  id_confronto TEXT NOT NULL,
  team         TEXT NOT NULL,
  liga         TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('home','away')),  -- lado neste jogo
  n_events     INTEGER NOT NULL,                                -- amostras pré-jogo deste lado
  payload      TEXT NOT NULL,                                   -- JSON: avg_gols_marcados, avg_escanteios, ...
  PRIMARY KEY (id_confronto, team, side)
);
CREATE INDEX IF NOT EXISTS ix_btp_team_liga ON backtest_team_profiles(team, liga, side);

-- Priors da liga, snapshot ANTES de cada partida.
CREATE TABLE IF NOT EXISTS backtest_league_priors (
  id_confronto TEXT NOT NULL,
  liga         TEXT NOT NULL,
  period       TEXT NOT NULL CHECK (period IN ('FT','HT')),
  n_events     INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  PRIMARY KEY (id_confronto, liga, period)
);
CREATE INDEX IF NOT EXISTS ix_blp_liga ON backtest_league_priors(liga, period);

-- Predictions históricas — uma linha por (id_confronto, market_key).
-- ~14k partidas × 576 mercados = ~8M linhas.
CREATE TABLE IF NOT EXISTS backtest_predictions (
  id_confronto   TEXT    NOT NULL,
  market_key     TEXT    NOT NULL,
  family         TEXT    NOT NULL,
  scope          TEXT    NOT NULL,
  period         TEXT    NOT NULL,
  direction      TEXT,
  line           REAL,
  fair_prob_raw  REAL    NOT NULL,
  fair_prob      REAL    NOT NULL,
  fair_odd       REAL,
  certified      INTEGER NOT NULL DEFAULT 0,
  lambdas_json   TEXT,
  PRIMARY KEY (id_confronto, market_key)
);
CREATE INDEX IF NOT EXISTS ix_bpr_market ON backtest_predictions(market_key);
CREATE INDEX IF NOT EXISTS ix_bpr_family ON backtest_predictions(family);
