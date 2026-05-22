import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildStatslineHeaders,
  extractStatslineSchedule,
  extractStatslineScheduleAll,
  fetchSchedulePages,
  listStatslineScheduleTargets,
  parseScheduleMatch,
} from '../src/extract-statsline-schedule.mjs';

async function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scq-schedule-'));
  const dbPath = join(dir, 'scout_extraction.db');
  try {
    return await fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makePayload(status = 'Fixture') {
  return {
    match: [
      {
        matchInfo: {
          id: 'm1',
          date: '2026-05-17Z',
          time: '20:30:00Z',
          week: '1',
          competition: { id: 'comp-br-a' },
          venue: { longName: 'Arena Teste', latitude: '-23.5', longitude: '-46.6' },
          contestant: [
            { position: 'home', name: 'Home FC' },
            { position: 'away', name: 'Away FC' },
          ],
        },
        liveData: {
          matchDetails: {
            matchStatus: status,
            scores: status === 'Played'
              ? { ft: { home: 2, away: 1 }, ht: { home: 1, away: 0 } }
              : {},
          },
          matchDetailsExtra: {
            attendance: '12345',
            matchOfficial: [
              { id: 'ref-1', type: 'Main', firstName: 'Ref', lastName: 'One', country: 'BR' },
            ],
          },
        },
      },
    ],
  };
}

function fakeFetch(payload) {
  return async () => ({
    ok: true,
    status: 200,
    text: async () => `callback(${JSON.stringify(payload)})`,
  });
}

test('buildStatslineHeaders uses neutral env header keys', () => {
  assert.deepEqual(
    buildStatslineHeaders({ STATSLINE_REFERER: 'https://referer.example/', STATSLINE_USER_AGENT: 'agent-test' }),
    { 'User-Agent': 'agent-test', Referer: 'https://referer.example/' },
  );
});

test('parseScheduleMatch preserves identity and converts schedule to local date', () => {
  const parsed = parseScheduleMatch(makePayload().match[0], { liga: 'brasileirao', temporada: '2026' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.row.id_confronto, 'm1');
  assert.equal(parsed.row.confronto, 'Home FC x Away FC');
  assert.equal(parsed.row.data_partida, '2026-05-17');
  assert.equal(parsed.row.hora_partida, '20:30');
  assert.equal(parsed.row.data_brasil, '2026-05-17');
  assert.equal(parsed.row.hora_brasil, '17:30');
  assert.equal(parsed.row.estadio, 'Arena Teste');
  assert.equal(parsed.row.arbitro_principal, 'Ref One');
  assert.equal(parsed.officials.length, 1);
});

test('parseScheduleMatch mirrors legacy team-name fallback and normalization', () => {
  const payload = makePayload().match[0];
  payload.matchInfo.contestant = [
    { position: 'home', name: 'Atlético-MG' },
    { position: 'away', name: 'Red Bull Bragantino' },
  ];

  const parsed = parseScheduleMatch(payload, { liga: 'brasileirao', temporada: '2025' });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.row.home_team, 'Atlético Mineiro');
  assert.equal(parsed.row.away_team, 'RB Bragantino');
  assert.equal(parsed.row.confronto, 'Atlético Mineiro x RB Bragantino');

  payload.matchInfo.contestant = [];
  const placeholder = parseScheduleMatch(payload, { liga: 'brasileirao-b', temporada: '2026' });
  assert.equal(placeholder.ok, true);
  assert.equal(placeholder.row.confronto, '? x ?');
});

test('extractStatslineSchedule writes schedule idempotently and logs runs', () => withTempDb(async (dbPath) => {
  const env = {
    STATSLINE_URL_BRASILEIRAO_2026: 'https://example.test/feed?_pgSz=400&tmcl=abc123',
    STATSLINE_REFERER: 'https://referer.example/',
  };

  const first = await extractStatslineSchedule({
    liga: 'brasileirao',
    temporada: '2026',
    dbPath,
    env,
    fetchImpl: fakeFetch(makePayload('Fixture')),
  });
  assert.equal(first.fetched, 1);
  assert.equal(first.inserted, 1);
  assert.equal(first.updated, 0);
  assert.equal(first.written, 1);

  const second = await extractStatslineSchedule({
    liga: 'brasileirao',
    temporada: '2026',
    dbPath,
    env,
    fetchImpl: fakeFetch(makePayload('Played')),
  });
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 1);
  assert.equal(second.written, 1);

  const db = new Database(dbPath, { readonly: true });
  const partida = db.prepare(`
    SELECT id_confronto, status, home_goals, away_goals, home_goals_ht, away_goals_ht,
           estadio, arbitro_principal, publico, processado_stats, processado_odds
      FROM partidas
     WHERE id_confronto = 'm1'
  `).get();
  assert.deepEqual(partida, {
    id_confronto: 'm1',
    status: 'Played',
    home_goals: 2,
    away_goals: 1,
    home_goals_ht: 1,
    away_goals_ht: 0,
    estadio: 'Arena Teste',
    arbitro_principal: 'Ref One',
    publico: 12345,
    processado_stats: 0,
    processado_odds: 0,
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM partidas').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM arbitros').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM partida_arbitro').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM extracoes_log WHERE status = \'ok\'').get().count, 2);
  db.close();
}));

test('extractStatslineSchedule fails on provider error payloads', async () => {
  await assert.rejects(
    () => extractStatslineSchedule({
      liga: 'brasileirao',
      temporada: '2026',
      dryRun: true,
      env: { STATSLINE_URL_BRASILEIRAO_2026: 'https://example.test/feed?tmcl=abc123' },
      fetchImpl: fakeFetch({ httpStatus: '403', errorCode: '10300', token: 'redacted' }),
    }),
    /schedule_provider_403_10300/,
  );
});

test('fetchSchedulePages retries transient fetch failures', async () => {
  let calls = 0;
  const matches = await fetchSchedulePages('https://example.test/feed?tmcl=abc123', {
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return {
        ok: true,
        status: 200,
        text: async () => `callback(${JSON.stringify(makePayload('Fixture'))})`,
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(matches.length, 1);
});

test('extractStatslineScheduleAll runs enabled targets and skips documented inactive seasons', () => withTempDb(async (dbPath) => {
  const config = {
    leagues: [
      {
        id: 'brasileirao',
        name: 'Brasileirao Serie A',
        country: 'Brasil',
        seasons: [
          { label: '2026', env_key: 'STATSLINE_URL_BRASILEIRAO_2026', legacy_env_key: 'API_URL_BRASILEIRAO_2026' },
          { label: '2025', env_key: 'STATSLINE_URL_BRASILEIRAO', legacy_env_key: 'API_URL_BRASILEIRAO' },
        ],
      },
      {
        id: 'primeira-liga',
        name: 'Primeira Liga',
        country: 'Portugal',
        seasons: [
          { label: '2024/2025', env_key: 'STATSLINE_URL_PRIMEIRA_LIGA_2024_2025', legacy_env_key: 'API_URL_PRIMEIRA_LIGA_2024_2025', enabled: false, ignore_reason: 'legacy_url_absent' },
        ],
      },
    ],
  };
  const env = {
    STATSLINE_URL_BRASILEIRAO_2026: 'https://example.test/feed?tmcl=abc123',
    STATSLINE_URL_BRASILEIRAO: 'https://example.test/feed?tmcl=abc456',
  };

  assert.deepEqual(listStatslineScheduleTargets(config), [
    { liga: 'brasileirao', temporada: '2026' },
    { liga: 'brasileirao', temporada: '2025' },
  ]);

  const summary = await extractStatslineScheduleAll({
    dbPath,
    config,
    env,
    fetchImpl: fakeFetch(makePayload('Fixture')),
  });

  assert.equal(summary.target_count, 2);
  assert.equal(summary.ok, 2);
  assert.equal(summary.failed, 0);
  assert.equal(summary.written, 2);

  const db = new Database(dbPath, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM partidas').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM extracoes_log WHERE status = \'ok\'').get().count, 2);
  db.close();
}));

test('extractStatslineSchedule dry-run parses without creating a database', () => withTempDb(async (dbPath) => {
  const summary = await extractStatslineSchedule({
    liga: 'brasileirao',
    temporada: '2026',
    dbPath,
    dryRun: true,
    env: { STATSLINE_URL_BRASILEIRAO_2026: 'https://example.test/feed?tmcl=abc123' },
    fetchImpl: fakeFetch(makePayload('Fixture')),
  });

  assert.equal(summary.dry_run, true);
  assert.equal(summary.parsed, 1);
  assert.equal(summary.written, 0);
  assert.throws(() => new Database(dbPath, { readonly: true, fileMustExist: true }), /unable to open database file|cannot open/);
}));
