#!/usr/bin/env node
// refit-isotonic.mjs — D+8 (ou ad-hoc) refit isotônico por (family, direction, liga).
//
// Lê predictions settled (result IN ('green','red')), agrupa por (family, direction, liga)
// e por (family, direction, '*' global) e treina PAV. Salva em isotonic_blob.
//
// Regra de amostra: precisa >= MIN_SAMPLES (20) para considerar a chave.
// Honesto: se não bate o mínimo, NÃO salva e reporta no log.
//
// CLI: --liga BRA1 (opcional), --min-samples 20, --dry-run

import 'dotenv/config';
import Database from 'better-sqlite3';
import { fit, saveIsotonicBlob, MIN_SAMPLES, ISOTONIC_VERSION } from '@scoutcore/isotonic';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const out = { liga: null, minSamples: MIN_SAMPLES, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--liga') out.liga = argv[++i];
    else if (a === '--min-samples') out.minSamples = Number(argv[++i]);
    else if (a === '--dry-run') out.dryRun = true;
  }
  return out;
}

export function refit(db, { liga = null, minSamples = MIN_SAMPLES, dryRun = false } = {}) {
  const where = ["result IN ('green','red')"];
  const params = [];
  if (liga) { where.push('liga = ?'); params.push(liga); }
  const sql = `SELECT family, direction, liga, fair_prob, result FROM prediction WHERE ${where.join(' AND ')}`;
  const rows = db.prepare(sql).all(...params);

  // group by (family, direction, liga) and (family, direction, '*')
  const groups = new Map();
  const push = (key, p, y) => {
    if (!groups.has(key)) groups.set(key, { probs: [], outcomes: [], key });
    const g = groups.get(key);
    g.probs.push(p);
    g.outcomes.push(y);
  };
  for (const r of rows) {
    if (r.fair_prob == null) continue;
    const y = r.result === 'green' ? 1 : 0;
    push(`${r.family}::${r.direction}::${r.liga}`, r.fair_prob, y);
    push(`${r.family}::${r.direction}::*`, r.fair_prob, y);
  }

  const results = { fit: [], skipped: [], total_rows: rows.length };
  for (const [k, g] of groups) {
    const [family, direction, liga2] = k.split('::');
    if (g.probs.length < minSamples) {
      results.skipped.push({ family, direction, liga: liga2, n: g.probs.length, reason: 'below_min_samples' });
      continue;
    }
    // se todos outcomes iguais, isotônica fica degenerada
    const allSame = g.outcomes.every((v) => v === g.outcomes[0]);
    if (allSame) {
      results.skipped.push({ family, direction, liga: liga2, n: g.probs.length, reason: 'degenerate_outcomes' });
      continue;
    }
    const model = fit(g.probs, g.outcomes);
    if (!dryRun) {
      saveIsotonicBlob(db, { family, direction, liga: liga2, model, n_samples: g.probs.length });
    }
    results.fit.push({ family, direction, liga: liga2, n: g.probs.length, breakpoints: model.x.length });
  }
  return results;
}

const isMain = process.argv[1] && (
  import.meta.url === pathToFileURL(process.argv[1]).href ||
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
);

if (isMain) {
  const args = parseArgs(process.argv);
  const dbPath = process.env.SCOUT_DB;
  if (!dbPath) { console.error('SCOUT_DB env required'); process.exit(1); }
  const db = new Database(dbPath);
  const out = refit(db, args);
  console.log(JSON.stringify({ version: ISOTONIC_VERSION, ...out }, null, 2));
}
