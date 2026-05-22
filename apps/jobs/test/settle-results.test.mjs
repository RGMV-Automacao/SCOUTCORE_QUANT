import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '@scoutcore/data-access';
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
      gols INTEGER,
      escanteios INTEGER,
      chutes INTEGER,
      chutes_no_alvo INTEGER,
      faltas INTEGER,
      cartoes_amarelos INTEGER,
      cartoes_vermelhos INTEGER,
      impedimentos INTEGER,
      defesas INTEGER,
      desarmes INTEGER
    );
    CREATE TABLE jogadores (
      id_confronto TEXT,
      time TEXT,
      modo TEXT,
      desarmes INTEGER
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

test('settle marks asian handicap integer push as void', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO partidas VALUES ('m1','Home','Away',1,0,1,0,'brasileirao','2026',1)`).run();
  db.prepare(`
    INSERT INTO prediction
      (run_id, match_id, match_date, liga, family, scope, period, direction, line,
       market_key, fair_prob, market_odd, edge_pct, confidence, certified)
    VALUES ('r1','statsline:m1','2026-05-10','brasileirao','asian_handicap','total','FT','home_minus_1',-1,
       'asian_handicap_total_ft_home_minus_1',0.58,3.9,115.1,0.14,1)
  `).run();

  const out = settle(db, { run_id: 'r1' });
  assert.equal(out.settled, 1);
  assert.equal(out.voided, 1);
  assert.equal(out.clv_inserted, 0);
  assert.equal(out.calib_updated, 0);

  const row = db.prepare(`SELECT result, actual_value, settled_at FROM prediction`).get();
  assert.equal(row.result, 'void');
  assert.equal(row.actual_value, null);
  assert.ok(row.settled_at);

  const clvRows = db.prepare(`SELECT COUNT(*) c FROM clv_history`).get();
  assert.equal(clvRows.c, 0);
  db.close();
});

test('settle reads escanteios from `times` (FT/HT) and derives 2T = FT − HT', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO partidas VALUES ('m2','Home','Away',1,1,0,0,'brasileirao','2026',1)`).run();
  // Home: 7 escanteios FT, 3 no HT → 2T = 4
  // Away: 5 escanteios FT, 2 no HT → 2T = 3
  // Total FT = 12, Total HT = 5, Total 2T = 7
  const ins = db.prepare(`INSERT INTO times
    (id_confronto,time,modo,gols,escanteios,chutes,chutes_no_alvo,faltas,
     cartoes_amarelos,cartoes_vermelhos,impedimentos,defesas)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run('m2','Home','FT',1,7,12,5,10,2,0,1,4);
  ins.run('m2','Home','HT',0,3, 5,2, 5,1,0,0,2);
  ins.run('m2','Away','FT',1,5, 8,3,11,1,0,2,3);
  ins.run('m2','Away','HT',0,2, 3,1, 6,0,0,1,1);

  // Pick 1: Over 10.5 escanteios total FT → 12 > 10.5 → green
  // Pick 2: Under 6.5 escanteios total 2T → 7 < 6.5? não → red
  // Pick 3: Over 2.5 escanteios Home HT → 3 > 2.5 → green
  db.prepare(`INSERT INTO prediction
    (run_id,match_id,match_date,liga,family,scope,period,direction,line,
     market_key,fair_prob,market_odd,edge_pct,confidence,certified)
    VALUES
      ('r2','statsline:m2','2026-05-10','brasileirao','escanteios','total','FT','over',10.5,
        'escanteios_total_ft_over_10_5',0.55,2.0,10,0.7,1),
      ('r2','statsline:m2','2026-05-10','brasileirao','escanteios','total','2T','under',6.5,
        'escanteios_total_2t_under_6_5',0.55,2.0,10,0.7,1),
      ('r2','statsline:m2','2026-05-10','brasileirao','escanteios','home','HT','over',2.5,
        'escanteios_home_ht_over_2_5',0.55,2.0,10,0.7,1)
  `).run();

  const out = settle(db, { run_id: 'r2' });
  assert.equal(out.settled, 3);

  const rows = db.prepare(`SELECT market_key, result, actual_value FROM prediction
                            WHERE run_id='r2' ORDER BY market_key`).all();
  const byKey = Object.fromEntries(rows.map(r => [r.market_key, r]));
  assert.equal(byKey['escanteios_total_ft_over_10_5'].result, 'green');
  assert.equal(byKey['escanteios_total_ft_over_10_5'].actual_value, 12);
  assert.equal(byKey['escanteios_total_2t_under_6_5'].result, 'red');
  assert.equal(byKey['escanteios_total_2t_under_6_5'].actual_value, 7);
  assert.equal(byKey['escanteios_home_ht_over_2_5'].result, 'green');
  assert.equal(byKey['escanteios_home_ht_over_2_5'].actual_value, 3);
  db.close();
});

test('settle reads desarmes from `times` (modo=FT, statsline totalTackle)', () => {
  const db = makeDb();
  db.prepare(`INSERT INTO partidas VALUES ('m3','Home','Away',0,0,0,0,'brasileirao','2026',1)`).run();
  // times.desarmes é fonte canonica (statsline totalTackle): Home=18, Away=12.
  db.prepare(`INSERT INTO times (id_confronto,time,modo,desarmes) VALUES ('m3','Home','FT',18)`).run();
  db.prepare(`INSERT INTO times (id_confronto,time,modo,desarmes) VALUES ('m3','Away','FT',12)`).run();

  db.prepare(`INSERT INTO prediction
    (run_id,match_id,match_date,liga,family,scope,period,direction,line,
     market_key,fair_prob,market_odd,edge_pct,confidence,certified)
    VALUES
      ('r3','statsline:m3','2026-05-10','brasileirao','desarmes','total','FT','over',25.5,
        'desarmes_total_ft_over_25_5',0.55,2.0,10,0.7,1),
      ('r3','statsline:m3','2026-05-10','brasileirao','desarmes','home','FT','over',15.5,
        'desarmes_home_ft_over_15_5',0.55,2.0,10,0.7,1)
  `).run();

  const out = settle(db, { run_id: 'r3' });
  assert.equal(out.settled, 2);
  const rows = db.prepare(`SELECT market_key, result, actual_value FROM prediction
                            WHERE run_id='r3' ORDER BY market_key`).all();
  const byKey = Object.fromEntries(rows.map(r => [r.market_key, r]));
  assert.equal(byKey['desarmes_total_ft_over_25_5'].result, 'green');
  assert.equal(byKey['desarmes_total_ft_over_25_5'].actual_value, 30);
  assert.equal(byKey['desarmes_home_ft_over_15_5'].result, 'green');
  assert.equal(byKey['desarmes_home_ft_over_15_5'].actual_value, 18);
  db.close();
});