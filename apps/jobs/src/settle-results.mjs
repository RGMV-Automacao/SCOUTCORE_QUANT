// apps/jobs/src/settle-results.mjs
//
// Settler do Motor 4x4. Resolve `prediction` sem result contra dados reais
// em `partidas` + `eventos_faixa`, e atualiza `calib_state` via EWMA.
//
// Adaptado do legacy `settler.js` para o schema do scout.db:
//   - partidas: home_goals/away_goals/home_goals_ht/away_goals_ht/id_confronto
//   - eventos_faixa: (id_confronto, time, faixa) com escanteios/chutes/cartoes/faltas
//
// match_id namespaced ex: "statsline:df1jmu4xb3o1zeagblve54vmc" → id_confronto = sufixo.
//
// USO:
//   node apps/jobs/src/settle-results.mjs --date=2025-11-30
//   node apps/jobs/src/settle-results.mjs --liga=brasileirao --date=2025-11-30
//   node apps/jobs/src/settle-results.mjs --run-id=<uuid>
//   node apps/jobs/src/settle-results.mjs --run-id=<uuid> --closing-odds=closing.json
//   node apps/jobs/src/settle-results.mjs --dry-run

import 'dotenv/config';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  loadCalibrationMap, saveCalibrationBatch, updateEwma,
} from '@scoutcore/calibration';

const HT_BANDS = ['0-10', '11-20', '21-30', '31-45'];
const TT_BANDS = ['46-55', '56-65', '66-75', '76-90'];

const FAMILY_FIELD = {
  escanteios:   'escanteios',
  cartoes:      'cartoes_amarelos',
  chutes:       'chutes',           // total shots
  finalizacoes: 'chutes',
  faltas:       'faltas',
  impedimentos: 'impedimentos',
};

// ── Match identity helpers ───────────────────────────────────────────────────
function extractIdConfronto(match_id) {
  if (!match_id) return null;
  // formato canônico: "statsline:<id>"
  const idx = match_id.indexOf(':');
  return idx >= 0 ? match_id.slice(idx + 1) : match_id;
}

// ── loadMatchStats ───────────────────────────────────────────────────────────
// Retorna { partida, byTime: Map<time, { FT, HT, '2T' }> } com agregados.
function loadMatchStats(db, match_id) {
  const id_confronto = extractIdConfronto(match_id);
  const partida = db.prepare(`
    SELECT home_team, away_team, home_goals, away_goals, home_goals_ht, away_goals_ht,
           liga, temporada, id_confronto
    FROM partidas
    WHERE id_confronto = ? AND home_goals IS NOT NULL
    LIMIT 1
  `).get(id_confronto);
  if (!partida) return null;

  const events = db.prepare(`
    SELECT time, faixa, escanteios, chutes, chutes_no_alvo, faltas,
           cartoes_amarelos, cartoes_vermelhos, gols, impedimentos
    FROM eventos_faixa
    WHERE id_confronto = ?
  `).all(id_confronto);

  const empty = () => ({ escanteios:0, chutes:0, chutes_no_alvo:0, faltas:0,
                         cartoes_amarelos:0, cartoes_vermelhos:0, gols:0, impedimentos:0 });
  const aggByTimePeriod = new Map();
  for (const team of [partida.home_team, partida.away_team]) {
    aggByTimePeriod.set(team, { FT: empty(), HT: empty(), '2T': empty() });
  }
  for (const ev of events) {
    const slot = aggByTimePeriod.get(ev.time);
    if (!slot) continue; // evento de time não-pareado (defensivo)
    const isHT = HT_BANDS.includes(ev.faixa);
    const is2T = TT_BANDS.includes(ev.faixa);
    for (const [k] of Object.entries(empty())) {
      slot.FT[k] += ev[k] ?? 0;
      if (isHT) slot.HT[k] += ev[k] ?? 0;
      if (is2T) slot['2T'][k] += ev[k] ?? 0;
    }
  }
  return { partida, byTime: aggByTimePeriod };
}

// ── Resolve valor real ──────────────────────────────────────────────────────
function getActualValue(stats, { family, scope, period }) {
  const { partida, byTime } = stats;
  const p = String(period || 'FT').toUpperCase();
  const isHT = p === 'HT' || p === '1T';
  const is2T = p === '2T';
  const periodKey = isHT ? 'HT' : is2T ? '2T' : 'FT';

  const s = String(scope || 'total').toLowerCase();
  const isHome = s === 'home' || s === 'casa' || s === 'mandante';
  const isAway = s === 'away' || s === 'fora' || s === 'visitante';

  if (family === 'gols') {
    if (isHT) {
      if (isHome) return partida.home_goals_ht;
      if (isAway) return partida.away_goals_ht;
      return (partida.home_goals_ht ?? 0) + (partida.away_goals_ht ?? 0);
    }
    if (is2T) {
      const h2 = (partida.home_goals ?? 0) - (partida.home_goals_ht ?? 0);
      const a2 = (partida.away_goals ?? 0) - (partida.away_goals_ht ?? 0);
      if (isHome) return h2;
      if (isAway) return a2;
      return h2 + a2;
    }
    if (isHome) return partida.home_goals;
    if (isAway) return partida.away_goals;
    return (partida.home_goals ?? 0) + (partida.away_goals ?? 0);
  }

  const field = FAMILY_FIELD[family];
  if (!field) return null;

  const homeAgg = byTime.get(partida.home_team)?.[periodKey];
  const awayAgg = byTime.get(partida.away_team)?.[periodKey];
  if (!homeAgg || !awayAgg) return null;

  if (isHome) return homeAgg[field];
  if (isAway) return awayAgg[field];
  return (homeAgg[field] ?? 0) + (awayAgg[field] ?? 0);
}

// ── Avalia resultado de um slot ──────────────────────────────────────────────
function extractLabel(market_key) {
  if (!market_key) return null;
  const cut = market_key.split('#')[0]; // remove sufixos
  const parts = cut.split('_');
  return parts[parts.length - 1]?.toLowerCase() ?? null;
}

function evalSlot(pred, stats) {
  const dir = String(pred.direction || '').toLowerCase();
  const { partida } = stats;
  const { home_goals, away_goals } = partida;

  if (dir === 'over') {
    const v = getActualValue(stats, pred);
    if (v == null || pred.line == null) return null;
    return v > pred.line ? 'green' : 'red';
  }
  if (dir === 'under') {
    const v = getActualValue(stats, pred);
    if (v == null || pred.line == null) return null;
    return v < pred.line ? 'green' : 'red';
  }
  // Label markets — direction direto: 'sim'/'nao' (btts), 'home'/'draw'/'away' (1x2).
  // Settler aceita também 'label' (legacy compat) e usa extractLabel(market_key).
  if (pred.family === 'btts' || dir === 'sim' || dir === 'nao') {
    const label = (dir === 'label') ? extractLabel(pred.market_key) : dir;
    const isHT = String(pred.period || 'FT').toUpperCase() === 'HT';
    const hg = isHT ? (partida.home_goals_ht ?? 0) : (home_goals ?? 0);
    const ag = isHT ? (partida.away_goals_ht ?? 0) : (away_goals ?? 0);
    const btts = hg > 0 && ag > 0;
    if (label === 'sim') return btts ? 'green' : 'red';
    if (label === 'nao') return !btts ? 'green' : 'red';
    return null;
  }
  if (pred.family === '1x2' || pred.family === 'resultado'
      || dir === 'home' || dir === 'draw' || dir === 'away') {
    const label = (dir === 'label') ? extractLabel(pred.market_key) : dir;
    const isHT = String(pred.period || 'FT').toUpperCase() === 'HT';
    const hg = isHT ? (partida.home_goals_ht ?? 0) : (home_goals ?? 0);
    const ag = isHT ? (partida.away_goals_ht ?? 0) : (away_goals ?? 0);
    const actual = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
    const norm = label === '1' ? 'home' : label === '2' ? 'away' : label === 'x' ? 'draw' : label;
    return norm === actual ? 'green' : 'red';
  }
  if (dir === 'handicap') {
    if (pred.line == null) return null;
    const s = String(pred.scope || '').toLowerCase();
    if (s === 'home') return ((home_goals ?? 0) + pred.line) > (away_goals ?? 0) ? 'green' : 'red';
    if (s === 'away') return ((away_goals ?? 0) + pred.line) > (home_goals ?? 0) ? 'green' : 'red';
    return null;
  }
  return null;
}

// ── Settle pipeline ──────────────────────────────────────────────────────────
// Brier score de uma única observação binária.
function brierOne(prob, isGreen) {
  if (prob == null || !Number.isFinite(prob)) return null;
  const y = isGreen ? 1 : 0;
  return (prob - y) ** 2;
}

// EWMA do brier.
function ewmaBrier(old, obs, alpha = 0.15) {
  if (obs == null) return old ?? null;
  if (old == null) return obs;
  return alpha * obs + (1 - alpha) * old;
}

function coerceOdd(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) return value;
  if (value && typeof value === 'object') {
    return coerceOdd(value.odd_close ?? value.closing_odd ?? value.close ?? value.odd);
  }
  return null;
}

function getClosingOdd(closingOdds, prediction) {
  if (!closingOdds || typeof closingOdds !== 'object') return null;
  return coerceOdd(
    closingOdds[prediction.market_key]
      ?? closingOdds[prediction.run_id]?.[prediction.market_key]
      ?? closingOdds[prediction.match_id]?.[prediction.market_key],
  );
}

function calcClvPct(oddOpen, oddClose) {
  if (!oddOpen || !oddClose) return null;
  if (!Number.isFinite(oddOpen) || !Number.isFinite(oddClose)) return null;
  if (oddOpen <= 1 || oddClose <= 1) return null;
  return +((oddOpen / oddClose - 1) * 100).toFixed(4);
}

function isClosingOddSane(oddOpen, oddClose) {
  if (!oddOpen || !oddClose) return false;
  if (!Number.isFinite(oddOpen) || !Number.isFinite(oddClose)) return false;
  if (oddOpen <= 1 || oddClose <= 1) return false;
  return oddClose >= oddOpen * 0.5 && oddClose <= oddOpen * 2;
}

function readClosingOdds(path) {
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

export function settle(db, { run_id, date, liga, dryRun = false, ewmaAlpha = 0.15, closingOdds = null } = {}) {
  let q = `SELECT * FROM prediction WHERE result IS NULL`;
  const params = [];
  if (run_id) { q += ' AND run_id = ?'; params.push(run_id); }
  else if (date) {
    q += ' AND match_date = ?'; params.push(date);
    if (liga) { q += ' AND liga = ?'; params.push(liga); }
  }
  const preds = db.prepare(q).all(...params);
  if (preds.length === 0) {
    return { settled: 0, skipped: 0, no_data: 0, calib_updated: 0, total: 0 };
  }

  const statsCache = new Map();
  const getStats = (mid) => {
    if (!statsCache.has(mid)) statsCache.set(mid, loadMatchStats(db, mid));
    return statsCache.get(mid);
  };

  const update = dryRun ? null : db.prepare(
    `UPDATE prediction SET result = ?, settled_at = datetime('now') WHERE run_id = ? AND market_key = ?`
  );

  const insertClv = dryRun ? null : db.prepare(`
    INSERT INTO clv_history
      (run_id, match_id, market_key, family, liga,
       fair_prob_motor, fair_odd_motor, prob_a, prob_b,
       odd_open, odd_close, result,
       brier_a, brier_b, clv_pct, source, settled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const calibMap = loadCalibrationMap(db, 'A');
  const groups = new Map(); // key family::direction::liga → { n_total, n_green, sum_prob, sum_brier }

  let settled = 0, skipped = 0, no_data = 0, clv_inserted = 0, clv_with_close = 0, clv_invalid_close = 0;
  for (const p of preds) {
    const stats = getStats(p.match_id);
    if (!stats) { no_data++; continue; }
    const out = evalSlot(p, stats);
    if (out == null) { skipped++; continue; }
    if (!dryRun) update.run(out, p.run_id, p.market_key);
    settled++;

    const isGreen = out === 'green';
    const brier = brierOne(p.fair_prob, isGreen);

    const oddOpen  = p.market_odd ?? null;
    const rawOddClose = getClosingOdd(closingOdds, p);
    const oddClose = isClosingOddSane(oddOpen, rawOddClose) ? rawOddClose : null;
    if (rawOddClose != null && oddClose == null) clv_invalid_close++;
    const clvPct   = calcClvPct(oddOpen, oddClose);
    if (oddClose != null) clv_with_close++;

    if (!dryRun) {
      try {
        insertClv.run(
          p.run_id, p.match_id, p.market_key, p.family, p.liga,
          p.fair_prob ?? null,
          p.fair_prob ? +(1 / p.fair_prob).toFixed(4) : null,
          p.fair_prob ?? null, null,        // prob_a, prob_b (engine B not yet)
          oddOpen, oddClose, out,
          brier, null, clvPct, 'live',
        );
        clv_inserted++;
      } catch {
        // não interrompe settle por falha de clv_history
      }
    }

    const key = `${p.family}::${p.direction}::${p.liga}`;
    if (!groups.has(key)) groups.set(key, {
      family: p.family, direction: p.direction, liga: p.liga,
      n_total: 0, n_green: 0, sum_prob: 0, sum_brier: 0, n_brier: 0,
    });
    const g = groups.get(key);
    g.n_total++;
    g.n_green += isGreen ? 1 : 0;
    g.sum_prob += p.fair_prob ?? 0.5;
    if (brier != null) { g.sum_brier += brier; g.n_brier++; }
  }

  // Atualiza calib_state via EWMA
  let calib_updated = 0;
  if (!dryRun && groups.size > 0) {
    const updates = [];
    for (const g of groups.values()) {
      const actual_hr   = g.n_green / g.n_total;
      const expected_hr = g.sum_prob / g.n_total;
      const calib = calibMap.get(`${g.family}::${g.direction}::${g.liga}`) ?? null;
      const oldEwma = calib?.ewma_hr ?? null;
      const newEwma = updateEwma(oldEwma, actual_hr, ewmaAlpha);

      const ratio = expected_hr > 0 ? actual_hr / expected_hr : 1.0;
      const newConf = Math.max(0.40, Math.min(1.20, ratio));

      const dir = g.direction.toLowerCase();
      const isOver  = dir === 'over';
      const isUnder = dir === 'under';
      let lambdaMult = 1.0;
      if (isOver  && actual_hr > expected_hr + 0.08) lambdaMult = Math.min(1.60, 1 + (actual_hr - expected_hr) * 1.2);
      else if (isOver  && actual_hr < expected_hr - 0.08) lambdaMult = Math.max(0.65, 1 - (expected_hr - actual_hr) * 1.2);
      else if (isUnder && actual_hr < expected_hr - 0.08) lambdaMult = Math.min(1.60, 1 + (expected_hr - actual_hr) * 1.2);
      else if (isUnder && actual_hr > expected_hr + 0.08) lambdaMult = Math.max(0.65, 1 - (actual_hr - expected_hr) * 1.2);

      const prevN = calib?.sample_size ?? 0;
      const obsBrier = g.n_brier > 0 ? g.sum_brier / g.n_brier : null;
      const newEwmaBrier = ewmaBrier(calib?.ewma_brier ?? null, obsBrier, ewmaAlpha);
      updates.push({
        family: g.family, direction: g.direction, liga: g.liga,
        lambda_mult: +lambdaMult.toFixed(3),
        confidence_factor: +newConf.toFixed(3),
        line_shift: 0.0,
        ewma_hr: +newEwma.toFixed(4),
        ewma_brier: newEwmaBrier == null ? null : +newEwmaBrier.toFixed(6),
        sample_size: prevN + g.n_total,
      });
    }
    saveCalibrationBatch(db, updates, { engine: 'A' });
    calib_updated = updates.length;
  }

  return { total: preds.length, settled, skipped, no_data, calib_updated, clv_inserted, clv_with_close, clv_invalid_close };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--date=')) out.date = a.slice('--date='.length);
    else if (a.startsWith('--liga=')) out.liga = a.slice('--liga='.length);
    else if (a.startsWith('--run-id=')) out.run_id = a.slice('--run-id='.length);
    else if (a.startsWith('--closing-odds=')) out.closingOdds = readClosingOdds(a.slice('--closing-odds='.length));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const args = parseArgs(process.argv);
  const dbPath = process.env.SCOUT_DB || resolve(process.cwd(), 'data', 'scout.db');
  const db = new Database(dbPath);
  const r = settle(db, args);
  console.log('[settler]', JSON.stringify(r, null, 2));
  db.close();
}
