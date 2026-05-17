#!/usr/bin/env node
// scripts/backtest/compute-metrics-calibrated.mjs
//
// Pós-calibração: aplica curvas isotônicas sobre `backtest_eval.fair_prob`
// e re-computa Brier/log-loss/accuracy/reliability por (liga,family,period,direction).
//
// NÃO sobrescreve metrics_by_family.csv (raw). Gera arquivos paralelos:
//   audit/backtest/metrics_by_family_calibrated.csv
//   audit/backtest/reliability_calibrated.csv
//   audit/backtest/calibration_gain.csv     (raw vs calibrado linha-a-linha)
//   audit/backtest/calibration_gain.md      (sumário em markdown)
//
// Uso:
//   node scripts/backtest/compute-metrics-calibrated.mjs

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadIsotonicMap, getIsotonic, predict } from '@scoutcore/isotonic';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'scout.db');
const OUT_DIR = path.resolve(__dirname, '..', '..', 'audit', 'backtest');
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });
const isoMap = loadIsotonicMap(db);
console.log(`[metrics-cal] ${isoMap.size} curvas isotônicas carregadas`);

// ── 1) métricas: stream completo de backtest_eval com observed != NULL ────────
console.log('[metrics-cal] streaming amostras...');
const rowsIter = db.prepare(`
  SELECT
    o.liga,
    p.family,
    p.period,
    COALESCE(p.direction, '_') AS direction,
    e.fair_prob                AS p,
    e.observed                 AS y
  FROM backtest_eval e
  JOIN backtest_outcomes    o ON o.id_confronto = e.id_confronto
  JOIN backtest_predictions p ON p.id_confronto = e.id_confronto AND p.market_key = e.market_key
  WHERE e.observed IS NOT NULL
`).iterate();

// agg por (liga,family,period,direction)
const agg = new Map();
// reliability por (liga,family,period,bin) — só na versão calibrada (10 bins)
const rel = new Map();

let n = 0, applied = 0;
for (const r of rowsIter) {
  if (r.p == null || r.y == null) continue;

  const iso = getIsotonic(isoMap, { family: r.family, period: r.period, direction: r.direction, liga: r.liga });
  const pCal = iso ? predict(iso.model, r.p) : r.p;
  if (iso) applied++;

  // agregado por (liga,family,period,direction)
  const k1 = `${r.liga}\u0001${r.family}\u0001${r.period}\u0001${r.direction}`;
  let s = agg.get(k1);
  if (!s) {
    s = {
      liga: r.liga, family: r.family, period: r.period, direction: r.direction,
      n: 0, has_fit: 0,
      sum_p_raw: 0, sum_p_cal: 0, sum_y: 0,
      sq_raw: 0, sq_cal: 0,
      ll_raw: 0, ll_cal: 0,
      acc_raw: 0, acc_cal: 0,
    };
    agg.set(k1, s);
  }
  s.n++;
  if (iso) s.has_fit++;
  s.sum_p_raw += r.p;
  s.sum_p_cal += pCal;
  s.sum_y     += r.y;
  s.sq_raw    += (r.p   - r.y) ** 2;
  s.sq_cal    += (pCal  - r.y) ** 2;
  // log-loss clamp para evitar log(0)
  const eps = 1e-12;
  const pr = Math.min(Math.max(r.p,  eps), 1 - eps);
  const pc = Math.min(Math.max(pCal, eps), 1 - eps);
  s.ll_raw += -(r.y * Math.log(pr) + (1 - r.y) * Math.log(1 - pr));
  s.ll_cal += -(r.y * Math.log(pc) + (1 - r.y) * Math.log(1 - pc));
  s.acc_raw += ((r.p   >= 0.5 && r.y === 1) || (r.p   < 0.5 && r.y === 0)) ? 1 : 0;
  s.acc_cal += ((pCal  >= 0.5 && r.y === 1) || (pCal  < 0.5 && r.y === 0)) ? 1 : 0;

  // reliability (10 bins) — usa probabilidade calibrada
  const bin = Math.min(9, Math.floor(pCal * 10));
  const k2 = `${r.liga}\u0001${r.family}\u0001${r.period}\u0001${bin}`;
  let rr = rel.get(k2);
  if (!rr) {
    rr = { liga: r.liga, family: r.family, period: r.period, bin, n: 0, sum_p: 0, sum_y: 0 };
    rel.set(k2, rr);
  }
  rr.n++;
  rr.sum_p += pCal;
  rr.sum_y += r.y;

  n++;
  if (n % 500_000 === 0) console.log(`  ${(n / 1e6).toFixed(2)}M (${((applied/n)*100).toFixed(1)}% cal)`);
}

console.log(`[metrics-cal] ${n.toLocaleString()} amostras; ${applied.toLocaleString()} (${((applied/n)*100).toFixed(1)}%) com fit aplicado`);

// ── 2) escrever metrics_by_family_calibrated.csv ──────────────────────────────
const calRows = [...agg.values()].map(s => ({
  liga: s.liga, family: s.family, period: s.period, direction: s.direction,
  n: s.n,
  base_rate:  s.sum_y     / s.n,
  mean_pred:  s.sum_p_cal / s.n,
  brier:      s.sq_cal    / s.n,
  log_loss:   s.ll_cal    / s.n,
  accuracy:   s.acc_cal   / s.n,
})).sort((a, b) => a.liga.localeCompare(b.liga) || a.family.localeCompare(b.family) || a.period.localeCompare(b.period) || a.direction.localeCompare(b.direction));

const calCsv = ['liga,family,period,direction,n,base_rate,mean_pred,brier,log_loss,accuracy']
  .concat(calRows.map(r => `${r.liga},${r.family},${r.period},${r.direction},${r.n},${r.base_rate.toFixed(6)},${r.mean_pred.toFixed(6)},${r.brier.toFixed(6)},${r.log_loss.toFixed(6)},${r.accuracy.toFixed(6)}`))
  .join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'metrics_by_family_calibrated.csv'), calCsv);
console.log(`  ${calRows.length} linhas → metrics_by_family_calibrated.csv`);

// ── 3) reliability_calibrated.csv ─────────────────────────────────────────────
const relRows = [...rel.values()].map(r => ({
  ...r,
  bin_lo:        r.bin / 10,
  bin_hi:        (r.bin + 1) / 10,
  mean_pred:     r.sum_p / r.n,
  observed_freq: r.sum_y / r.n,
  gap:           (r.sum_y / r.n) - (r.sum_p / r.n),
})).sort((a, b) => a.liga.localeCompare(b.liga) || a.family.localeCompare(b.family) || a.period.localeCompare(b.period) || a.bin - b.bin);

const relCsv = ['liga,family,period,prob_bin,bin_lo,bin_hi,n,mean_pred,observed_freq,gap']
  .concat(relRows.map(r => `${r.liga},${r.family},${r.period},${r.bin},${r.bin_lo.toFixed(2)},${r.bin_hi.toFixed(2)},${r.n},${r.mean_pred.toFixed(6)},${r.observed_freq.toFixed(6)},${r.gap.toFixed(6)}`))
  .join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'reliability_calibrated.csv'), relCsv);
console.log(`  ${relRows.length} linhas → reliability_calibrated.csv`);

// ── 4) calibration_gain.csv: comparativo linha-a-linha ────────────────────────
const gainRows = [...agg.values()]
  .filter(s => s.has_fit > 0) // só onde houve fit aplicado
  .map(s => {
    const brierRaw = s.sq_raw / s.n;
    const brierCal = s.sq_cal / s.n;
    const llRaw    = s.ll_raw / s.n;
    const llCal    = s.ll_cal / s.n;
    const gapRaw   = (s.sum_y - s.sum_p_raw) / s.n;
    const gapCal   = (s.sum_y - s.sum_p_cal) / s.n;
    return {
      liga: s.liga, family: s.family, period: s.period, direction: s.direction,
      n: s.n,
      coverage:        s.has_fit / s.n,
      brier_raw:       brierRaw,
      brier_cal:       brierCal,
      delta_brier:     brierCal - brierRaw,
      delta_brier_rel: brierRaw > 0 ? (brierCal - brierRaw) / brierRaw : 0,
      log_loss_raw:    llRaw,
      log_loss_cal:    llCal,
      delta_log_loss:  llCal - llRaw,
      gap_raw:         gapRaw,
      gap_cal:         gapCal,
    };
  })
  .sort((a, b) => a.delta_brier - b.delta_brier); // melhores ganhos primeiro

const gainCsv = ['liga,family,period,direction,n,coverage,brier_raw,brier_cal,delta_brier,delta_brier_rel,log_loss_raw,log_loss_cal,delta_log_loss,gap_raw,gap_cal']
  .concat(gainRows.map(r => `${r.liga},${r.family},${r.period},${r.direction},${r.n},${r.coverage.toFixed(4)},${r.brier_raw.toFixed(6)},${r.brier_cal.toFixed(6)},${r.delta_brier.toFixed(6)},${r.delta_brier_rel.toFixed(6)},${r.log_loss_raw.toFixed(6)},${r.log_loss_cal.toFixed(6)},${r.delta_log_loss.toFixed(6)},${r.gap_raw.toFixed(6)},${r.gap_cal.toFixed(6)}`))
  .join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'calibration_gain.csv'), gainCsv);
console.log(`  ${gainRows.length} linhas → calibration_gain.csv`);

// ── 5) sumário agregado + markdown ────────────────────────────────────────────
const totalN     = gainRows.reduce((a, r) => a + r.n, 0);
const wAvgBrierR = gainRows.reduce((a, r) => a + r.brier_raw * r.n, 0) / totalN;
const wAvgBrierC = gainRows.reduce((a, r) => a + r.brier_cal * r.n, 0) / totalN;
const wAvgGapR   = gainRows.reduce((a, r) => a + Math.abs(r.gap_raw) * r.n, 0) / totalN;
const wAvgGapC   = gainRows.reduce((a, r) => a + Math.abs(r.gap_cal) * r.n, 0) / totalN;
const improved   = gainRows.filter(r => r.delta_brier < 0).length;
const regressed  = gainRows.filter(r => r.delta_brier > 0).length;

console.log('\n=== Sumário pós-calibração ===');
console.log(`  amostras com fit:  ${totalN.toLocaleString()}`);
console.log(`  Brier  RAW:        ${wAvgBrierR.toFixed(6)}`);
console.log(`  Brier  CAL:        ${wAvgBrierC.toFixed(6)}`);
console.log(`  Δ Brier:           ${(wAvgBrierC - wAvgBrierR).toFixed(6)}  (${(((wAvgBrierC - wAvgBrierR) / wAvgBrierR) * 100).toFixed(2)}%)`);
console.log(`  |gap| RAW médio:   ${wAvgGapR.toFixed(6)}`);
console.log(`  |gap| CAL médio:   ${wAvgGapC.toFixed(6)}`);
console.log(`  buckets melhores:  ${improved}/${gainRows.length}`);
console.log(`  buckets piores:    ${regressed}/${gainRows.length}`);

const top10 = gainRows.slice(0, 10);
const md = [
  '# Calibration Gain Report',
  '',
  `Gerado: ${new Date().toISOString()}`,
  `Curvas isotônicas carregadas: ${isoMap.size}`,
  `Amostras (com fit aplicável): ${totalN.toLocaleString()}`,
  '',
  '## Resumo (média ponderada por n)',
  '',
  '| Métrica           | RAW           | Calibrado     | Δ              |',
  '|-------------------|---------------|---------------|----------------|',
  `| Brier             | ${wAvgBrierR.toFixed(6)} | ${wAvgBrierC.toFixed(6)} | ${(wAvgBrierC - wAvgBrierR).toFixed(6)} (${(((wAvgBrierC - wAvgBrierR) / wAvgBrierR) * 100).toFixed(2)}%) |`,
  `| \\|gap\\| médio      | ${wAvgGapR.toFixed(6)} | ${wAvgGapC.toFixed(6)} | ${(wAvgGapC - wAvgGapR).toFixed(6)} |`,
  '',
  `Buckets melhorados: **${improved}/${gainRows.length}**  ·  piorados: ${regressed}/${gainRows.length}`,
  '',
  '## Top 10 maiores ganhos (Δ Brier mais negativo)',
  '',
  '| Liga | Family | Period | Direction | n | cov | Brier raw | Brier cal | Δ Brier |',
  '|------|--------|--------|-----------|---|-----|-----------|-----------|---------|',
  ...top10.map(r => `| ${r.liga} | ${r.family} | ${r.period} | ${r.direction} | ${r.n} | ${(r.coverage*100).toFixed(0)}% | ${r.brier_raw.toFixed(4)} | ${r.brier_cal.toFixed(4)} | ${r.delta_brier.toFixed(4)} |`),
  '',
  '## Top 10 regressões (Δ Brier > 0, n ≥ 1000)',
  '',
  '| Liga | Family | Period | Direction | n | Brier raw | Brier cal | Δ Brier |',
  '|------|--------|--------|-----------|---|-----------|-----------|---------|',
  ...gainRows.filter(r => r.n >= 1000 && r.delta_brier > 0).slice(-10).reverse()
    .map(r => `| ${r.liga} | ${r.family} | ${r.period} | ${r.direction} | ${r.n} | ${r.brier_raw.toFixed(4)} | ${r.brier_cal.toFixed(4)} | +${r.delta_brier.toFixed(4)} |`),
  '',
];
fs.writeFileSync(path.join(OUT_DIR, 'calibration_gain.md'), md.join('\n'));
console.log(`  → calibration_gain.md`);

db.close();
console.log(`\n[metrics-cal] artefatos em ${OUT_DIR}`);
