import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { snapshotClosing } from '../src/snapshot-closing.mjs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE partidas (
      id_confronto TEXT PRIMARY KEY,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      data_partida TEXT
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
    CREATE TABLE odds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fonte TEXT NOT NULL,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      data_jogo TEXT,
      mercado TEXT NOT NULL,
      selecao TEXT,
      linha TEXT,
      odd REAL NOT NULL,
      coleta_id TEXT,
      criado_em TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare(`INSERT INTO partidas VALUES ('m1','Home','Away','2026-05-12')`).run();
  db.prepare(`
    INSERT INTO prediction
      (run_id, match_id, match_date, liga, family, scope, period, direction, line,
       market_key, fair_prob, market_odd, edge_pct, confidence, certified)
    VALUES ('r1','statsline:m1','2026-05-12','brasileirao','gols','total','FT','over',1.5,
       'gols_total_ft_over_1_5',0.62,2.0,24,0.8,1)
  `).run();
  return db;
}

test('snapshotClosing writes nested closing odds consumable by settlement', () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO odds (fonte, home_team, away_team, data_jogo, mercado, selecao, linha, odd, coleta_id, criado_em)
    VALUES ('bookline','Home','Away','2026-05-12','Total de Gols','Mais de 1.5','1.5',1.8,'c1','2026-05-12T11:56:00Z')
  `).run();

  const out = snapshotClosing(db, { runId: 'r1', now: '2026-05-12T12:00:00Z', maxAgeMinutes: 10 });
  assert.equal(out.summary.total_predictions, 1);
  assert.equal(out.summary.captured, 1);
  assert.equal(out.payload.r1.gols_total_ft_over_1_5.odd_close, 1.8);
  assert.equal(out.payload.r1.gols_total_ft_over_1_5.age_minutes, 4);
  db.close();
});

test('snapshotClosing omits stale odds when freshness is enforced', () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO odds (fonte, home_team, away_team, data_jogo, mercado, selecao, linha, odd, coleta_id, criado_em)
    VALUES ('bookline','Home','Away','2026-05-12','Total de Gols','Mais de 1.5','1.5',1.8,'c1','2026-05-12T11:40:00Z')
  `).run();

  const out = snapshotClosing(db, { runId: 'r1', now: '2026-05-12T12:00:00Z', maxAgeMinutes: 10 });
  assert.equal(out.summary.captured, 0);
  assert.equal(out.summary.stale, 1);
  assert.equal(out.payload.r1, undefined);
  db.close();
});
