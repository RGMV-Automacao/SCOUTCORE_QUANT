-- 008_backtest_outcomes.sql
-- Ground truth agregada por partida, FT + HT, com totais e por equipe.
-- Fontes: times.modo, confronto.modo (primário) → eventos_faixa (fallback).
-- Regras alinhadas a ApolloFinalV2/product/resolver.cjs.

CREATE TABLE IF NOT EXISTS backtest_outcomes (
  id_confronto TEXT PRIMARY KEY,
  liga         TEXT NOT NULL,
  temporada    TEXT,
  data_partida TEXT,
  home_team    TEXT NOT NULL,
  away_team    TEXT NOT NULL,

  -- Gols (sempre de partidas)
  gols_ft_home INTEGER, gols_ft_away INTEGER, gols_ft_total INTEGER,
  gols_ht_home INTEGER, gols_ht_away INTEGER, gols_ht_total INTEGER,

  -- Escanteios
  escanteios_ft_home INTEGER, escanteios_ft_away INTEGER, escanteios_ft_total INTEGER,
  escanteios_ht_home INTEGER, escanteios_ht_away INTEGER, escanteios_ht_total INTEGER,

  -- Chutes (todos)
  chutes_ft_home INTEGER, chutes_ft_away INTEGER, chutes_ft_total INTEGER,
  chutes_ht_home INTEGER, chutes_ht_away INTEGER, chutes_ht_total INTEGER,

  -- Chutes no alvo (SoT)
  sot_ft_home INTEGER, sot_ft_away INTEGER, sot_ft_total INTEGER,
  sot_ht_home INTEGER, sot_ht_away INTEGER, sot_ht_total INTEGER,

  -- Cartões amarelos
  ca_ft_home INTEGER, ca_ft_away INTEGER, ca_ft_total INTEGER,
  ca_ht_home INTEGER, ca_ht_away INTEGER, ca_ht_total INTEGER,

  -- Cartões vermelhos
  cv_ft_home INTEGER, cv_ft_away INTEGER, cv_ft_total INTEGER,
  cv_ht_home INTEGER, cv_ht_away INTEGER, cv_ht_total INTEGER,

  -- Booking points = amarelo + 2*vermelho (regra Apollo)
  bp_ft_home INTEGER, bp_ft_away INTEGER, bp_ft_total INTEGER,
  bp_ht_home INTEGER, bp_ht_away INTEGER, bp_ht_total INTEGER,

  -- Impedimentos
  imp_ft_home INTEGER, imp_ft_away INTEGER, imp_ft_total INTEGER,
  imp_ht_home INTEGER, imp_ht_away INTEGER, imp_ht_total INTEGER,

  -- Faltas (cometidas)
  faltas_ft_home INTEGER, faltas_ft_away INTEGER, faltas_ft_total INTEGER,
  faltas_ht_home INTEGER, faltas_ht_away INTEGER, faltas_ht_total INTEGER,

  -- Label markets (FT)
  btts_ft       INTEGER, -- 1 se ambas marcaram em FT
  resultado_ft  TEXT,    -- '1' | 'X' | '2'
  -- Label markets (HT)
  btts_ht       INTEGER,
  resultado_ht  TEXT,

  -- Marca/Não marca por equipe
  marca_home_ft INTEGER, marca_away_ft INTEGER,
  marca_home_ht INTEGER, marca_away_ht INTEGER,

  -- Procedência
  source_stats  TEXT NOT NULL,    -- 'times' | 'eventos_faixa' | 'mixed'
  built_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_bt_outcomes_liga      ON backtest_outcomes(liga);
CREATE INDEX IF NOT EXISTS ix_bt_outcomes_data      ON backtest_outcomes(data_partida);
CREATE INDEX IF NOT EXISTS ix_bt_outcomes_temporada ON backtest_outcomes(temporada);
