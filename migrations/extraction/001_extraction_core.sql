PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS extraction_schema_version (
  version      INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  checksum     TEXT NOT NULL,
  applied_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS extracoes_log (
  run_id                TEXT PRIMARY KEY,
  job_name              TEXT NOT NULL,
  source_system         TEXT NOT NULL CHECK(source_system IN ('statsline','bookline','derived','audit')),
  source_version        TEXT,
  liga                  TEXT,
  temporada             TEXT,
  status                TEXT NOT NULL CHECK(status IN ('running','ok','partial','failed','blocked')),
  started_at            TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at           TEXT,
  rows_read             INTEGER NOT NULL DEFAULT 0 CHECK(rows_read >= 0),
  rows_written          INTEGER NOT NULL DEFAULT 0 CHECK(rows_written >= 0),
  rows_skipped          INTEGER NOT NULL DEFAULT 0 CHECK(rows_skipped >= 0),
  warnings_count        INTEGER NOT NULL DEFAULT 0 CHECK(warnings_count >= 0),
  error_message         TEXT,
  params_json           TEXT NOT NULL DEFAULT '{}',
  summary_json          TEXT NOT NULL DEFAULT '{}',
  status_certificacao   TEXT NOT NULL DEFAULT 'nao_avaliada'
    CHECK(status_certificacao IN ('nao_avaliada','aprovada','reprovada','parcial','bloqueada'))
);

CREATE INDEX IF NOT EXISTS idx_extracoes_log_source_status
  ON extracoes_log(source_system, status, started_at);

CREATE TABLE IF NOT EXISTS partidas (
  id_confronto          TEXT PRIMARY KEY,
  liga                  TEXT NOT NULL,
  temporada             TEXT NOT NULL,
  home_team             TEXT NOT NULL,
  away_team             TEXT NOT NULL,
  data_partida          TEXT NOT NULL,
  hora_partida          TEXT,
  status                TEXT,
  home_goals            INTEGER,
  away_goals            INTEGER,
  home_goals_ht         INTEGER,
  away_goals_ht         INTEGER,
  processado            INTEGER NOT NULL DEFAULT 0 CHECK(processado IN (0,1)),
  processado_stats      INTEGER NOT NULL DEFAULT 0 CHECK(processado_stats IN (0,1)),
  processado_odds       INTEGER NOT NULL DEFAULT 0 CHECK(processado_odds IN (0,1)),
  status_certificacao   TEXT NOT NULL DEFAULT 'nao_avaliada'
    CHECK(status_certificacao IN ('nao_avaliada','aprovada','reprovada','parcial','bloqueada')),
  certificado_em        TEXT,
  run_id                TEXT,
  source_system         TEXT NOT NULL DEFAULT 'statsline' CHECK(source_system IN ('statsline','derived')),
  source_version        TEXT,
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_partidas_liga_data
  ON partidas(liga, data_partida, hora_partida);
CREATE INDEX IF NOT EXISTS idx_partidas_certificacao
  ON partidas(status_certificacao, processado_stats, processado_odds);

CREATE TABLE IF NOT EXISTS times (
  id_confronto          TEXT NOT NULL,
  liga                  TEXT NOT NULL,
  temporada             TEXT NOT NULL,
  time                  TEXT NOT NULL,
  side                  TEXT NOT NULL CHECK(side IN ('home','away')),
  modo                  TEXT NOT NULL CHECK(modo IN ('FT','HT','2T')),
  gols                  INTEGER,
  escanteios            INTEGER,
  chutes                INTEGER,
  chutes_no_alvo        INTEGER,
  faltas                INTEGER,
  cartoes_amarelos      INTEGER,
  cartoes_vermelhos     INTEGER,
  impedimentos          INTEGER,
  defesas               INTEGER,
  run_id                TEXT,
  source_system         TEXT NOT NULL DEFAULT 'statsline' CHECK(source_system IN ('statsline','derived')),
  source_version        TEXT,
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(id_confronto, time, modo),
  FOREIGN KEY(id_confronto) REFERENCES partidas(id_confronto) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_times_liga_time_modo
  ON times(liga, time, modo);

CREATE TABLE IF NOT EXISTS confronto (
  id_confronto              TEXT NOT NULL,
  liga                      TEXT NOT NULL,
  temporada                 TEXT NOT NULL,
  modo                      TEXT NOT NULL CHECK(modo IN ('FT','HT','2T')),
  total_gols                INTEGER,
  home_goals                INTEGER,
  away_goals                INTEGER,
  total_escanteios          INTEGER,
  total_chutes              INTEGER,
  total_chutes_no_alvo      INTEGER,
  total_faltas              INTEGER,
  total_cartoes_amarelos    INTEGER,
  total_cartoes_vermelhos   INTEGER,
  total_impedimentos        INTEGER,
  run_id                    TEXT,
  source_system             TEXT NOT NULL DEFAULT 'derived' CHECK(source_system IN ('statsline','derived')),
  source_version            TEXT,
  payload_raw               TEXT NOT NULL DEFAULT '{}',
  criado_em                 TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(id_confronto, modo),
  FOREIGN KEY(id_confronto) REFERENCES partidas(id_confronto) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_confronto_liga_modo
  ON confronto(liga, temporada, modo);

CREATE TABLE IF NOT EXISTS eventos_faixa (
  id_confronto          TEXT NOT NULL,
  liga                  TEXT NOT NULL,
  temporada             TEXT NOT NULL,
  time                  TEXT NOT NULL,
  side                  TEXT CHECK(side IN ('home','away')),
  faixa                 TEXT NOT NULL,
  minuto_inicio         INTEGER,
  minuto_fim            INTEGER,
  gols                  INTEGER,
  escanteios            INTEGER,
  chutes                INTEGER,
  chutes_no_alvo        INTEGER,
  faltas                INTEGER,
  cartoes_amarelos      INTEGER,
  cartoes_vermelhos     INTEGER,
  impedimentos          INTEGER,
  run_id                TEXT,
  source_system         TEXT NOT NULL DEFAULT 'statsline' CHECK(source_system IN ('statsline','derived')),
  source_version        TEXT,
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(id_confronto, time, faixa),
  FOREIGN KEY(id_confronto) REFERENCES partidas(id_confronto) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_eventos_faixa_liga_faixa
  ON eventos_faixa(liga, temporada, faixa);

CREATE TABLE IF NOT EXISTS odds_coletas (
  coleta_id             TEXT PRIMARY KEY,
  source_system         TEXT NOT NULL DEFAULT 'bookline' CHECK(source_system = 'bookline'),
  source_version        TEXT,
  liga                  TEXT,
  janela_inicio         TEXT,
  janela_fim            TEXT,
  status                TEXT NOT NULL CHECK(status IN ('running','ok','partial','failed','blocked')),
  started_at            TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at           TEXT,
  matches_checked       INTEGER NOT NULL DEFAULT 0 CHECK(matches_checked >= 0),
  events_matched        INTEGER NOT NULL DEFAULT 0 CHECK(events_matched >= 0),
  odds_written          INTEGER NOT NULL DEFAULT 0 CHECK(odds_written >= 0),
  warnings_count        INTEGER NOT NULL DEFAULT 0 CHECK(warnings_count >= 0),
  error_message         TEXT,
  params_json           TEXT NOT NULL DEFAULT '{}',
  summary_json          TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_odds_coletas_liga_status
  ON odds_coletas(liga, status, started_at);

CREATE TABLE IF NOT EXISTS odds (
  quote_key             TEXT PRIMARY KEY,
  id_confronto          TEXT,
  source_event_id       TEXT,
  source_system         TEXT NOT NULL DEFAULT 'bookline' CHECK(source_system = 'bookline'),
  source_version        TEXT,
  liga                  TEXT NOT NULL,
  home_team             TEXT NOT NULL,
  away_team             TEXT NOT NULL,
  data_jogo             TEXT,
  mercado_key           TEXT NOT NULL,
  mercado               TEXT NOT NULL,
  selecao               TEXT NOT NULL,
  linha                 TEXT,
  odd                   REAL NOT NULL CHECK(odd > 1.0),
  coleta_id             TEXT,
  status_certificacao   TEXT NOT NULL DEFAULT 'nao_avaliada'
    CHECK(status_certificacao IN ('nao_avaliada','aprovada','reprovada','parcial','bloqueada')),
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(id_confronto) REFERENCES partidas(id_confronto) ON DELETE SET NULL,
  FOREIGN KEY(coleta_id) REFERENCES odds_coletas(coleta_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_odds_match_market
  ON odds(id_confronto, mercado_key, selecao, linha);
CREATE INDEX IF NOT EXISTS idx_odds_liga_data
  ON odds(liga, data_jogo, home_team, away_team);

CREATE TABLE IF NOT EXISTS odds_historico (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_key             TEXT NOT NULL,
  coleta_id             TEXT NOT NULL,
  old_odd               REAL,
  new_odd               REAL NOT NULL CHECK(new_odd > 1.0),
  delta                 REAL,
  source_system         TEXT NOT NULL DEFAULT 'bookline' CHECK(source_system = 'bookline'),
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(quote_key, coleta_id),
  FOREIGN KEY(quote_key) REFERENCES odds(quote_key) ON DELETE CASCADE,
  FOREIGN KEY(coleta_id) REFERENCES odds_coletas(coleta_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_odds_historico_quote_time
  ON odds_historico(quote_key, criado_em);

CREATE TABLE IF NOT EXISTS certificacao_extracao (
  certification_id      TEXT PRIMARY KEY,
  run_id                TEXT,
  scope                 TEXT NOT NULL CHECK(scope IN ('schema','statsline','bookline','full')),
  liga                  TEXT,
  temporada             TEXT,
  status                TEXT NOT NULL CHECK(status IN ('aprovada','reprovada','parcial','bloqueada')),
  checked_at            TEXT NOT NULL DEFAULT (datetime('now')),
  checks_total          INTEGER NOT NULL CHECK(checks_total >= 0),
  checks_passed         INTEGER NOT NULL CHECK(checks_passed >= 0),
  checks_failed         INTEGER NOT NULL CHECK(checks_failed >= 0),
  payload_json          TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_certificacao_scope_status
  ON certificacao_extracao(scope, liga, temporada, status, checked_at);

CREATE TABLE IF NOT EXISTS certificacao_liga (
  liga                      TEXT NOT NULL,
  temporada                 TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'nao_iniciada'
    CHECK(status IN ('nao_iniciada','em_teste','certificada','bloqueada')),
  statsline_status          TEXT NOT NULL DEFAULT 'nao_avaliada'
    CHECK(statsline_status IN ('nao_avaliada','aprovada','reprovada','parcial','bloqueada')),
  bookline_status           TEXT NOT NULL DEFAULT 'nao_avaliada'
    CHECK(bookline_status IN ('nao_avaliada','aprovada','reprovada','parcial','bloqueada')),
  last_certification_id     TEXT,
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(liga, temporada),
  FOREIGN KEY(last_certification_id) REFERENCES certificacao_extracao(certification_id) ON DELETE SET NULL
);
