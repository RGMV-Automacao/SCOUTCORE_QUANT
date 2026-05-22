ALTER TABLE partidas ADD COLUMN id_liga TEXT;
ALTER TABLE partidas ADD COLUMN rodada TEXT;
ALTER TABLE partidas ADD COLUMN confronto TEXT;
ALTER TABLE partidas ADD COLUMN data_brasil TEXT;
ALTER TABLE partidas ADD COLUMN hora_brasil TEXT;
ALTER TABLE partidas ADD COLUMN competition_id TEXT;

CREATE INDEX IF NOT EXISTS idx_partidas_data_brasil
  ON partidas(data_brasil, hora_brasil);
