-- migrations/011_isotonic_period.sql
-- Estende a chave da isotonic_blob para incluir `period`. Sem isto, fits
-- combinam HT/FT/2T e ficam inúteis para famílias com perfil temporal distinto
-- (ex.: cartões HT vs FT, chutes HT vs FT, escanteios HT vs FT).
--
-- Os 38 fits anteriores eram amostras pequenas (n≤362) feitos só com
-- brasileirão; serão dropados e refitados a partir do backtest_eval real
-- (6,7M outcomes).

DROP TABLE IF EXISTS isotonic_blob;

CREATE TABLE isotonic_blob (
  family     TEXT NOT NULL,
  liga       TEXT NOT NULL,
  period     TEXT NOT NULL DEFAULT 'FT',
  direction  TEXT NOT NULL,
  blob_bytes BLOB NOT NULL,
  n_samples  INTEGER NOT NULL,
  fit_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (family, liga, period, direction)
);
