#!/usr/bin/env node
// scripts/backtest/fit-isotonic.mjs
//
// Fita curvas isotônicas (PAV) por (liga, family, period, direction) a partir
// dos 6,7M de outcomes em backtest_eval. Persiste em isotonic_blob (schema
// migration 011 — com coluna `period`).
//
// Divisão temporal (walk-forward, sem vazamento):
//   - cutoff = data_partida no 80º percentil das partidas
//   - TREINO  : data_partida <  cutoff  → fita curvas
//   - TESTE   : data_partida >= cutoff  → NÃO usado aqui (vai para validate-calibration.mjs)
//
// Critérios de amostragem:
//   --min-liga    n mínimo para fit por liga (default 1500)
//   --min-global  n mínimo para fit '*' (default 300)
//   --dry-run     calcula tudo mas não escreve
//
// Saídas:
//   data/scout.db :: isotonic_blob (refit completo — DELETE + INSERT)
//   audit/backtest/fit_isotonic_summary.csv

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fit, saveIsotonicBlob } from '@scoutcore/isotonic';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'scout.db');
const OUT_DIR = path.resolve(__dirname, '..', '..', 'audit', 'backtest');
fs.mkdirSync(OUT_DIR, { recursive: true });

const args = parseArgs(process.argv.slice(2));
const MIN_LIGA   = args['min-liga']   ?? 1500;
const MIN_GLOBAL = args['min-global'] ?? 300;
const DRY        = !!args['dry-run'];

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// 1) Cutoff temporal
const total = db.prepare(`SELECT COUNT(*) c FROM backtest_outcomes`).get().c;
const offset = Math.floor(total * 0.8);
const cutoffRow = db.prepare(
  `SELECT data_partida FROM backtest_outcomes ORDER BY data_partida ASC LIMIT 1 OFFSET ?`
).get(offset);
const CUTOFF = cutoffRow?.data_partida;
console.log(`[fit-isotonic] cutoff (80º percentil): ${CUTOFF} (${total} partidas, offset=${offset})`);

// 2) Stream das amostras de TREINO
//    Filtra: observed IS NOT NULL  e data_partida < CUTOFF
//    Junta: backtest_eval ⇄ backtest_predictions (para family/period/direction) ⇄ backtest_outcomes (liga,data)
console.log('[fit-isotonic] carregando amostras de treino (pode demorar 30-60s)...');
const t0 = Date.now();
const rows = db.prepare(`
  SELECT
    o.liga,
    p.family,
    p.period,
    COALESCE(p.direction, '_') AS direction,
    e.fair_prob AS p,
    e.observed  AS y
  FROM backtest_eval e
  JOIN backtest_predictions p ON p.id_confronto = e.id_confronto AND p.market_key = e.market_key
  JOIN backtest_outcomes    o ON o.id_confronto = e.id_confronto
  WHERE e.observed IS NOT NULL
    AND o.data_partida < ?
`).iterate(CUTOFF);

// 3) Bucket por chave
//    key = `${family}|${period}|${direction}` — bucket global agrega ligas
//    bucketLiga[liga] = bucket por liga
const global = new Map();   // key -> {probs:[], outs:[]}
const byLiga = new Map();   // liga -> Map<key, {probs:[], outs:[]}>

let n = 0;
for (const r of rows) {
  if (r.p == null || r.y == null) continue;
  const key = `${r.family}|${r.period}|${r.direction}`;
  let g = global.get(key);
  if (!g) { g = { probs: [], outs: [] }; global.set(key, g); }
  g.probs.push(r.p);
  g.outs.push(r.y);

  let lmap = byLiga.get(r.liga);
  if (!lmap) { lmap = new Map(); byLiga.set(r.liga, lmap); }
  let l = lmap.get(key);
  if (!l) { l = { probs: [], outs: [] }; lmap.set(key, l); }
  l.probs.push(r.p);
  l.outs.push(r.y);

  n++;
  if (n % 1_000_000 === 0) {
    console.log(`  ${(n/1e6).toFixed(1)}M amostras...`);
  }
}
console.log(`[fit-isotonic] ${n.toLocaleString()} amostras carregadas em ${((Date.now()-t0)/1000).toFixed(1)}s`);

// 4) Limpar fits anteriores (refit completo)
if (!DRY) {
  console.log('[fit-isotonic] DELETE FROM isotonic_blob (refit completo)');
  db.exec('DELETE FROM isotonic_blob');
}

// 5) Fit
const summary = []; // p/ CSV
let fitsGlobal = 0, fitsLiga = 0, skipped = 0;

const tx = db.transaction(() => {
  // 5.1 — Global '*'
  for (const [key, bucket] of global) {
    const [family, period, direction] = key.split('|');
    if (bucket.probs.length < MIN_GLOBAL) {
      summary.push({ scope: 'global', liga: '*', family, period, direction, n: bucket.probs.length, status: 'skip_min' });
      skipped++;
      continue;
    }
    try {
      const model = fit(bucket.probs, bucket.outs);
      const meanPred = mean(bucket.probs);
      const baseRate = mean(bucket.outs);
      const brierRaw = brier(bucket.probs, bucket.outs);
      if (!DRY) {
        saveIsotonicBlob(db, { family, period, direction, liga: '*', model, n_samples: bucket.probs.length });
      }
      summary.push({
        scope: 'global', liga: '*', family, period, direction,
        n: bucket.probs.length, mean_pred: meanPred, base_rate: baseRate,
        brier_raw: brierRaw, status: 'fit', breakpoints: model.x.length,
      });
      fitsGlobal++;
    } catch (e) {
      summary.push({ scope: 'global', liga: '*', family, period, direction, n: bucket.probs.length, status: `err:${e.message}` });
    }
  }

  // 5.2 — Liga-específico
  for (const [liga, lmap] of byLiga) {
    for (const [key, bucket] of lmap) {
      const [family, period, direction] = key.split('|');
      if (bucket.probs.length < MIN_LIGA) {
        summary.push({ scope: 'liga', liga, family, period, direction, n: bucket.probs.length, status: 'skip_min' });
        skipped++;
        continue;
      }
      try {
        const model = fit(bucket.probs, bucket.outs);
        const meanPred = mean(bucket.probs);
        const baseRate = mean(bucket.outs);
        const brierRaw = brier(bucket.probs, bucket.outs);
        if (!DRY) {
          saveIsotonicBlob(db, { family, period, direction, liga, model, n_samples: bucket.probs.length });
        }
        summary.push({
          scope: 'liga', liga, family, period, direction,
          n: bucket.probs.length, mean_pred: meanPred, base_rate: baseRate,
          brier_raw: brierRaw, status: 'fit', breakpoints: model.x.length,
        });
        fitsLiga++;
      } catch (e) {
        summary.push({ scope: 'liga', liga, family, period, direction, n: bucket.probs.length, status: `err:${e.message}` });
      }
    }
  }
});
tx();

console.log(`\n[fit-isotonic] resumo:`);
console.log(`  global fits: ${fitsGlobal}`);
console.log(`  liga fits:   ${fitsLiga}`);
console.log(`  skipped (<MIN): ${skipped}`);

// 6) CSV
const cols = ['scope','liga','family','period','direction','n','mean_pred','base_rate','brier_raw','breakpoints','status'];
const csv = [cols.join(',')]
  .concat(summary.map(r => cols.map(c => fmt(r[c])).join(',')))
  .join('\n');
const outFile = path.join(OUT_DIR, 'fit_isotonic_summary.csv');
fs.writeFileSync(outFile, csv);
console.log(`  CSV: ${outFile}`);

if (DRY) console.log('  (DRY-RUN — nada persistido)');

db.close();

// ---- utils ----
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k.startsWith('--')) {
      const name = k.slice(2);
      const next = a[i + 1];
      if (next === undefined || next.startsWith('--')) { o[name] = true; }
      else { o[name] = isNaN(Number(next)) ? next : Number(next); i++; }
    }
  }
  return o;
}
function mean(arr) { let s = 0; for (const v of arr) s += v; return s / arr.length; }
function brier(probs, outs) {
  let s = 0; const n = probs.length;
  for (let i = 0; i < n; i++) { const d = probs[i] - outs[i]; s += d * d; }
  return s / n;
}
function fmt(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6);
  return String(v);
}
