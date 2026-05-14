-- 010_backtest_eval.sql
-- Outcome (green/red/push/void) por (id_confronto, market_key) gerado por settle()
-- usando dados reais de backtest_outcomes. Persistido apenas para auditoria;
-- métricas/calibração leem direto via JOIN com backtest_predictions.

CREATE TABLE IF NOT EXISTS backtest_eval (
  id_confronto TEXT NOT NULL,
  market_key   TEXT NOT NULL,
  fair_prob    REAL NOT NULL,        -- copiado de backtest_predictions para evitar JOIN
  observed     INTEGER,              -- 1 = green, 0 = red, NULL = push/void
  outcome      TEXT NOT NULL,        -- 'green' | 'red' | 'push' | 'void'
  reason       TEXT,                 -- razão (quando void)
  PRIMARY KEY (id_confronto, market_key)
);

CREATE INDEX IF NOT EXISTS ix_be_market ON backtest_eval(market_key);
CREATE INDEX IF NOT EXISTS ix_be_outcome ON backtest_eval(outcome);
