#!/usr/bin/env node
// scripts/backtest/compute-metrics.mjs
//
// Métricas de calibração e acurácia por (liga × family) a partir de backtest_eval
// (apenas linhas com observed != NULL — green/red).
//
// Saídas:
//   audit/backtest/metrics_by_family.csv     — Brier, log-loss, accuracy, n
//   audit/backtest/reliability.csv            — observed_freq por prob_bin (10 bins)
//   audit/backtest/coverage.csv               — n_green, n_red, n_push, n_void por (liga, family)
//
// Uso:
//   node scripts/backtest/compute-metrics.mjs

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH  = process.env.SCOUT_DB
  ? path.resolve(process.env.SCOUT_DB)
  : path.resolve(__dirname, '..', '..', 'data', 'scout_extraction.db');
const OUT_DIR  = path.resolve(__dirname, '..', '..', 'audit', 'backtest');
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

// 1) métricas por (liga, family, period, direction) — somente green/red
//    QUEBRAR por direction é crítico: senão over+under cancelam (mean_pred=0.5, base=0.5)
console.log('[metrics] computando métricas por (liga, family, period, direction)...');
const aggStmt = db.prepare(`
  SELECT
    o.liga,
    p.family,
    p.period,
    COALESCE(p.direction, '_') AS direction,
    COUNT(*)                                                AS n,
    AVG(e.observed)                                         AS base_rate,
    AVG(e.fair_prob)                                        AS mean_pred,
    AVG((e.observed - e.fair_prob)*(e.observed - e.fair_prob))  AS brier,
    AVG(CASE WHEN e.fair_prob > 0 AND e.fair_prob < 1
             THEN -(e.observed*LN(e.fair_prob) + (1-e.observed)*LN(1-e.fair_prob))
             ELSE 0 END)                                AS log_loss,
    AVG(CASE WHEN (e.fair_prob >= 0.5 AND e.observed = 1) OR (e.fair_prob < 0.5 AND e.observed = 0)
             THEN 1.0 ELSE 0.0 END)                     AS accuracy
  FROM backtest_eval e
  JOIN backtest_outcomes    o ON o.id_confronto = e.id_confronto
  JOIN backtest_predictions p ON p.id_confronto = e.id_confronto AND p.market_key = e.market_key
  WHERE e.observed IS NOT NULL
  GROUP BY o.liga, p.family, p.period, COALESCE(p.direction, '_')
  ORDER BY o.liga, p.family, p.period, COALESCE(p.direction, '_')
`);
const agg = aggStmt.all();
const aggCsv = ['liga,family,period,direction,n,base_rate,mean_pred,brier,log_loss,accuracy']
  .concat(agg.map(r => `${r.liga},${r.family},${r.period},${r.direction},${r.n},${r.base_rate.toFixed(6)},${r.mean_pred.toFixed(6)},${r.brier.toFixed(6)},${r.log_loss.toFixed(6)},${r.accuracy.toFixed(6)}`))
  .join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'metrics_by_family.csv'), aggCsv);
console.log(`  ${agg.length} linhas → metrics_by_family.csv`);

// 2) reliability curve — 10 bins (0–0.1, 0.1–0.2, ..., 0.9–1.0)
console.log('[metrics] computando reliability...');
const relStmt = db.prepare(`
  SELECT
    o.liga,
    p.family,
    p.period,
    CAST(MIN(9, CAST(e.fair_prob * 10 AS INTEGER)) AS INTEGER) AS prob_bin,
    COUNT(*)        AS n,
    AVG(e.fair_prob)  AS mean_pred,
    AVG(e.observed)   AS observed_freq
  FROM backtest_eval e
  JOIN backtest_outcomes    o ON o.id_confronto = e.id_confronto
  JOIN backtest_predictions p ON p.id_confronto = e.id_confronto AND p.market_key = e.market_key
  WHERE e.observed IS NOT NULL
  GROUP BY o.liga, p.family, p.period, prob_bin
  ORDER BY o.liga, p.family, p.period, prob_bin
`);
const rel = relStmt.all();
const relCsv = ['liga,family,period,prob_bin,bin_lo,bin_hi,n,mean_pred,observed_freq,gap']
  .concat(rel.map(r => {
    const lo = r.prob_bin/10, hi = (r.prob_bin+1)/10;
    const gap = r.observed_freq - r.mean_pred;
    return `${r.liga},${r.family},${r.period},${r.prob_bin},${lo.toFixed(2)},${hi.toFixed(2)},${r.n},${r.mean_pred.toFixed(6)},${r.observed_freq.toFixed(6)},${gap.toFixed(6)}`;
  })).join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'reliability.csv'), relCsv);
console.log(`  ${rel.length} linhas → reliability.csv`);

// 3) coverage — green/red/push/void por (liga, family)
console.log('[metrics] computando coverage...');
const covStmt = db.prepare(`
  SELECT
    o.liga,
    p.family,
    SUM(CASE WHEN e.outcome='green' THEN 1 ELSE 0 END) n_green,
    SUM(CASE WHEN e.outcome='red'   THEN 1 ELSE 0 END) n_red,
    SUM(CASE WHEN e.outcome='push'  THEN 1 ELSE 0 END) n_push,
    SUM(CASE WHEN e.outcome='void'  THEN 1 ELSE 0 END) n_void,
    COUNT(*) n_total
  FROM backtest_eval e
  JOIN backtest_outcomes    o ON o.id_confronto = e.id_confronto
  JOIN backtest_predictions p ON p.id_confronto = e.id_confronto AND p.market_key = e.market_key
  GROUP BY o.liga, p.family
  ORDER BY o.liga, p.family
`);
const cov = covStmt.all();
const covCsv = ['liga,family,n_green,n_red,n_push,n_void,n_total']
  .concat(cov.map(r => `${r.liga},${r.family},${r.n_green},${r.n_red},${r.n_push},${r.n_void},${r.n_total}`))
  .join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'coverage.csv'), covCsv);
console.log(`  ${cov.length} linhas → coverage.csv`);

// 4) sumário no console — top 10 piores Brier (n ≥ 1000)
console.log('\n=== Top 10 PIORES Brier (n ≥ 1000) — calibração precisa ===');
const piores = agg.filter(r => r.n >= 1000).sort((a,b) => b.brier - a.brier).slice(0, 15);
for (const r of piores) {
  console.log(`  ${r.liga.padEnd(20)} ${r.family.padEnd(20)} ${r.period}  n=${String(r.n).padEnd(7)} brier=${r.brier.toFixed(4)}  mean_pred=${r.mean_pred.toFixed(3)}  base=${r.base_rate.toFixed(3)}  gap=${(r.base_rate - r.mean_pred).toFixed(3)}`);
}

console.log('\n=== Top 10 MELHORES Brier (n ≥ 1000) — bem calibrados ===');
const melhores = agg.filter(r => r.n >= 1000).sort((a,b) => a.brier - b.brier).slice(0, 10);
for (const r of melhores) {
  console.log(`  ${r.liga.padEnd(20)} ${r.family.padEnd(20)} ${r.period}  n=${String(r.n).padEnd(7)} brier=${r.brier.toFixed(4)}  mean_pred=${r.mean_pred.toFixed(3)}  base=${r.base_rate.toFixed(3)}  gap=${(r.base_rate - r.mean_pred).toFixed(3)}`);
}

console.log('\n=== Famílias com gap |mean_pred − base_rate| > 0.05 (precisam shift) ===');
const offs = agg.filter(r => r.n >= 1000 && Math.abs(r.base_rate - r.mean_pred) > 0.05).sort((a,b) => Math.abs(b.base_rate - b.mean_pred) - Math.abs(a.base_rate - a.mean_pred)).slice(0, 20);
for (const r of offs) {
  const gap = r.base_rate - r.mean_pred;
  console.log(`  ${r.liga.padEnd(20)} ${r.family.padEnd(20)} ${r.period}  pred=${r.mean_pred.toFixed(3)} base=${r.base_rate.toFixed(3)} gap=${gap>0?'+':''}${gap.toFixed(3)}`);
}

db.close();
console.log(`\n[metrics] CSVs em ${OUT_DIR}`);
