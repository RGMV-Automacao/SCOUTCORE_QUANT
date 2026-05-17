#!/usr/bin/env node
// scripts/backtest/validate-calibration.mjs
//
// Aplica os fits isotônicos (já persistidos por fit-isotonic.mjs) ao SLICE
// DE TESTE (data_partida >= cutoff) e mede:
//   - Brier raw vs Brier calibrado (Δ-Brier)
//   - mean(p) vs base-rate (gap de confiabilidade)
//   - cobertura: quantos % das predições têm fit aplicável
//
// Outputs:
//   audit/backtest/calibration_delta.csv       (linha por liga,family,period,direction)
//   audit/backtest/calibration_report.md       (sumário + top deltas)
//
// Reusa o MESMO cutoff que fit-isotonic.mjs (80º percentil temporal de partidas).

import Database from 'better-sqlite3';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadIsotonicMap, getIsotonic, predict } from '@scoutcore/isotonic';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'scout.db');
const OUT_DIR = path.resolve(__dirname, '..', '..', 'audit', 'backtest');
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const total = db.prepare(`SELECT COUNT(*) c FROM backtest_outcomes`).get().c;
const offset = Math.floor(total * 0.8);
const cutoffRow = db.prepare(
  `SELECT data_partida FROM backtest_outcomes ORDER BY data_partida ASC LIMIT 1 OFFSET ?`
).get(offset);
const CUTOFF = cutoffRow.data_partida;
console.log(`[validate] cutoff: ${CUTOFF} (testando partidas >= cutoff)`);

const isoMap = loadIsotonicMap(db);
console.log(`[validate] ${isoMap.size} curvas isotônicas carregadas`);

// Agregadores por (liga, family, period, direction)
const agg = new Map(); // key -> stats

console.log('[validate] streaming amostras de teste...');
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
    AND o.data_partida >= ?
`).iterate(CUTOFF);

let n = 0, applied = 0;
for (const r of rows) {
  if (r.p == null || r.y == null) continue;
  const key = `${r.liga}|${r.family}|${r.period}|${r.direction}`;
  let s = agg.get(key);
  if (!s) {
    s = {
      liga: r.liga, family: r.family, period: r.period, direction: r.direction,
      n: 0, sum_p_raw: 0, sum_p_cal: 0, sum_y: 0,
      sq_raw: 0, sq_cal: 0, has_fit: 0,
    };
    agg.set(key, s);
  }
  s.n++;
  s.sum_p_raw += r.p;
  s.sum_y += r.y;
  s.sq_raw += (r.p - r.y) ** 2;

  const iso = getIsotonic(isoMap, { family: r.family, period: r.period, direction: r.direction, liga: r.liga });
  let p2 = r.p;
  if (iso) {
    p2 = predict(iso.model, r.p);
    s.has_fit++;
    applied++;
  }
  s.sum_p_cal += p2;
  s.sq_cal += (p2 - r.y) ** 2;
  n++;
  if (n % 1_000_000 === 0) console.log(`  ${(n/1e6).toFixed(1)}M...`);
}
console.log(`[validate] ${n.toLocaleString()} amostras de teste; ${applied.toLocaleString()} (${((applied/n)*100).toFixed(1)}%) com fit aplicado`);

// CSV
const cols = ['liga','family','period','direction','n','coverage','mean_pred_raw','mean_pred_cal','base_rate','gap_raw','gap_cal','brier_raw','brier_cal','delta_brier','delta_brier_rel'];
const lines = [cols.join(',')];
const records = [];

for (const s of agg.values()) {
  if (s.n < 50) continue; // ruído
  const mp_raw = s.sum_p_raw / s.n;
  const mp_cal = s.sum_p_cal / s.n;
  const base   = s.sum_y     / s.n;
  const brier_raw = s.sq_raw / s.n;
  const brier_cal = s.sq_cal / s.n;
  const dB = brier_raw - brier_cal;
  const dBrel = brier_raw > 0 ? dB / brier_raw : 0;
  const rec = {
    liga: s.liga, family: s.family, period: s.period, direction: s.direction,
    n: s.n, coverage: s.has_fit / s.n,
    mean_pred_raw: mp_raw, mean_pred_cal: mp_cal, base_rate: base,
    gap_raw: mp_raw - base, gap_cal: mp_cal - base,
    brier_raw, brier_cal, delta_brier: dB, delta_brier_rel: dBrel,
  };
  records.push(rec);
  lines.push(cols.map(c => fmt(rec[c])).join(','));
}

const csvPath = path.join(OUT_DIR, 'calibration_delta.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`  CSV: ${csvPath}`);

// === Markdown report ===
// 1) Métricas agregadas em amostras COM fit aplicado (com pelo menos coverage>0)
const withFit = records.filter(r => r.coverage > 0);
const totalN_all   = sum(records, r => r.n);
const totalN_fit   = sum(withFit, r => r.n);
const wBrier = (rs, k) => sum(rs, r => r.n * r[k]) / Math.max(1, sum(rs, r => r.n));

const W_BR_ALL = wBrier(records, 'brier_raw');
const W_BC_ALL = wBrier(records, 'brier_cal');
const W_BR_FIT = wBrier(withFit, 'brier_raw');
const W_BC_FIT = wBrier(withFit, 'brier_cal');

// 2) Top deltas (maiores ganhos absolutos em Brier, com n>=500)
const candidates = records.filter(r => r.n >= 500 && r.coverage >= 0.5);
const topGain = [...candidates].sort((a,b) => b.delta_brier - a.delta_brier).slice(0, 15);
const topRegr = [...candidates].sort((a,b) => a.delta_brier - b.delta_brier).slice(0, 10);

// 3) Gap "alvo" pré e pós (linhas que tinham gap >5pp antes)
const gapPre = candidates.filter(r => Math.abs(r.gap_raw) >= 0.05);
const gapPos = gapPre.filter(r => Math.abs(r.gap_cal) >= 0.05);

const md = `# Calibration Report — Isotonic (walk-forward)

**Cutoff:** ${CUTOFF}
**Amostras de teste:** ${n.toLocaleString()}
**Cobertura de fit:** ${((applied/n)*100).toFixed(1)}%
**Curvas isotônicas persistidas:** ${isoMap.size}

## Brier ponderado (por n de amostras)

| Subconjunto | n | Brier raw | Brier calibrado | Δ-Brier abs | Δ-Brier rel |
|---|---:|---:|---:|---:|---:|
| Todas as amostras | ${totalN_all.toLocaleString()} | ${W_BR_ALL.toFixed(5)} | ${W_BC_ALL.toFixed(5)} | ${(W_BR_ALL-W_BC_ALL).toFixed(5)} | ${(((W_BR_ALL-W_BC_ALL)/W_BR_ALL)*100).toFixed(2)}% |
| Apenas com fit aplicável | ${totalN_fit.toLocaleString()} | ${W_BR_FIT.toFixed(5)} | ${W_BC_FIT.toFixed(5)} | ${(W_BR_FIT-W_BC_FIT).toFixed(5)} | ${(((W_BR_FIT-W_BC_FIT)/W_BR_FIT)*100).toFixed(2)}% |

## Reliability gap |mean(p) − base_rate|

- Buckets (n≥500, coverage≥0.5) com gap_raw ≥ 5pp: **${gapPre.length}**
- Desses, gap_cal ≥ 5pp pós-calibração: **${gapPos.length}** (corrigidos: ${gapPre.length - gapPos.length})

## Top-15 ganhos de Brier (n≥500)

| liga | family | period | direction | n | gap_raw → gap_cal | brier_raw → brier_cal | Δ |
|---|---|---|---|---:|---|---|---:|
${topGain.map(r => `| ${r.liga} | ${r.family} | ${r.period} | ${r.direction} | ${r.n} | ${pct(r.gap_raw)} → ${pct(r.gap_cal)} | ${r.brier_raw.toFixed(4)} → ${r.brier_cal.toFixed(4)} | ${r.delta_brier.toFixed(4)} |`).join('\n')}

## Top-10 regressões (calibração piora; investigar)

| liga | family | period | direction | n | gap_raw → gap_cal | brier_raw → brier_cal | Δ |
|---|---|---|---|---:|---|---|---:|
${topRegr.map(r => `| ${r.liga} | ${r.family} | ${r.period} | ${r.direction} | ${r.n} | ${pct(r.gap_raw)} → ${pct(r.gap_cal)} | ${r.brier_raw.toFixed(4)} → ${r.brier_cal.toFixed(4)} | ${r.delta_brier.toFixed(4)} |`).join('\n')}

## Notas

- Cutoff é o 80º percentil das datas de partida — split puramente temporal (sem vazamento).
- "Coverage" < 100% indica buckets sem fit (amostra de treino abaixo de \`--min-liga\`/\`--min-global\`).
- Δ-Brier > 0 ⇒ calibração melhorou. Δ-Brier < 0 ⇒ regrediu (revisar buckets de baixa amostra ou drift de mercado).
`;
const mdPath = path.join(OUT_DIR, 'calibration_report.md');
fs.writeFileSync(mdPath, md);
console.log(`  MD : ${mdPath}`);

db.close();

function sum(arr, f) { let s = 0; for (const x of arr) s += f(x); return s; }
function pct(x) { return ((x ?? 0) * 100).toFixed(1) + 'pp'; }
function fmt(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6);
  return String(v);
}
