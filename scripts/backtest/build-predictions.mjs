#!/usr/bin/env node
// scripts/backtest/build-predictions.mjs
//
// Roda engine-a sobre cada partida histórica usando perfis ROLLING pré-jogo
// (backtest_team_profiles + backtest_league_priors) e persiste todos os
// ~576 slots em backtest_predictions.
//
// Sem calibração e sem isotonic: queremos fair_prob_raw do modelo para
// posteriormente medir Brier/Reliability e treinar as próprias curvas.
//
// Uso:
//   node scripts/backtest/build-predictions.mjs               # rebuild full
//   node scripts/backtest/build-predictions.mjs --liga brasileirao
//   node scripts/backtest/build-predictions.mjs --limit 100
//   node scripts/backtest/build-predictions.mjs --min-n 5     # exige n_events≥5 nos perfis

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { predict as predictA, ENGINE_A_VERSION } from '@scoutcore/engine-a';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'scout.db');

const args = parseArgs(process.argv.slice(2));
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

console.log(`[predictions] engine-a v${ENGINE_A_VERSION}`);
console.log('[predictions] limpando backtest_predictions...');
db.exec('DELETE FROM backtest_predictions');

const minN = args.minN ?? 5;

const partidasStmt = db.prepare(`
  SELECT bo.id_confronto, bo.liga, bo.temporada, bo.data_partida, bo.home_team, bo.away_team
  FROM backtest_outcomes bo
  WHERE EXISTS (SELECT 1 FROM backtest_team_profiles WHERE id_confronto=bo.id_confronto AND side='home' AND n_events>=@minN)
    AND EXISTS (SELECT 1 FROM backtest_team_profiles WHERE id_confronto=bo.id_confronto AND side='away' AND n_events>=@minN)
    AND EXISTS (SELECT 1 FROM backtest_league_priors  WHERE id_confronto=bo.id_confronto AND period='FT' AND n_events>=@minN)
  ${args.liga ? `AND bo.liga = @liga` : ''}
  ORDER BY bo.data_partida ASC
  ${args.limit ? `LIMIT @limit` : ''}
`);
const partidas = partidasStmt.all({ liga: args.liga, limit: args.limit, minN });
console.log(`[predictions] partidas elegíveis (n_events≥${minN}): ${partidas.length}`);

const profileStmt = db.prepare(`
  SELECT payload, n_events FROM backtest_team_profiles
  WHERE id_confronto=? AND team=? AND side=?
`);
const priorsStmt = db.prepare(`
  SELECT payload, n_events FROM backtest_league_priors
  WHERE id_confronto=? AND liga=? AND period='FT'
`);

const insertStmt = db.prepare(`
  INSERT INTO backtest_predictions (
    id_confronto, market_key, family, scope, period, direction, line,
    fair_prob_raw, fair_prob, fair_odd, certified, lambdas_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stats = { total: 0, skipped: 0, slots_inserted: 0, slots_skipped_invalid: 0 };

const processOne = db.transaction((p) => {
  const ph = profileStmt.get(p.id_confronto, p.home_team, 'home');
  const pa = profileStmt.get(p.id_confronto, p.away_team, 'away');
  const pr = priorsStmt.get(p.id_confronto, p.liga);
  if (!ph || !pa || !pr) { stats.skipped++; return; }

  const profileHome = JSON.parse(ph.payload);
  const profileAway = JSON.parse(pa.payload);
  const priors      = JSON.parse(pr.payload);

  let out;
  try {
    out = predictA({
      home: p.home_team, away: p.away_team, liga: p.liga,
      profileHome, profileAway, priors,
    });
  } catch (e) {
    stats.skipped++;
    if (args.verbose) console.error('engine err', p.id_confronto, e.message);
    return;
  }

  const lambdasJson = out.lambdas ? JSON.stringify(out.lambdas) : null;

  for (const s of out.slots) {
    const fp = Number(s.fair_prob);
    const fpRaw = Number(s.fair_prob_raw ?? s.fair_prob);
    if (!Number.isFinite(fp) || fp < 0 || fp > 1) { stats.slots_skipped_invalid++; continue; }

    insertStmt.run(
      p.id_confronto,
      s.market_key,
      s.family,
      s.scope,
      s.period,
      s.direction ?? null,
      s.line ?? null,
      fpRaw,
      fp,
      s.fair_odd ?? null,
      s.certified ? 1 : 0,
      lambdasJson,
    );
    stats.slots_inserted++;
  }
});

const t0 = Date.now();
for (const p of partidas) {
  processOne(p);
  stats.total++;
  if (stats.total % 500 === 0) {
    const elapsed = (Date.now() - t0) / 1000;
    const rate = stats.total / elapsed;
    const eta = (partidas.length - stats.total) / rate;
    console.log(`  ${stats.total}/${partidas.length} | slots=${stats.slots_inserted} | rate=${rate.toFixed(1)}/s | ETA=${eta.toFixed(0)}s`);
  }
}

console.log('\n[predictions] resumo:', stats);
console.log(`tempo total: ${((Date.now()-t0)/1000).toFixed(1)}s`);

// sanity
const fams = db.prepare(`
  SELECT family, COUNT(*) n, AVG(fair_prob) mean, MIN(fair_prob) min, MAX(fair_prob) max
  FROM backtest_predictions GROUP BY family ORDER BY n DESC LIMIT 20
`).all();
console.log('\nPor família:');
fams.forEach(f => console.log(`  ${f.family.padEnd(20)} n=${String(f.n).padEnd(8)} mean=${f.mean.toFixed(3)} [${f.min.toFixed(3)}..${f.max.toFixed(3)}]`));

db.close();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--liga')  out.liga = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--min-n') out.minN = Number(argv[++i]);
    else if (a === '--verbose') out.verbose = true;
  }
  return out;
}
