// scripts/seed-e2e-fixture.mjs
// Cria scout-e2e.db: aplica schema mínimo neutro
// + insere 1 partida agendada (target) e history mínimo (12 partidas Played).
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const dbPath = process.env.SCOUT_DB || join(ROOT, 'data/scout-e2e.db');
mkdirSync(dirname(dbPath), { recursive: true });
if (existsSync(dbPath)) unlinkSync(dbPath);

const db = new Database(dbPath);
db.exec(`
  CREATE TABLE partidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    liga TEXT NOT NULL,
    temporada TEXT,
    id_confronto TEXT NOT NULL,
    modo TEXT DEFAULT 'FT',
    status TEXT,
    home_team TEXT,
    away_team TEXT,
    home_goals INTEGER,
    away_goals INTEGER,
    home_goals_ht INTEGER,
    away_goals_ht INTEGER,
    data_partida TEXT,
    hora_partida TEXT,
    processado INTEGER DEFAULT 1,
    UNIQUE(liga, modo, id_confronto)
  );
  CREATE TABLE eventos_faixa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    liga TEXT NOT NULL,
    id_confronto TEXT NOT NULL,
    temporada TEXT,
    time TEXT NOT NULL,
    faixa TEXT NOT NULL,
    escanteios INTEGER DEFAULT 0,
    chutes INTEGER DEFAULT 0,
    chutes_no_alvo INTEGER DEFAULT 0,
    faltas INTEGER DEFAULT 0,
    cartoes_amarelos INTEGER DEFAULT 0,
    cartoes_vermelhos INTEGER DEFAULT 0,
    gols INTEGER DEFAULT 0,
    impedimentos INTEGER DEFAULT 0,
    UNIQUE(liga, id_confronto, time, faixa)
  );
  CREATE TABLE team_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team TEXT NOT NULL,
    liga TEXT NOT NULL,
    temporada TEXT NOT NULL,
    side TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team, liga, temporada, side)
  );
  CREATE TABLE team_profile_v2 (
    team TEXT NOT NULL,
    liga TEXT NOT NULL,
    temporada TEXT NOT NULL,
    side TEXT NOT NULL,
    as_of TEXT NOT NULL,
    n INTEGER NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (team, liga, temporada, side, as_of)
  );
  CREATE TABLE league_priors (
    liga TEXT NOT NULL,
    temporada TEXT NOT NULL,
    period TEXT NOT NULL,
    payload TEXT NOT NULL,
    as_of TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (liga, temporada, period, as_of)
  );
  CREATE TABLE calib_state (
    engine TEXT NOT NULL,
    family TEXT NOT NULL,
    direction TEXT NOT NULL,
    liga TEXT NOT NULL,
    lambda_mult REAL NOT NULL DEFAULT 1.0,
    confidence_factor REAL NOT NULL DEFAULT 1.0,
    line_shift REAL NOT NULL DEFAULT 0.0,
    ewma_hr REAL NOT NULL DEFAULT 0.5,
    ewma_brier REAL,
    clv_score REAL,
    isotonic_blob BLOB,
    isotonic_version TEXT,
    sample_size INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (engine, family, direction, liga)
  );
  CREATE TABLE motor_run (
    run_id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    engine_signature TEXT NOT NULL,
    request_payload TEXT NOT NULL,
    response_payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE prediction (
    run_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    match_date TEXT NOT NULL,
    liga TEXT NOT NULL,
    family TEXT NOT NULL,
    scope TEXT NOT NULL,
    period TEXT NOT NULL,
    direction TEXT NOT NULL,
    line REAL,
    market_key TEXT NOT NULL,
    fair_prob REAL NOT NULL,
    market_odd REAL,
    edge_pct REAL,
    confidence REAL NOT NULL,
    certified INTEGER NOT NULL DEFAULT 0,
    result TEXT,
    settled_at TEXT,
    provenance TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (run_id, market_key)
  );
  CREATE TABLE clv_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    market_key TEXT NOT NULL,
    family TEXT NOT NULL,
    liga TEXT NOT NULL,
    fair_prob_motor REAL NOT NULL,
    fair_odd_motor REAL NOT NULL,
    prob_a REAL,
    prob_b REAL,
    odd_open REAL,
    odd_close REAL,
    result TEXT NOT NULL,
    brier_a REAL,
    brier_b REAL,
    clv_pct REAL,
    source TEXT NOT NULL,
    settled_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
console.log('[seed] schema applied');

const liga = 'brasileirao';
const teams = ['TestHome', 'TestAway'];
const insertPlayed = db.prepare(`
  INSERT INTO partidas (liga, temporada, id_confronto, modo, status,
    home_team, away_team, data_partida, home_goals, away_goals)
  VALUES (?, '2026', ?, 'FT', 'Played', ?, ?, ?, ?, ?)
`);
let id = 1000;
for (let i = 0; i < 6; i += 1) {
  const date = `2026-04-${String(i + 1).padStart(2, '0')}`;
  insertPlayed.run(liga, String(id++), teams[0], 'OtherX', date, 2, 1);
  insertPlayed.run(liga, String(id++), 'OtherY', teams[1], date, 1, 2);
}
db.prepare(`
  INSERT INTO partidas (liga, temporada, id_confronto, modo, status,
    home_team, away_team, data_partida)
  VALUES (?, '2026', '9999', 'FT', 'Scheduled', ?, ?, '2026-05-15')
`).run(liga, teams[0], teams[1]);

console.log('[seed] done', dbPath);
db.close();
