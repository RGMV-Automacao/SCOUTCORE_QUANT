import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordToPortugueseRow,
  getTournamentIdsForLiga,
  TOURNAMENT_IDS,
  parseRawEntries,
  eventToRawEntries,
} from '../src/index.mjs';

test('recordToPortugueseRow: over/under produz "Mais de X.X"', () => {
  const row = recordToPortugueseRow({
    heading: 'Total de Gols', outcome: 'mais', line: 2.5, line_str: '2.5',
    family: 'gols', scope: 'total', period: 'FT',
  });
  assert.deepEqual(row, { mercado: 'Total de Gols', selecao: 'Mais de 2.5', linha: '2.5' });
});

test('recordToPortugueseRow: under produz "Menos de X.X"', () => {
  const row = recordToPortugueseRow({
    heading: 'Total de Escanteios', outcome: 'menos', line: 10.5, line_str: '10.5',
    family: 'escanteios', scope: 'total', period: 'FT',
  });
  assert.deepEqual(row, { mercado: 'Total de Escanteios', selecao: 'Menos de 10.5', linha: '10.5' });
});

test('recordToPortugueseRow: BTTS sim/nao', () => {
  const sim = recordToPortugueseRow({
    heading: 'Ambas as Equipes Marcam', outcome: 'sim',
    family: 'gols', scope: 'total', period: 'FT',
  });
  assert.deepEqual(sim, { mercado: 'Ambas as Equipes Marcam', selecao: 'Sim', linha: null });
  const nao = recordToPortugueseRow({
    heading: 'Ambas as Equipes Marcam', outcome: 'nao',
    family: 'gols', scope: 'total', period: 'FT',
  });
  assert.deepEqual(nao, { mercado: 'Ambas as Equipes Marcam', selecao: 'Não', linha: null });
});

test('recordToPortugueseRow: 1X2 mantém label', () => {
  for (const out of ['1', 'X', '2']) {
    const row = recordToPortugueseRow({
      heading: 'Resultado Final', outcome: out, family: 'resultado', scope: 'total', period: 'FT',
    });
    assert.deepEqual(row, { mercado: 'Resultado Final', selecao: out, linha: null });
  }
});

test('recordToPortugueseRow: Dupla Chance', () => {
  for (const out of ['1X', '12', 'X2']) {
    const row = recordToPortugueseRow({
      heading: 'Dupla Chance', outcome: out, family: 'resultado', scope: 'total', period: 'FT',
    });
    assert.deepEqual(row, { mercado: 'Dupla Chance', selecao: out, linha: null });
  }
});

test('recordToPortugueseRow: scope=equipe é descartado (tabela odds não modela)', () => {
  const row = recordToPortugueseRow({
    heading: 'Total de Gols da Equipe', outcome: 'mais', line: 1.5, line_str: '1.5',
    family: 'gols', scope: 'equipe_home', period: 'FT',
  });
  assert.equal(row, null);
});

test('recordToPortugueseRow: outcomes não mapeados retornam null', () => {
  assert.equal(recordToPortugueseRow({ heading: 'X', outcome: 'gol' }), null);
  assert.equal(recordToPortugueseRow({ heading: 'X', outcome: 'handicap' }), null);
  assert.equal(recordToPortugueseRow({}), null);
});

test('getTournamentIdsForLiga: ligas conhecidas', () => {
  assert.deepEqual(getTournamentIdsForLiga('brasileirao'), [TOURNAMENT_IDS['brasileirao']]);
  assert.deepEqual(getTournamentIdsForLiga('liga-mx'), [83, 1095]); // candidates
  assert.deepEqual(getTournamentIdsForLiga('inexistente'), []);
});

test('parseRawEntries + recordToPortugueseRow: pipeline integrado', () => {
  // Simula payload da API Superbet: heading + selection name + odd.
  const rawEntries = [
    { heading: 'Total de Gols',     lineText: '2.5', outcome: 'Mais',  odd: 1.85, teamTab: null, sectionName: 'Total de Gols' },
    { heading: 'Total de Gols',     lineText: '2.5', outcome: 'Menos', odd: 2.05, teamTab: null, sectionName: 'Total de Gols' },
    { heading: 'Ambas as Equipes Marcam', lineText: null, outcome: 'Sim', odd: 1.70, teamTab: null, sectionName: 'BTTS' },
    { heading: 'Resultado Final',   lineText: null, outcome: '1',    odd: 2.10, teamTab: null, sectionName: 'RF' },
    { heading: 'Resultado Final',   lineText: null, outcome: 'X',    odd: 3.40, teamTab: null, sectionName: 'RF' },
    { heading: 'Resultado Final',   lineText: null, outcome: '2',    odd: 3.20, teamTab: null, sectionName: 'RF' },
    { heading: 'Dupla Chance',      lineText: null, outcome: '1X',   odd: 1.35, teamTab: null, sectionName: 'DC' },
  ];
  const { records, skipped } = parseRawEntries(rawEntries, {
    homeTeam: 'Flamengo', awayTeam: 'Palmeiras', matchId: 0, runId: 't',
  });
  assert.equal(skipped.length, 0, `skipped: ${JSON.stringify(skipped)}`);
  assert.equal(records.length, 7);
  const rows = records.map(recordToPortugueseRow).filter(Boolean);
  assert.equal(rows.length, 7);
  // Verifica uma linha específica.
  const over = rows.find((r) => r.mercado === 'Total de Gols' && r.selecao === 'Mais de 2.5');
  assert.ok(over, 'expected Mais de 2.5');
});

test('eventToRawEntries: payload mínimo da API → rawEntries', () => {
  const payload = {
    matchName: 'Flamengo · Palmeiras',
    odds: [
      { marketName: 'Total de Gols', name: 'Mais de 2.5', price: 1.85, status: 'active' },
      { marketName: 'Resultado Final', name: '1', price: 2.10, status: 'active' },
      { marketName: 'Ambas as Equipes Marcam', name: 'Sim', price: 1.70, status: 'active' },
    ],
  };
  const entries = eventToRawEntries(payload, { homeTeam: 'Flamengo', awayTeam: 'Palmeiras' });
  assert.equal(entries.length, 3);
  assert.equal(entries[0].heading, 'Total de Gols');
  assert.equal(entries[0].outcome, 'mais');
  assert.equal(entries[0].lineText, '2.5');
  assert.equal(entries[0].odd, 1.85);
});
