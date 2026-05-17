import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { lookupSuperbetOdd } from '../../../scripts/lib/superbet-mapping.mjs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE odds (
      fonte TEXT,
      home_team TEXT,
      away_team TEXT,
      data_jogo TEXT,
      mercado TEXT,
      selecao TEXT,
      linha TEXT,
      odd REAL,
      criado_em TEXT
    )
  `);
  return db;
}

function insertOdd(db, { mercado, selecao, linha = null, odd, criado_em }) {
  db.prepare(`
    INSERT INTO odds (fonte, home_team, away_team, data_jogo, mercado, selecao, linha, odd, criado_em)
    VALUES ('superbet', 'Aston Villa', 'Liverpool', '2026-05-15', ?, ?, ?, ?, ?)
  `).run(mercado, selecao, linha, odd, criado_em);
}

test('lookupSuperbetOdd keeps 2T markets separate from 1T markets', () => {
  const db = makeDb();
  insertOdd(db, { mercado: '2º Tempo - Dupla Chance', selecao: '1X', odd: 1.75, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: '1º Tempo - Dupla Chance', selecao: '1X', odd: 1.36, criado_em: '2026-05-15 02:00:00' });

  const lookup = lookupSuperbetOdd(db, {
    market_key: 'dupla_total_2t_1x',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  });

  assert.equal(lookup.found, true);
  assert.equal(lookup.odd, 1.75);
  assert.equal(lookup.mercado_superbet, '2º Tempo - Dupla Chance');
  db.close();
});

test('lookupSuperbetOdd keeps HT markets separate from 2T markets', () => {
  const db = makeDb();
  insertOdd(db, { mercado: '1º Tempo - Total de Gols', selecao: 'Mais de 1.5', linha: '1.5', odd: 3.2, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: '2º Tempo - Total de Gols', selecao: 'Mais de 1.5', linha: '1.5', odd: 2.7, criado_em: '2026-05-15 02:00:00' });

  const lookup = lookupSuperbetOdd(db, {
    market_key: 'gols_total_ht_over_1_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  });

  assert.equal(lookup.found, true);
  assert.equal(lookup.odd, 3.2);
  assert.equal(lookup.mercado_superbet, '1º Tempo - Total de Gols');
  db.close();
});