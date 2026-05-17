import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { settle } from '../src/settle-results.mjs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE partidas (
      id_confronto TEXT PRIMARY KEY,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      home_goals INTEGER,
      away_goals INTEGER,
      home_goals_ht INTEGER,
      away_goals_ht INTEGER,
      liga TEXT,
      temporada TEXT,
      processado INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE eventos_faixa (
      id_confronto TEXT,
      time TEXT,
      faixa TEXT,
      escanteios INTEGER,
      chutes INTEGER,
      chutes_no_alvo INTEGER,
      faltas INTEGER,
      cartoes_amarelos INTEGER,
      cartoes_vermelhos INTEGER,
      gols INTEGER,
      impedimentos INTEGER
    );
    CREATE TABLE times (
      id_confronto TEXT,
      time TEXT,
      modo TEXT,
      defesas INTEGER
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
      actual_value REAL,
      settled_at TEXT,
      provenance TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, match_id, market_key)
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
    CREATE TABLE clv_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
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
  return db;
}

test('settle persists closing odds and positive CLV when open beats close', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO partidas VALUES ('m1','Home','Away',2,0,1,0,'brasileirao','2026',1)`).run();
  db.prepare(`
    INSERT INTO prediction
      (run_id, match_id, match_date, liga, family, scope, period, direction, line,
       market_key, fair_prob, market_odd, edge_pct, confidence, certified)
    VALUES ('r1','statsline:m1','2026-05-10','brasileirao','gols','total','FT','over',1.5,
       'gols_total_ft_over_1_5',0.62,2.0,24,0.8,1)
  `).run();

  const out = settle(db, { run_id: 'r1', closingOdds: { gols_total_ft_over_1_5: 1.8 } });
  assert.equal(out.settled, 1);
  assert.equal(out.clv_with_close, 1);

  const row = db.prepare(`SELECT result, odd_open, odd_close, clv_pct FROM clv_history`).get();
  assert.equal(row.result, 'green');
  assert.equal(row.odd_open, 2.0);
  assert.equal(row.odd_close, 1.8);
  assert.equal(row.clv_pct, 11.1111);
  db.close();
});

test('settle rejects implausible closing odds without losing hit/miss settlement', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO partidas VALUES ('m1','Home','Away',2,0,1,0,'brasileirao','2026',1)`).run();
  db.prepare(`
    INSERT INTO prediction
      (run_id, match_id, match_date, liga, family, scope, period, direction, line,
       market_key, fair_prob, market_odd, edge_pct, confidence, certified)
    VALUES ('r1','statsline:m1','2026-05-10','brasileirao','gols','total','FT','over',1.5,
       'gols_total_ft_over_1_5',0.62,2.0,24,0.8,1)
  `).run();

  const out = settle(db, { run_id: 'r1', closingOdds: { gols_total_ft_over_1_5: 8.0 } });
  assert.equal(out.settled, 1);
  assert.equal(out.clv_with_close, 0);
  assert.equal(out.clv_invalid_close, 1);

  const row = db.prepare(`SELECT result, odd_open, odd_close, clv_pct FROM clv_history`).get();
  assert.equal(row.result, 'green');
  assert.equal(row.odd_open, 2.0);
  assert.equal(row.odd_close, null);
  assert.equal(row.clv_pct, null);
  db.close();
});