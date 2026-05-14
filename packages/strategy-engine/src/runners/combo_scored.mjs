/**
 * @scoutcore/strategy-engine — runners/combo_scored.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Runner: combo engine com penalidades de correlação BB (BomRetiro-style).
 * Estratégias: trincas.
 *
 * Diferença do per_match: aqui a odd combinada é AJUSTADA pela correlação
 * do Bet Builder (fator 0.73 a 0.97 por par), e o score é composto
 * (prob_geo × ev_sum × log_odd × diversity).
 *
 * Portado de opta-extractor/src/motor/config/bomretiro.json (combo section).
 */

import { checkContradiction } from '../lib/contradiction.mjs';
import { comboCorrelationFactor, DEFAULT_CORRELATION_PENALTIES } from '../lib/correlation.mjs';

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result = [];
  function recurse(start, combo) {
    if (combo.length === k) { result.push([...combo]); return; }
    for (let i = start; i <= arr.length - (k - combo.length); i++) {
      combo.push(arr[i]);
      recurse(i + 1, combo);
      combo.pop();
    }
  }
  recurse(0, []);
  return result;
}

function scoreCombo(legs, weights) {
  const w = {
    w_prob_geo: 1.5,
    w_ev_sum: 0.80,
    w_log_odd: 0.10,
    w_tier: 0.0,
    w_diversity: 1.0,
    ...weights,
  };

  // Probabilidade geométrica
  let probGeo = 1;
  for (const l of legs) probGeo *= (l.fair_prob ?? 0.5);
  probGeo = Math.pow(probGeo, 1 / legs.length);  // média geométrica

  // EV sum
  let evSum = 0;
  for (const l of legs) evSum += (l.edge_pct ?? 0);
  evSum /= 100;  // normalizar para [0, 1+]

  // Log da odd combinada (raw, sem correlação)
  let rawOdd = 1;
  for (const l of legs) rawOdd *= (l.market_odd ?? 1);
  const logOdd = Math.log(rawOdd);

  // Diversidade (famílias distintas / total legs)
  const families = new Set(legs.map((l) => l.family));
  const diversity = families.size / legs.length;

  return (
    w.w_prob_geo * probGeo +
    w.w_ev_sum * evSum +
    w.w_log_odd * logOdd +
    w.w_diversity * diversity
  );
}

/**
 * @param {object[]} slots
 * @param {object} params
 * @returns {{ picks: object[], meta: object }}
 */
export function run(slots, params = {}) {
  const minLegs    = params.min_legs ?? 2;
  const maxLegs    = params.max_legs ?? 4;
  const oddRange   = params.odd_combo_range ?? [2.0, 3.5];
  const oddMinByN  = params.odd_combo_min_by_legs ?? {};
  const legRange   = params.odd_leg_range ?? [1.20, 2.50];
  const minEdge    = params.edge_min_pct ?? 0;
  const minProb    = params.prob_min_leg ?? 0;
  const maxPerFam  = params.max_legs_per_family ?? 2;
  const penalties  = { ...DEFAULT_CORRELATION_PENALTIES, ...(params.correlation_penalties ?? {}) };
  const weights    = params.score_weights ?? {};
  const rankBy     = params.rank_by ?? 'score';
  const topN       = params.top_n ?? 15;

  // 1. Filtrar
  const eligible = slots.filter((s) => {
    if (!s.certified) return false;
    if (s.market_odd == null || s.market_odd <= 1) return false;
    if ((s.edge_pct ?? 0) < minEdge) return false;
    if ((s.fair_prob ?? 0) < minProb) return false;
    if (s.market_odd < legRange[0] || s.market_odd > legRange[1]) return false;
    return true;
  });

  // 2. Agrupar por match
  const byMatch = new Map();
  for (const s of eligible) {
    const key = s.match_id ?? s.opta_match_id ?? 'unknown';
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key).push(s);
  }

  // 3. Para cada match, gerar combos de minLegs..maxLegs
  const allCombos = [];
  for (const [matchId, matchSlots] of byMatch) {
    const capped = matchSlots.slice(0, 18);

    for (let n = minLegs; n <= maxLegs; n++) {
      if (capped.length < n) continue;
      const combs = combinations(capped, n);

      for (const legs of combs) {
        // Contradições
        let hasConflict = false;
        for (let i = 0; i < legs.length && !hasConflict; i++) {
          for (let j = i + 1; j < legs.length && !hasConflict; j++) {
            if (checkContradiction(legs[i], legs[j]).conflict) hasConflict = true;
          }
        }
        if (hasConflict) continue;

        // Max per family
        const famCounts = new Map();
        for (const l of legs) {
          famCounts.set(l.family, (famCounts.get(l.family) || 0) + 1);
        }
        if ([...famCounts.values()].some((c) => c > maxPerFam)) continue;

        // Odd combinada RAW
        let rawOdd = 1;
        for (const l of legs) rawOdd *= l.market_odd;

        // Fator de correlação BB
        const corrFactor = comboCorrelationFactor(legs, penalties);
        const adjustedOdd = rawOdd * corrFactor;

        // Odd mínima por número de legs
        const oddMin = oddMinByN[String(n)] ?? oddRange[0];
        if (adjustedOdd < oddMin || adjustedOdd > oddRange[1]) continue;

        // Probabilidade conjunta
        let jointProb = 1;
        for (const l of legs) jointProb *= (l.fair_prob ?? 0.5);

        const evSum = legs.reduce((s, l) => s + (l.edge_pct ?? 0), 0);
        const score = scoreCombo(legs, weights);

        allCombos.push({
          match_id: matchId,
          home: legs[0].home,
          away: legs[0].away,
          liga: legs[0].liga,
          date: legs[0].date,
          n_legs: legs.length,
          combo_odd_raw: +rawOdd.toFixed(3),
          correlation_factor: +corrFactor.toFixed(4),
          combo_odd_adjusted: +adjustedOdd.toFixed(3),
          joint_prob: +jointProb.toFixed(4),
          ev_sum_pct: +evSum.toFixed(2),
          score: +score.toFixed(4),
          families: [...famCounts.keys()],
          legs: legs.map((l) => ({
            market_key: l.market_key,
            family: l.family,
            scope: l.scope,
            period: l.period,
            direction: l.direction,
            line: l.line,
            fair_prob: l.fair_prob,
            market_odd: l.market_odd,
            edge_pct: l.edge_pct,
          })),
        });
      }
    }
  }

  // 4. Ranquear
  allCombos.sort((a, b) => b.score - a.score);
  const picks = allCombos.slice(0, topN);

  return {
    picks,
    meta: {
      total_input: slots.length,
      eligible_legs: eligible.length,
      matches: byMatch.size,
      combos_generated: allCombos.length,
      correlation_penalties: penalties,
    },
  };
}
