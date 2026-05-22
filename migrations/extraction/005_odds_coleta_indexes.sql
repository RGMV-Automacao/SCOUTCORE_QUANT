CREATE INDEX IF NOT EXISTS idx_odds_coleta_cert
  ON odds(coleta_id, status_certificacao, id_confronto)
  WHERE coleta_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_odds_historico_coleta
  ON odds_historico(coleta_id, criado_em);