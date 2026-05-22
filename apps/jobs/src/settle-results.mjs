// apps/jobs/src/settle-results.mjs
//
// Settler do Motor 4x4. Resolve `prediction` sem result contra dados reais
// em `partidas` + `times` (modo='FT' e 'HT') + `jogadores` (desarmes),
// e atualiza `calib_state` via EWMA.
//
// Schema:
//   - partidas: home_goals/away_goals/home_goals_ht/away_goals_ht/id_confronto
//   - times: (id_confronto, time, modo IN ('FT','HT')) com escanteios/chutes/
//            chutes_no_alvo/faltas/cartoes_*/impedimentos/defesas/gols
//            (2T derivado como FT − HT)
//   - jogadores: (id_confronto, time, modo='FT') agregado de desarmes via SUM
//
// `eventos_faixa` foi descontinuada como fonte de leitura (Fase 4 do refactor
// Superbet v2.0.0). Ainda pode existir em DBs legados — não consultamos.
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
import { Database } from '@scoutcore/data-access';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  loadCalibrationMap, saveCalibrationBatch, updateEwma,
} from '@scoutcore/calibration';

const FAMILY_FIELD = {
  escanteios:   'escanteios',
  cartoes:      'cartoes_amarelos',
  chutes:       'chutes',           // total shots
  finalizacoes: 'chutes',
  chutes_alvo:  'chutes_no_alvo',
  faltas:       'faltas',
  impedimentos: 'impedimentos',
  defesas:      'defesas',
  desarmes:     'desarmes',         // statsline totalTackle por equipe (FT/HT)
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
//
// IMPORTANTE — guarda anti-phantom-settle:
// `processado = 1` é o flag canônico do legado (set por `extractor.js` apenas
// após batch completo de `eventos_faixa`). Filtrar só por `home_goals IS NOT NULL`
// não é suficiente porque jogos em status='Playing' já têm placar parcial mas
// não terminaram — e jogos em 'Fixture' podem ter tido placar transitório
// preenchido por engano em algum momento. Mesmo padrão usado em:
//   - SqliteMatchRepository.mjs (getMatchesForTeam)
//   - apps/jobs/src/rebuild-team-profiles.mjs
//   - apps/jobs/src/rebuild-league-priors.mjs
//   - scripts/rebuild-all-leagues.mjs
function loadMatchStats(db, match_id) {
  const id_confronto = extractIdConfronto(match_id);
  const partida = db.prepare(`
    SELECT home_team, away_team, home_goals, away_goals, home_goals_ht, away_goals_ht,
           liga, temporada, id_confronto
    FROM partidas
    WHERE id_confronto = ?
      AND processado = 1
      AND home_goals IS NOT NULL
    LIMIT 1
  `).get(id_confronto);
  if (!partida) return null;

  const empty = () => ({
    escanteios: 0, chutes: 0, chutes_no_alvo: 0, faltas: 0,
    cartoes_amarelos: 0, cartoes_vermelhos: 0, gols: 0,
    impedimentos: 0, defesas: 0, desarmes: 0,
  });
  const aggByTimePeriod = new Map();
  for (const team of [partida.home_team, partida.away_team]) {
    aggByTimePeriod.set(team, { FT: empty(), HT: empty(), '2T': empty() });
  }

  // Fonte primária: `times` com modo IN ('FT','HT'). 2T derivado por diferença.
  const teamRows = db.prepare(`
    SELECT time, modo, gols, escanteios, chutes, chutes_no_alvo, faltas,
           cartoes_amarelos, cartoes_vermelhos, impedimentos, defesas, desarmes
      FROM times
     WHERE id_confronto = ?
       AND modo IN ('FT','HT')
  `).all(id_confronto);
  const FIELDS = ['gols', 'escanteios', 'chutes', 'chutes_no_alvo', 'faltas',
                  'cartoes_amarelos', 'cartoes_vermelhos', 'impedimentos', 'defesas', 'desarmes'];
  for (const r of teamRows) {
    const slot = aggByTimePeriod.get(r.time);
    if (!slot) continue;
    const target = r.modo === 'HT' ? slot.HT : slot.FT;
    for (const f of FIELDS) target[f] = r[f] ?? 0;
  }
  // Deriva 2T = FT − HT (não-negativo).
  for (const [, slot] of aggByTimePeriod) {
    for (const f of FIELDS) {
      slot['2T'][f] = Math.max(0, (slot.FT[f] ?? 0) - (slot.HT[f] ?? 0));
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
  const { partida, byTime } = stats;
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
  // Family-specific handlers (precisam vir antes do bloco genérico 1x2,
  // porque direções como 'home'/'away' aparecem em escanteios_race também).
  if (pred.family === 'escanteios_race') {
    if (pred.line == null) return null;
    const homeAgg = byTime.get(partida.home_team)?.FT;
    const awayAgg = byTime.get(partida.away_team)?.FT;
    if (!homeAgg || !awayAgg) return null;
    const hc = homeAgg.escanteios ?? 0;
    const ac = awayAgg.escanteios ?? 0;
    const homeHit = hc >= pred.line;
    const awayHit = ac >= pred.line;
    if (dir === 'none') return (!homeHit && !awayHit) ? 'green' : 'red';
    if (dir === 'home') {
      if (homeHit && !awayHit) return 'green';
      if (!homeHit) return 'red';
      return null; // ambos atingiram → ordem temporal não disponível
    }
    if (dir === 'away') {
      if (awayHit && !homeHit) return 'green';
      if (!awayHit) return 'red';
      return null;
    }
    return null;
  }
  if (['escanteios_1x2', 'cartoes_1x2', 'chutes_1x2', 'chutes_alvo_1x2'].includes(pred.family)) {
    const baseFamily = pred.family.replace(/_1x2$/, '');
    const h = getActualValue(stats, { family: baseFamily, scope: 'home', period: pred.period || 'FT' });
    const a = getActualValue(stats, { family: baseFamily, scope: 'away', period: pred.period || 'FT' });
    if (h == null || a == null) return null;
    const actual = h > a ? 'home' : h < a ? 'away' : 'draw';
    return dir === actual ? 'green' : 'red';
  }
  if (pred.family === 'dupla') {
    const period = String(pred.period || 'FT').toUpperCase();
    let hg, ag;
    if (period === 'HT' || period === '1T') {
      hg = partida.home_goals_ht ?? 0; ag = partida.away_goals_ht ?? 0;
    } else if (period === '2T') {
      hg = (partida.home_goals ?? 0) - (partida.home_goals_ht ?? 0);
      ag = (partida.away_goals ?? 0) - (partida.away_goals_ht ?? 0);
    } else {
      hg = home_goals ?? 0; ag = away_goals ?? 0;
    }
    const actual = hg > ag ? 'home' : hg < ag ? 'away' : 'draw';
    const accept = { '1x': ['home', 'draw'], '12': ['home', 'away'], 'x2': ['draw', 'away'] }[dir];
    if (!accept) return null;
    return accept.includes(actual) ? 'green' : 'red';
  }
  if (pred.family === 'htft') {
    const m = /^([12x])_([12x])$/.exec(dir);
    if (!m) return null;
    const [, a, b] = m;
    const hgHT = partida.home_goals_ht ?? 0;
    const agHT = partida.away_goals_ht ?? 0;
    const htRes = hgHT > agHT ? '1' : hgHT < agHT ? '2' : 'x';
    const hgFT = home_goals ?? 0;
    const agFT = away_goals ?? 0;
    const ftRes = hgFT > agFT ? '1' : hgFT < agFT ? '2' : 'x';
    return (a === htRes && b === ftRes) ? 'green' : 'red';
  }
  if (pred.family === 'asian_handicap') {
    if (pred.line == null || home_goals == null || away_goals == null) return null;
    const mDir = /^(home|away)_(plus|minus)_/.exec(dir);
    if (!mDir) return null;
    const side = mDir[1];
    const own = side === 'home' ? home_goals : away_goals;
    const opp = side === 'home' ? away_goals : home_goals;
    const adjusted = own + pred.line - opp;
    if (adjusted > 0) return 'green';
    if (adjusted < 0) return 'red';
    return 'void'; // push em linha inteira: resolvido sem green/red
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

// ── Valor real apurado (para exibição lado-a-lado "predito X · real Y") ─────
// Retorna número quando o mercado é numérico (over/under, race, defesas);
// retorna null para mercados de label puros (btts, 1x2, dupla, htft, AH).
function computeActualValue(pred, stats) {
  const dir = String(pred.direction || '').toLowerCase();
  const { partida, byTime } = stats;

  if (dir === 'over' || dir === 'under') {
    const v = getActualValue(stats, pred);
    return Number.isFinite(v) ? v : null;
  }
  if (pred.family === 'gols') {
    const v = getActualValue(stats, pred);
    return Number.isFinite(v) ? v : null;
  }
  if (pred.family === 'escanteios_race') {
    const homeAgg = byTime.get(partida.home_team)?.FT;
    const awayAgg = byTime.get(partida.away_team)?.FT;
    if (!homeAgg || !awayAgg) return null;
    const hc = homeAgg.escanteios ?? 0;
    const ac = awayAgg.escanteios ?? 0;
    if (dir === 'home') return hc;
    if (dir === 'away') return ac;
    if (dir === 'none') return Math.max(hc, ac);
    return null;
  }
  // Para gols/1x2/btts/dupla/htft/ah o "valor real" útil é o placar.
  // Codificamos como home_goals * 100 + away_goals? Não — mantemos null
  // (UI cai para badge GREEN/RED puro).
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
    `UPDATE prediction SET result = ?, actual_value = ?, settled_at = datetime('now') WHERE run_id = ? AND match_id = ? AND market_key = ?`
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

  let settled = 0, skipped = 0, no_data = 0, voided = 0, clv_inserted = 0, clv_with_close = 0, clv_invalid_close = 0;
  for (const p of preds) {
    const stats = getStats(p.match_id);
    if (!stats) { no_data++; continue; }
    const out = evalSlot(p, stats);
    if (out == null) { skipped++; continue; }
    const actual = computeActualValue(p, stats);
    if (!dryRun) update.run(out, actual, p.run_id, p.match_id, p.market_key);
    settled++;

    if (out === 'void') {
      voided++;
      continue;
    }

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

  return { total: preds.length, settled, skipped, no_data, voided, calib_updated, clv_inserted, clv_with_close, clv_invalid_close };
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
  const dbPath = process.env.SCOUT_DB || resolve(process.cwd(), 'data', 'scout_extraction.db');
  const db = new Database(dbPath);
  const r = settle(db, args);
  console.log('[settler]', JSON.stringify(r, null, 2));
  db.close();
}
