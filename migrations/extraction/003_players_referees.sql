ALTER TABLE partidas ADD COLUMN estadio TEXT;
ALTER TABLE partidas ADD COLUMN estadio_lat REAL;
ALTER TABLE partidas ADD COLUMN estadio_lon REAL;
ALTER TABLE partidas ADD COLUMN arbitro_principal TEXT;
ALTER TABLE partidas ADD COLUMN publico INTEGER;
ALTER TABLE partidas ADD COLUMN formacao_casa TEXT;
ALTER TABLE partidas ADD COLUMN formacao_fora TEXT;
ALTER TABLE partidas ADD COLUMN treinador_casa TEXT;
ALTER TABLE partidas ADD COLUMN treinador_fora TEXT;

CREATE TABLE IF NOT EXISTS jogadores (
  id_confronto          TEXT NOT NULL,
  liga                  TEXT NOT NULL,
  temporada             TEXT NOT NULL,
  id_liga               TEXT,
  confronto             TEXT,
  time                  TEXT NOT NULL,
  jogador               TEXT NOT NULL,
  rodada                TEXT,
  modo                  TEXT NOT NULL DEFAULT 'FT' CHECK(modo IN ('FT','HT','2T')),
  status                TEXT,
  gols                  INTEGER NOT NULL DEFAULT 0,
  assistencias          INTEGER NOT NULL DEFAULT 0,
  cartoes_vermelhos     INTEGER NOT NULL DEFAULT 0,
  cartoes_amarelos      INTEGER NOT NULL DEFAULT 0,
  escanteios            INTEGER NOT NULL DEFAULT 0,
  chutes                INTEGER NOT NULL DEFAULT 0,
  chutes_no_alvo        INTEGER NOT NULL DEFAULT 0,
  chutes_bloqueados     INTEGER NOT NULL DEFAULT 0,
  passes                INTEGER NOT NULL DEFAULT 0,
  cruzamentos           INTEGER NOT NULL DEFAULT 0,
  desarmes              INTEGER NOT NULL DEFAULT 0,
  impedimentos          INTEGER NOT NULL DEFAULT 0,
  faltas_cometidas      INTEGER NOT NULL DEFAULT 0,
  faltas_sofridas       INTEGER NOT NULL DEFAULT 0,
  defesas               INTEGER NOT NULL DEFAULT 0,
  minutos               INTEGER NOT NULL DEFAULT 0,
  titular               INTEGER NOT NULL DEFAULT 0 CHECK(titular IN (0,1)),
  player_id             TEXT,
  posicao               TEXT,
  posicao_lado          TEXT,
  formacao_posicao      TEXT,
  numero_camisa         INTEGER,
  run_id                TEXT,
  source_system         TEXT NOT NULL DEFAULT 'statsline' CHECK(source_system = 'statsline'),
  source_version        TEXT,
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(id_confronto, jogador, time, modo),
  FOREIGN KEY(id_confronto) REFERENCES partidas(id_confronto) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jogadores_liga_temporada
  ON jogadores(liga, temporada);
CREATE INDEX IF NOT EXISTS idx_jogadores_confronto
  ON jogadores(id_confronto);
CREATE INDEX IF NOT EXISTS idx_jogadores_jogador
  ON jogadores(jogador);
CREATE INDEX IF NOT EXISTS idx_jogadores_player_id
  ON jogadores(player_id);

CREATE TABLE IF NOT EXISTS arbitros (
  statsline_id          TEXT PRIMARY KEY,
  nome                  TEXT NOT NULL,
  primeiro_nome         TEXT,
  sobrenome             TEXT,
  pais                  TEXT,
  jogos_apitados        INTEGER NOT NULL DEFAULT 0 CHECK(jogos_apitados >= 0),
  media_amarelos        REAL NOT NULL DEFAULT 0,
  media_vermelhos       REAL NOT NULL DEFAULT 0,
  media_faltas          REAL NOT NULL DEFAULT 0,
  media_gols            REAL NOT NULL DEFAULT 0,
  run_id                TEXT,
  source_system         TEXT NOT NULL DEFAULT 'statsline' CHECK(source_system = 'statsline'),
  source_version        TEXT,
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_arbitros_nome
  ON arbitros(nome);

CREATE TABLE IF NOT EXISTS partida_arbitro (
  id_confronto          TEXT NOT NULL,
  statsline_id          TEXT NOT NULL,
  tipo                  TEXT NOT NULL DEFAULT 'Main',
  nome                  TEXT NOT NULL,
  run_id                TEXT,
  source_system         TEXT NOT NULL DEFAULT 'statsline' CHECK(source_system = 'statsline'),
  source_version        TEXT,
  payload_raw           TEXT NOT NULL DEFAULT '{}',
  criado_em             TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(id_confronto, statsline_id, tipo),
  FOREIGN KEY(id_confronto) REFERENCES partidas(id_confronto) ON DELETE CASCADE,
  FOREIGN KEY(statsline_id) REFERENCES arbitros(statsline_id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES extracoes_log(run_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_partida_arbitro_partida
  ON partida_arbitro(id_confronto);
CREATE INDEX IF NOT EXISTS idx_partida_arbitro_statsline
  ON partida_arbitro(statsline_id);
