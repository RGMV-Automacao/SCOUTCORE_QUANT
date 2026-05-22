-- Single DB bootstrap para backtest histórico preservado no banco único.

CREATE TABLE IF NOT EXISTS backtest_outcomes (
  id_confronto TEXT PRIMARY KEY,
  liga         TEXT NOT NULL,
  temporada    TEXT,
  data_partida TEXT,
  home_team    TEXT NOT NULL,
  away_team    TEXT NOT NULL,
  gols_ft_home INTEGER, gols_ft_away INTEGER, gols_ft_total INTEGER,
  gols_ht_home INTEGER, gols_ht_away INTEGER, gols_ht_total INTEGER,
  escanteios_ft_home INTEGER, escanteios_ft_away INTEGER, escanteios_ft_total INTEGER,
  escanteios_ht_home INTEGER, escanteios_ht_away INTEGER, escanteios_ht_total INTEGER,
  chutes_ft_home INTEGER, chutes_ft_away INTEGER, chutes_ft_total INTEGER,
  chutes_ht_home INTEGER, chutes_ht_away INTEGER, chutes_ht_total INTEGER,
  sot_ft_home INTEGER, sot_ft_away INTEGER, sot_ft_total INTEGER,
  sot_ht_home INTEGER, sot_ht_away INTEGER, sot_ht_total INTEGER,
  ca_ft_home INTEGER, ca_ft_away INTEGER, ca_ft_total INTEGER,
  ca_ht_home INTEGER, ca_ht_away INTEGER, ca_ht_total INTEGER,
  cv_ft_home INTEGER, cv_ft_away INTEGER, cv_ft_total INTEGER,
  cv_ht_home INTEGER, cv_ht_away INTEGER, cv_ht_total INTEGER,
  bp_ft_home INTEGER, bp_ft_away INTEGER, bp_ft_total INTEGER,
  bp_ht_home INTEGER, bp_ht_away INTEGER, bp_ht_total INTEGER,
  imp_ft_home INTEGER, imp_ft_away INTEGER, imp_ft_total INTEGER,
  imp_ht_home INTEGER, imp_ht_away INTEGER, imp_ht_total INTEGER,
  faltas_ft_home INTEGER, faltas_ft_away INTEGER, faltas_ft_total INTEGER,
  faltas_ht_home INTEGER, faltas_ht_away INTEGER, faltas_ht_total INTEGER,
  btts_ft INTEGER,
  resultado_ft TEXT,
  btts_ht INTEGER,
  resultado_ht TEXT,
  marca_home_ft INTEGER, marca_away_ft INTEGER,
  marca_home_ht INTEGER, marca_away_ht INTEGER,
  source_stats TEXT NOT NULL,
  built_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_bt_outcomes_liga ON backtest_outcomes(liga);
CREATE INDEX IF NOT EXISTS ix_bt_outcomes_data ON backtest_outcomes(data_partida);
CREATE INDEX IF NOT EXISTS ix_bt_outcomes_temporada ON backtest_outcomes(temporada);

CREATE TABLE IF NOT EXISTS backtest_predictions (
  id_confronto   TEXT NOT NULL,
  market_key     TEXT NOT NULL,
  family         TEXT NOT NULL,
  scope          TEXT NOT NULL,
  period         TEXT NOT NULL,
  direction      TEXT,
  line           REAL,
  fair_prob_raw  REAL NOT NULL,
  fair_prob      REAL NOT NULL,
  fair_odd       REAL,
  certified      INTEGER NOT NULL DEFAULT 0,
  lambdas_json   TEXT,
  PRIMARY KEY (id_confronto, market_key)
);

CREATE INDEX IF NOT EXISTS ix_bpr_market ON backtest_predictions(market_key);
CREATE INDEX IF NOT EXISTS ix_bpr_family ON backtest_predictions(family);

CREATE TABLE IF NOT EXISTS backtest_eval (
  id_confronto TEXT NOT NULL,
  market_key   TEXT NOT NULL,
  fair_prob    REAL NOT NULL,
  observed     INTEGER,
  outcome      TEXT NOT NULL,
  reason       TEXT,
  PRIMARY KEY (id_confronto, market_key)
);

CREATE INDEX IF NOT EXISTS ix_be_market ON backtest_eval(market_key);
CREATE INDEX IF NOT EXISTS ix_be_outcome ON backtest_eval(outcome);

CREATE TABLE IF NOT EXISTS backtest_team_profiles (
  id_confronto TEXT NOT NULL,
  team         TEXT NOT NULL,
  liga         TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('home','away')),
  n_events     INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  PRIMARY KEY (id_confronto, team, side)
);

CREATE INDEX IF NOT EXISTS ix_btp_team_liga ON backtest_team_profiles(team, liga, side);

CREATE TABLE IF NOT EXISTS backtest_league_priors (
  id_confronto TEXT NOT NULL,
  liga         TEXT NOT NULL,
  period       TEXT NOT NULL CHECK (period IN ('FT','HT')),
  n_events     INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  PRIMARY KEY (id_confronto, liga, period)
);

CREATE INDEX IF NOT EXISTS ix_blp_liga ON backtest_league_priors(liga, period);