-- Adiciona coluna settled_at em yankee_submissions.
-- Consumida por apps/api/src/routes/settle-tickets.mjs ao liquidar tickets
-- (UPDATE yankee_submissions SET tickets_json=?, status=?, settled_at=datetime('now')).
-- Sem essa coluna o settler quebra com "no such column: settled_at" e o
-- scheduler periódico falha silenciosamente.
ALTER TABLE yankee_submissions ADD COLUMN settled_at TEXT;

CREATE INDEX IF NOT EXISTS idx_yankee_subs_settled_at ON yankee_submissions(settled_at);
