ALTER TABLE odds ADD COLUMN snapshot_id TEXT;
ALTER TABLE odds ADD COLUMN quote_signature TEXT;

ALTER TABLE odds_historico ADD COLUMN snapshot_id TEXT;
ALTER TABLE odds_historico ADD COLUMN quote_signature TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_odds_snapshot_id
  ON odds(snapshot_id)
  WHERE snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_odds_quote_signature_time
  ON odds(quote_signature, criado_em, coleta_id)
  WHERE quote_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_odds_historico_signature_time
  ON odds_historico(quote_signature, criado_em, coleta_id)
  WHERE quote_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_certificacao_liga_status
  ON certificacao_liga(status, statsline_status, bookline_status, updated_at);