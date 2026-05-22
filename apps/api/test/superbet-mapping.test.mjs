import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '@scoutcore/data-access';
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
      mercado_key TEXT,
      odd REAL,
      criado_em TEXT
    )
  `);
  return db;
}

function insertOdd(db, { home = 'Aston Villa', away = 'Liverpool', mercado, selecao, linha = null, mercado_key = null, odd, criado_em }) {
  db.prepare(`
    INSERT INTO odds (fonte, home_team, away_team, data_jogo, mercado, selecao, linha, mercado_key, odd, criado_em)
    VALUES ('superbet', ?, ?, '2026-05-15', ?, ?, ?, ?, ?, ?)
  `).run(home, away, mercado, selecao, linha, mercado_key, odd, criado_em);
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

test('lookupSuperbetOdd resolves FT dupla chance compact selections before legacy text', () => {
  const db = makeDb();
  insertOdd(db, { mercado: 'Dupla Chance', selecao: '1X', odd: 1.44, criado_em: '2026-05-15 02:00:00' });
  insertOdd(db, { mercado: 'Dupla Chance', selecao: '1 ou Empate', odd: 1.39, criado_em: '2026-05-15 03:00:00' });

  const lookup = lookupSuperbetOdd(db, {
    market_key: 'dupla_total_ft_1x',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  });

  assert.equal(lookup.found, true);
  assert.equal(lookup.odd, 1.44);
  assert.equal(lookup.selecao_superbet, '1X');
  db.close();
});

test('lookupSuperbetOdd resolves stat 1X2 markets with 1/X/2 selections', () => {
  const db = makeDb();
  insertOdd(db, { mercado: '1º Tempo - Time com Mais Escanteios', selecao: '2', odd: 2.85, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: 'Equipe com Mais Cartões (1X2)', selecao: 'X', odd: 4.5, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: 'Equipe Com Mais Finalizações (1X2)', selecao: '1', odd: 2.05, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: 'Equipe Com Mais Chutes no Gol (1X2)', selecao: '2', odd: 2.65, criado_em: '2026-05-15 01:00:00' });

  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'escanteios_1x2_total_ht_away',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 2.85);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'cartoes_1x2_total_ft_draw',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 4.5);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'chutes_1x2_total_ft_home',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 2.05);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'chutes_alvo_1x2_total_ft_away',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 2.65);
  db.close();
});

test('lookupSuperbetOdd resolves revised Superbet screen labels', () => {
  const db = makeDb();
  insertOdd(db, { mercado: 'Resultado Final (1X2)', selecao: '2', odd: 1.62, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: '1º Tempo - Finalizações 1X2', selecao: 'Liverpool', odd: 2.12, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: 'Total de Desarmes', selecao: 'Mais de 30.5', linha: '30.5', odd: 1.91, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: 'Total de Desarmes da Equipe', selecao: 'Menos de 15.5', linha: '15.5', odd: 1.78, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: 'Total de Defesas do Goleiro da Equipe', selecao: 'Mais de 3.5', linha: '3.5', odd: 2.02, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: 'Total de Gols Ímpar/Par', selecao: 'Ímpar', odd: 1.95, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: '1º Tempo - Escanteios Ímpar/Par', selecao: 'Par', odd: 1.86, criado_em: '2026-05-15 01:00:00' });

  assert.equal(lookupSuperbetOdd(db, {
    market_key: '1x2_total_ft_away',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 1.62);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'chutes_1x2_total_ht_away',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 2.12);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'desarmes_total_ft_over_30_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 1.91);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'desarmes_home_ft_under_15_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 1.78);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'defesas_away_ft_over_3_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 2.02);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'gols_oddeven_total_ft_impar',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 1.95);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'escanteios_oddeven_total_ht_par',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 1.86);
  db.close();
});

test('lookupSuperbetOdd resolves team goals first-half textual rows', () => {
  const db = makeDb();
  insertOdd(db, { mercado: '1º Tempo - Total de Gols do Time', selecao: 'MAIS Aston Villa', linha: '0.5', odd: 2.8, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { mercado: '1º Tempo - Total de Gols do Time', selecao: 'MENOS Liverpool', linha: '1.5', odd: 1.42, criado_em: '2026-05-15 01:00:00' });

  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'gols_home_ht_over_0_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 2.8);
  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'gols_away_ht_under_1_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 1.42);
  db.close();
});

test('lookupSuperbetOdd resolves revised public team-goals and team-corners labels', () => {
  const db = makeDb();
  insertOdd(db, { home: 'Burnley', away: 'Wolverhampton Wanderers', mercado: 'Burnley - Total de Gols', selecao: 'Menos de 1.5', linha: '1.5', odd: 1.71, criado_em: '2026-05-15 01:00:00' });
  insertOdd(db, { home: 'Burnley', away: 'Wolverhampton Wanderers', mercado: 'Wolverhampton - Total de Escanteios', selecao: 'Menos de 5.5', linha: '5.5', odd: 1.33, criado_em: '2026-05-15 01:00:00' });

  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'gols_home_ft_under_1_5',
    home: 'Burnley',
    away: 'Wolverhampton Wanderers',
    data: '2026-05-15',
  }).odd, 1.71);

  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'escanteios_away_ft_under_5_5',
    home: 'Burnley',
    away: 'Wolverhampton Wanderers',
    data: '2026-05-15',
  }).odd, 1.33);
  db.close();
});

test('lookupSuperbetOdd resolves team-corners public aliases with state suffixes', () => {
  const db = makeDb();
  insertOdd(db, { home: 'Grêmio', away: 'Santos', mercado: 'Grêmio RS - Total de Escanteios', selecao: 'Menos de 5.5', linha: '5.5', odd: 1.69, criado_em: '2026-05-15 01:00:00' });

  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'escanteios_home_ft_under_5_5',
    home: 'Grêmio',
    away: 'Santos',
    data: '2026-05-15',
  }).odd, 1.69);
  db.close();
});

test('lookupSuperbetOdd resolves team-corners public aliases with shortened united names', () => {
  const db = makeDb();
  insertOdd(db, { home: 'Fulham', away: 'Newcastle United', mercado: 'Newcastle - Total de Escanteios', selecao: 'Menos de 5.5', linha: '5.5', odd: 1.57, criado_em: '2026-05-15 01:00:00' });

  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'escanteios_away_ft_under_5_5',
    home: 'Fulham',
    away: 'Newcastle United',
    data: '2026-05-15',
  }).odd, 1.57);
  db.close();
});

test('lookupSuperbetOdd resolves revised public first-half team-goals labels', () => {
  const db = makeDb();
  insertOdd(db, { mercado: '1º Tempo - Total de Gols de Aston Villa', selecao: 'Mais de 0.5', linha: '0.5', odd: 1.75, criado_em: '2026-05-15 01:00:00' });

  assert.equal(lookupSuperbetOdd(db, {
    market_key: 'gols_home_ht_over_0_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  }).odd, 1.75);
  db.close();
});

test('lookupSuperbetOdd prefers exact canonical mercado_key when odds table has it', () => {
  const db = makeDb();
  insertOdd(db, {
    mercado: 'Escanteios - Handicap',
    selecao: 'Mais de -1.5',
    linha: '-1.5',
    mercado_key: 'escanteios_handicap_total_ft_away_minus_1_5',
    odd: 1.57,
    criado_em: '2026-05-15 01:00:00',
  });

  const lookup = lookupSuperbetOdd(db, {
    market_key: 'escanteios_handicap_total_ft_away_minus_1_5',
    home: 'Aston Villa',
    away: 'Liverpool',
    data: '2026-05-15',
  });

  assert.equal(lookup.found, true);
  assert.equal(lookup.odd, 1.57);
  assert.equal(lookup.mercado_superbet, 'Escanteios - Handicap');
  assert.equal(lookup.selecao_superbet, 'Mais de -1.5');
  db.close();
});