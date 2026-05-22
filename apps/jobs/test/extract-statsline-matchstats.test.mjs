import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyExtractionMigrations } from '../../../scripts/lib/extraction-db.mjs';
import { extractStatslineMatchstats } from '../src/extract-statsline-matchstats.mjs';

async function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scq-matchstats-'));
  const dbPath = join(dir, 'scout_extraction.db');
  try {
    return await fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeStatsPayload() {
  return {
    matchInfo: {
      contestant: [
        { id: 'home-id', position: 'home', name: 'Home FC' },
        { id: 'away-id', position: 'away', name: 'Away FC' },
      ],
    },
    liveData: {
      matchDetails: { scores: { ft: { home: 2, away: 1 }, ht: { home: 1, away: 0 } } },
      card: [{ contestantId: 'away-id', playerId: 'p2', type: 'YC', periodId: 1 }],
      lineUp: [
        {
          contestantId: 'home-id',
          formationUsed: '4-3-3',
          stat: [
            { type: 'goals', value: '2' },
            { type: 'goalAssist', value: '2' },
            { type: 'cornerTaken', value: '6' },
            { type: 'totalScoringAtt', value: '14' },
            { type: 'ontargetScoringAtt', value: '7' },
            { type: 'blockedScoringAtt', value: '2' },
            { type: 'totalPass', value: '529' },
            { type: 'accuratePass', value: '461' },
            { type: 'possessionPercentage', value: '64.1' },
            { type: 'totalTackle', value: '16' },
            { type: 'wonTackle', value: '10' },
            { type: 'fkFoulLost', value: '10' },
            { type: 'fkFoulWon', value: '12' },
            { type: 'totalYellowCard', value: '1' },
            { type: 'totalOffside', value: '2' },
            { type: 'saves', value: '1' },
            { type: 'cleanSheet', value: '0' },
          ],
          player: [
            {
              playerId: 'p1', matchName: 'Player One', position: 'FW', positionSide: 'Centre', formationPlace: '9', shirtNumber: '9',
              stat: [
                { type: 'goals', value: '1' },
                { type: 'totalScoringAtt', value: '4' },
                { type: 'ontargetScoringAtt', value: '2' },
                { type: 'minsPlayed', value: '90' },
                { type: 'gameStarted', value: '1' },
              ],
            },
          ],
        },
        {
          contestantId: 'away-id',
          formationUsed: '4-4-2',
          stat: [
            { type: 'goals', value: '1' },
            { type: 'goalAssist', value: '1' },
            { type: 'cornerTaken', value: '3' },
            { type: 'totalScoringAtt', value: '8' },
            { type: 'ontargetScoringAtt', value: '3' },
            { type: 'blockedScoringAtt', value: '1' },
            { type: 'totalPass', value: '301' },
            { type: 'accuratePass', value: '251' },
            { type: 'possessionPercentage', value: '35.9' },
            { type: 'totalTackle', value: '10' },
            { type: 'wonTackle', value: '6' },
            { type: 'fkFoulLost', value: '12' },
            { type: 'fkFoulWon', value: '10' },
            { type: 'totalYellowCard', value: '2' },
            { type: 'totalOffside', value: '1' },
            { type: 'saves', value: '5' },
            { type: 'cleanSheet', value: '0' },
          ],
          player: [
            {
              playerId: 'p2', matchName: 'Player Two', position: 'GK', shirtNumber: '1',
              stat: [
                { type: 'saves', value: '5' },
                { type: 'minsPlayed', value: '90' },
                { type: 'gameStarted', value: '1' },
              ],
            },
          ],
        },
      ],
    },
  };
}

function makeEventsPayload() {
  return {
    liveData: {
      event: [
        { contestantId: 'home-id', typeId: 1, periodId: 1, timeMin: 3, outcome: 1 },
        { contestantId: 'away-id', typeId: 1, periodId: 1, timeMin: 4, outcome: 1 },
        { contestantId: 'home-id', typeId: 1, periodId: 1, timeMin: 8, outcome: 1 },
        { contestantId: 'away-id', typeId: 1, periodId: 1, timeMin: 9, outcome: 0 },
        { contestantId: 'home-id', typeId: 7, periodId: 1, timeMin: 11, outcome: 1 },
        { contestantId: 'home-id', typeId: 16, periodId: 1, timeMin: 12, outcome: 1 },
        { contestantId: 'home-id', typeId: 6, periodId: 1, timeMin: 20, outcome: 1 },
        { contestantId: 'home-id', typeId: 15, periodId: 1, timeMin: 30, outcome: 1, qualifier: [{ qualifierId: 82 }] },
        { contestantId: 'home-id', typeId: 1, periodId: 1, timeMin: 31, outcome: 0 },
        { contestantId: 'away-id', typeId: 4, periodId: 1, timeMin: 33, outcome: 0 },
        { contestantId: 'away-id', typeId: 7, periodId: 1, timeMin: 36, outcome: 1 },
        { contestantId: 'away-id', typeId: 13, periodId: 1, timeMin: 40, outcome: 0 },
      ],
    },
  };
}

function fakeFetch() {
  return async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('/matchstats/') ? makeStatsPayload() : makeEventsPayload(),
  });
}

test('extractStatslineMatchstats fills teams, match totals, players and event bands', () => withTempDb(async (dbPath) => {
  applyExtractionMigrations({ dbPath });
  const db = new Database(dbPath);
  db.prepare(`
    INSERT INTO partidas(id_confronto, liga, temporada, id_liga, rodada, confronto, home_team, away_team, data_partida, status)
    VALUES ('m1', 'brasileirao', '2025', 'comp', '1', 'Home FC x Away FC', 'Home FC', 'Away FC', '2025-04-01', 'Played')
  `).run();
  db.close();

  const summary = await extractStatslineMatchstats({
    dbPath,
    liga: 'brasileirao',
    temporada: '2025',
    env: { STATSLINE_API_BASE: 'https://example.test/data', STATSLINE_TOKEN: 'token', STATSLINE_REFERER: 'https://referer.example/' },
    fetchImpl: fakeFetch(),
  });

  assert.equal(summary.candidates, 1);
  assert.equal(summary.processed, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.times_written, 4);
  assert.equal(summary.confronto_written, 2);
  assert.equal(summary.jogadores_written, 2);
  assert.equal(summary.eventos_faixa_written, 16);
  assert.deepEqual(summary.affected_league_seasons, [
    { liga: 'brasileirao', temporada: '2025', processed: 1 },
  ]);

  const readonly = new Database(dbPath, { readonly: true });
  assert.equal(readonly.prepare('SELECT COUNT(*) AS count FROM times').get().count, 4);
  assert.equal(readonly.prepare('SELECT COUNT(*) AS count FROM confronto').get().count, 2);
  assert.equal(readonly.prepare('SELECT COUNT(*) AS count FROM jogadores').get().count, 2);
  assert.equal(readonly.prepare('SELECT COUNT(*) AS count FROM eventos_faixa').get().count, 16);
  assert.deepEqual(
    readonly.prepare(`
      SELECT id_liga, confronto, rodada, status, assistencias, chutes_bloqueados,
             passes, desarmes, faltas_cometidas, faltas_sofridas,
             escanteios_sofridos, chutes_sofridos, chutes_noalvo_sofridos,
             posse, passes_certos, desarmes_certos, clean_sheet
        FROM times
       WHERE id_confronto = 'm1' AND time = 'Home FC' AND modo = 'FT'
    `).get(),
    {
      id_liga: 'comp',
      confronto: 'Home FC x Away FC',
      rodada: '1',
      status: 'Played',
      assistencias: 2,
      chutes_bloqueados: 2,
      passes: 529,
      desarmes: 16,
      faltas_cometidas: 10,
      faltas_sofridas: 12,
      escanteios_sofridos: 3,
      chutes_sofridos: 8,
      chutes_noalvo_sofridos: 3,
      posse: 64.1,
      passes_certos: 461,
      desarmes_certos: 10,
      clean_sheet: 0,
    },
  );
  assert.deepEqual(
    readonly.prepare(`
      SELECT assistencias, chutes_bloqueados, passes, desarmes,
             passes_certos, desarmes_certos, posse,
             escanteios_sofridos, chutes_sofridos, chutes_noalvo_sofridos
        FROM times
       WHERE id_confronto = 'm1' AND time = 'Home FC' AND modo = 'HT'
    `).get(),
    {
      assistencias: 0,
      chutes_bloqueados: 1,
      passes: 3,
      desarmes: 1,
      passes_certos: 2,
      desarmes_certos: 1,
      posse: 60,
      escanteios_sofridos: 0,
      chutes_sofridos: 1,
      chutes_noalvo_sofridos: 0,
    },
  );
  assert.deepEqual(
    readonly.prepare(`
      SELECT id_liga, confronto, rodada, status, gols, assistencias,
             escanteios, chutes, chutes_bloqueados, passes, desarmes,
             faltas_cometidas, faltas_sofridas, defesas
        FROM confronto
       WHERE id_confronto = 'm1' AND modo = 'FT'
    `).get(),
    {
      id_liga: 'comp',
      confronto: 'Home FC x Away FC',
      rodada: '1',
      status: 'Played',
      gols: 3,
      assistencias: 3,
      escanteios: 9,
      chutes: 22,
      chutes_bloqueados: 3,
      passes: 830,
      desarmes: 26,
      faltas_cometidas: 22,
      faltas_sofridas: 22,
      defesas: 6,
    },
  );
  assert.deepEqual(
    readonly.prepare('SELECT processado_stats, formacao_casa, formacao_fora FROM partidas WHERE id_confronto = ?').get('m1'),
    { processado_stats: 1, formacao_casa: '4-3-3', formacao_fora: '4-4-2' },
  );
  readonly.close();
}));
