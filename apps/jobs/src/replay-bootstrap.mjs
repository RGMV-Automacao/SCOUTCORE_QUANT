// SCOUTCORE_QUANT — Replay Bootstrap (Engine A real, Engine B opcional)
//
// Itera partidas finalizadas em ordem cronológica (PIT), chama runPredict
// (Engine A) e settler imediato. Cada chamada gera prediction rows
// + clv_history rows.
//
// USO:
//   node apps/jobs/src/replay-bootstrap.mjs --liga=brasileirao --since=2025-01-01 --limit=50
//   node apps/jobs/src/replay-bootstrap.mjs --since=2025-11-01 --until=2025-11-30
//
// Honest scope:
//   - Engines configuráveis via --engines=A,B ou REPLAY_ENGINES=A,B.
//     Se B estiver offline, o bridge degrada sem derrubar o replay.
//   - PIT: features dependem de team_profile/league_priors. Hoje os rebuilds são
//     "as-of-now"; ainda não há snapshot por kickoff. Replay = "calibração contínua".

import 'dotenv/config';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SqliteMatchRepository } from '@scoutcore/data-access';
import { runPredict } from '../../api/src/predict.mjs';
import { settle as settleJob } from './settle-results.mjs';

const VALID_ENGINES = new Set(['A', 'B']);

function parseEngines(value = process.env.REPLAY_ENGINES || 'A,B') {
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const engines = raw.map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (engines.length === 0) throw new Error('engines_required');
  for (const engine of engines) {
    if (!VALID_ENGINES.has(engine)) throw new Error(`invalid_engine:${engine}`);
  }
  return [...new Set(engines)];
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--liga='))       out.liga  = a.slice(7);
    else if (a.startsWith('--since=')) out.since = a.slice(8);
    else if (a.startsWith('--until=')) out.until = a.slice(8);
    else if (a.startsWith('--limit=')) out.limit = Number(a.slice(8));
    else if (a.startsWith('--engines=')) out.engines = parseEngines(a.slice('--engines='.length));
    else if (a === '--dry-run')        out.dryRun = true;
  }
  return out;
}

function selectMatches(db, { liga, since, until, limit }) {
  const where = [`home_goals IS NOT NULL`];
  const params = [];
  if (liga)  { where.push('liga = ?');           params.push(liga); }
  if (since) { where.push('data_partida >= ?');  params.push(since); }
  if (until) { where.push('data_partida <= ?');  params.push(until); }
  let sql = `
    SELECT id_confronto, home_team, away_team, liga, data_partida, hora_partida
    FROM partidas
    WHERE ${where.join(' AND ')}
    ORDER BY data_partida ASC
  `;
  if (limit && Number.isFinite(limit)) sql += ` LIMIT ${Math.floor(limit)}`;
  return db.prepare(sql).all(...params);
}

export async function runReplay(opts = {}) {
  const dbPath = process.env.SCOUT_DB || resolve(process.cwd(), 'data', 'scout_extraction.db');
  const db = new Database(dbPath);
  const repo = new SqliteMatchRepository(dbPath);
  const engines = parseEngines(opts.engines);

  const matches = selectMatches(db, opts);
  console.log(`[replay] ${matches.length} partidas (liga=${opts.liga ?? '*'} since=${opts.since ?? '-'} until=${opts.until ?? '-'} limit=${opts.limit ?? '*'} engines=${engines.join(',')})`);
  if (matches.length === 0) { db.close(); repo.close(); return { matches: 0 }; }

  const replayTag = `replay-${randomUUID().slice(0, 8)}`;
  console.log(`[replay] tag=${replayTag} dryRun=${!!opts.dryRun}`);

  const log = { warn: () => {}, error: () => {} };
  let okCount = 0, errCount = 0, predictedSlots = 0;
  const startedAt = Date.now();

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const body = {
      contract_version: '1.0.0',
      client: { system: 'replay-bootstrap', version: '1.0.0' },
      match: {
        external_id: `statsline:${m.id_confronto}`,
        home: m.home_team,
        away: m.away_team,
        liga: m.liga,
        date: m.data_partida,
      },
      options: { include_engines: engines },
    };
    try {
      const out = await runPredict({ repo, body, log });
      if (out.__error) { errCount++; continue; }
      predictedSlots += out.slots?.length ?? 0;
      okCount++;
      if (!opts.dryRun && out.run_id) {
        settleJob(db, { run_id: out.run_id });
      }
    } catch (e) {
      errCount++;
      console.error(`[replay] err match=${m.id_confronto}: ${e.message}`);
    }
    if ((i + 1) % 25 === 0) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[replay] ${i + 1}/${matches.length} ok=${okCount} err=${errCount} slots=${predictedSlots} (${elapsed}s)`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[replay] DONE ok=${okCount} err=${errCount} slots=${predictedSlots} elapsed=${elapsed}s`);
  db.close();
  repo.close();
  return { matches: matches.length, ok: okCount, err: errCount, slots: predictedSlots };
}

const isMain = import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
  || import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  runReplay(parseArgs(process.argv)).catch(e => { console.error(e); process.exit(1); });
}
