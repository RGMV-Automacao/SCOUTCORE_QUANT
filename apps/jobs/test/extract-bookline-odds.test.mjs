import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareOddsRowsForMatch, resolveKnownEventIdForMatch } from '../src/extract-bookline-odds.mjs';

test('prepareOddsRowsForMatch deduplica quote_key na mesma coleta', () => {
  const match = {
    id_confronto: 'match_1',
    liga: 'premier-league',
    home_team: 'Arsenal',
    away_team: 'Burnley',
    data_jogo: '2026-05-18',
  };
  const records = [
    { heading: 'Total de Gols', scope: 'total', outcome: 'mais', line: 2.5, odd: 1.8 },
    { heading: 'Total de Gols', scope: 'total', outcome: 'mais', line: 2.5, odd: 1.82 },
    { heading: 'Resultado Final', scope: 'total', outcome: '1', odd: 1.08 },
  ];

  const result = prepareOddsRowsForMatch({
    match,
    eventId: '12099608',
    coletaId: 'coleta_teste',
    records,
    createdAt: '2026-05-17 18:30:00',
  });

  assert.equal(result.rows.length, 2);
  assert.equal(result.stats.raw_records, 3);
  assert.equal(result.stats.mapped_rows, 3);
  assert.equal(result.stats.duplicate_rows, 1);
  assert.equal(result.stats.canonical_market_keys, 2);
  assert.equal(result.stats.raw_market_keys, 0);
  assert.equal(result.rows.find((row) => row.mercado === 'Total de Gols').odd, 1.82);
  assert.equal(result.rows.every((row) => row.id_confronto === 'match_1'), true);
  assert.equal(result.rows.every((row) => row.snapshot_id === row.quote_key), true);
  assert.equal(result.rows.every((row) => /^bookline_sig_[a-f0-9]{40}$/.test(row.quote_signature)), true);
});

test('resolveKnownEventIdForMatch usa source_event_id salvo', () => {
  const stmt = {
    get(id) {
      assert.equal(id, 'match_legacy');
      return { source_event_id: ' 12099608 ' };
    },
  };

  assert.equal(resolveKnownEventIdForMatch(stmt, { id_confronto: 'match_legacy' }), '12099608');
  assert.equal(resolveKnownEventIdForMatch(stmt, { id_confronto: '' }), null);
  assert.equal(resolveKnownEventIdForMatch(null, { id_confronto: 'match_legacy' }), null);
});

test('prepareOddsRowsForMatch normaliza gols por equipe FT e HT', () => {
  const match = {
    id_confronto: 'match_1',
    liga: 'premier-league',
    home_team: 'AFC Bournemouth',
    away_team: 'Manchester City',
    data_jogo: '2026-05-19',
  };
  const records = [
    { heading: 'Total de Gols da Equipe', scope: 'equipe_home', outcome: 'mais', line: 0.5, line_str: '0.5', family: 'gols', period: 'FT', odd: 1.35, team_tab: 'Bournemouth' },
    { heading: 'Total de Gols da Equipe', scope: 'equipe_away', outcome: 'mais', line: 0.5, line_str: '0.5', family: 'gols', period: 'FT', odd: 1.08, team_tab: 'Manchester City' },
    { heading: '1º Tempo - Total de Gols do Time', scope: 'equipe_home', outcome: 'mais', line: 0.5, line_str: '0.5', family: 'gols', period: '1T', odd: 2.9, team_tab: 'Bournemouth' },
    { heading: '1º Tempo - Total de Gols do Time', scope: 'equipe_away', outcome: 'mais', line: 0.5, line_str: '0.5', family: 'gols', period: '1T', odd: 1.72, team_tab: 'Manchester City' },
  ];

  const result = prepareOddsRowsForMatch({
    match,
    eventId: '12099607',
    coletaId: 'coleta_team_goals',
    records,
    createdAt: '2026-05-19 16:30:00',
  });

  assert.equal(result.rows.length, 4);
  assert.equal(result.stats.duplicate_rows, 0);
  assert.equal(result.stats.canonical_market_keys, 4);
  assert.deepEqual(new Set(result.rows.map((row) => row.mercado_key)), new Set([
    'gols_home_ft_over_0_5',
    'gols_away_ft_over_0_5',
    'gols_home_ht_over_0_5',
    'gols_away_ht_over_0_5',
  ]));
});

test('prepareOddsRowsForMatch ignora mercados fora do catalogo atual', () => {
  const match = {
    id_confronto: 'match_1',
    liga: 'premier-league',
    home_team: 'Arsenal',
    away_team: 'Burnley',
    data_jogo: '2026-05-18',
  };
  const records = [
    { heading: 'Total de Escanteios', scope: 'total', outcome: 'mais', line: 3.5, line_str: '3.5', family: 'escanteios', period: 'FT', odd: 1.003 },
    { heading: '1º Tempo - Arsenal - Marcar Gol', scope: 'equipe_home', outcome: 'sim', family: 'gols', period: '1T', odd: 1.7, team_tab: 'Arsenal' },
  ];

  const result = prepareOddsRowsForMatch({
    match,
    eventId: '12099608',
    coletaId: 'coleta_catalogo',
    records,
    createdAt: '2026-05-18 15:00:00',
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].mercado_key, 'escanteios_total_ft_over_3_5');
  assert.equal(result.stats.out_of_catalog_rows, 1);
  assert.equal(result.stats.raw_market_keys, 0);
});

test('prepareOddsRowsForMatch aceita match em dialeto portugues', () => {
  const match = {
    id_confronto: 'match_1',
    liga: 'premier-league',
    equipe_home: 'Arsenal',
    equipe_away: 'Burnley',
    data_jogo: '2026-05-18',
  };
  const records = [
    { heading: 'Escanteios - Handicap', scope: 'total', outcome: 'mais', line: -5.5, line_str: '-5.5', family: 'escanteios', period: 'FT', odd: 1.76, team_tab: 'Arsenal' },
    { heading: '1º Tempo - Handicap de Escanteio', scope: 'total', outcome: 'mais', line: 2.5, line_str: '2.5', family: 'escanteios', period: '1T', odd: 2.1, team_tab: 'Burnley' },
  ];

  const result = prepareOddsRowsForMatch({
    match,
    eventId: '12099608',
    coletaId: 'coleta_pt_fields',
    records,
    createdAt: '2026-05-18 15:00:00',
  });

  assert.equal(result.rows.length, 2);
  assert.equal(result.stats.out_of_catalog_rows, 0);
  assert.deepEqual(new Set(result.rows.map((row) => row.mercado_key)), new Set([
    'escanteios_handicap_total_ft_home_minus_5_5',
    'escanteios_handicap_total_ht_away_plus_2_5',
  ]));
  assert.equal(result.rows.every((row) => row.home_team === 'Arsenal' && row.away_team === 'Burnley'), true);
});