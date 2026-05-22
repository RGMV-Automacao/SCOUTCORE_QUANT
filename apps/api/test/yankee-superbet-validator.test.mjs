import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { isActualComboEvBelowMin, validateYankeeAgainstSuperbet } from '../src/yankee-superbet-validator.mjs';

function withFetchStub(callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ markets: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  return Promise.resolve(callback()).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function makeRun(home, away, date) {
  const marketKey = 'gols_total_ft_over_0_5';
  const matchId = 'match-1';
  return {
    run: {
      slots: [{
        match_id: matchId,
        home,
        away,
        date,
        market_key: marketKey,
        market_odd: 1.2,
        certified: true,
        fair_prob: 0.6,
        edge_pct: 2,
        family: 'gols',
        scope: 'total',
        period: 'FT',
        direction: 'over',
        line: 0.5,
      }],
    },
    yankee: {
      tickets: [{ ticket_idx: 1, boards: [{ match_id: matchId, legs: [{ market_key: marketKey }] }] }],
      board: { ready_combos: [{ match_id: matchId, combo_odd: 1.2 }] },
    },
  };
}

test('validateYankeeAgainstSuperbet resolves event_id from source_event_id on Scout schema', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE odds (
      home_team TEXT,
      away_team TEXT,
      data_jogo TEXT,
      source_event_id TEXT,
      odd REAL
    )
  `);
  db.prepare(`
    INSERT INTO odds (home_team, away_team, data_jogo, source_event_id, odd)
    VALUES (?, ?, ?, ?, ?)
  `).run('Fiorentina', 'Atalanta', '2026-05-21', '11561130', 2.1);

  const { run, yankee } = makeRun('Fiorentina', 'Atalanta', '2026-05-21');
  const result = await withFetchStub(() => validateYankeeAgainstSuperbet({ repo: { db }, run, yankee }));

  assert.equal(result.summary.boards_total, 1);
  assert.equal(result.tickets[0].boards[0].event_id, '11561130');
  assert.equal(result.tickets[0].boards[0].match, 'Fiorentina x Atalanta');
  assert.equal(result.tickets[0].boards[0].url_partida, 'https://superbet.bet.br/odds/futebol/evento-11561130');
  db.close();
});

test('validateYankeeAgainstSuperbet falls back to legacy url_partida when source_event_id is absent', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE odds (
      home_team TEXT,
      away_team TEXT,
      data_jogo TEXT,
      url_partida TEXT,
      odd REAL
    )
  `);
  db.prepare(`
    INSERT INTO odds (home_team, away_team, data_jogo, url_partida, odd)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'Fiorentina',
    'Atalanta',
    '2026-05-21',
    'https://superbet.bet.br/odds/futebol/fiorentina-x-atalanta-11561130/',
    2.1,
  );

  const { run, yankee } = makeRun('Fiorentina', 'Atalanta', '2026-05-21');
  const result = await withFetchStub(() => validateYankeeAgainstSuperbet({ repo: { db }, run, yankee }));

  assert.equal(result.summary.boards_total, 1);
  assert.equal(result.tickets[0].boards[0].event_id, '11561130');
  assert.equal(result.tickets[0].boards[0].match, 'Fiorentina x Atalanta');
  assert.equal(result.tickets[0].boards[0].url_partida, 'https://superbet.bet.br/odds/futebol/fiorentina-x-atalanta-11561130/');
  db.close();
});

test('isActualComboEvBelowMin allows configured small negative tolerance', () => {
  assert.equal(isActualComboEvBelowMin(-0.0081, -0.01), false);
  assert.equal(isActualComboEvBelowMin(-0.1803, -0.01), true);
  assert.equal(isActualComboEvBelowMin(0, -0.01), false);
});