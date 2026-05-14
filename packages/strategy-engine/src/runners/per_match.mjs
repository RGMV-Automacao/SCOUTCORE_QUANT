/**
 * @scoutcore/strategy-engine — runners/per_match.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Runner: seleciona os melhores N legs por confronto, sem sobreposição.
 * Estratégias: duplas (legs=2).
 *
 * Params:
 *   legs                     Número de legs por combo (default 2)
 *   odd_combo_range          [min, max] da odd combinada
 *   odd_leg_range            [min, max] da odd individual
 *   edge_min_pct             Edge mínimo por leg
 *   require_different_families  Se true, legs devem ter famílias distintas
 *   rank_by                  'ev_sum_pct' | 'prob_geo' | 'edge_sum'
 *   top_n                    Máximo de combos retornados (total)
 */

import { checkContradiction } from '../lib/contradiction.mjs';

function evReal(s) {
  const prob = s.fair_prob ?? 0;
  const odd = s.market_odd ?? 0;
  return prob > 0 && odd > 0 ? odd * prob - 1 : 0;
}

function comboRankValue(legs, rankBy) {
  switch (rankBy) {
    case 'ev_sum_pct': {
      let sum = 0;
      for (const l of legs) sum += (l.edge_pct ?? 0);
      return sum;
    }
    case 'prob_geo': {
      let prod = 1;
      for (const l of legs) prod *= (l.fair_prob ?? 0.5);
      return prod;
    }
    case 'edge_sum': {
      let sum = 0;
      for (const l of legs) sum += (l.edge_pct ?? 0);
      return sum;
    }
    default: {
      let sum = 0;
      for (const l of legs) sum += (l.edge_pct ?? 0);
      return sum;
    }
  }
}

/**
 * Gera todas as combinações de K elementos de um array.
 * @param {any[]} arr
 * @param {number} k
 * @returns {any[][]}
 */
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

/**
 * @param {object[]} slots
 * @param {object} params
 * @returns {{ picks: object[], meta: object }}
 */
export function run(slots, params = {}) {
  const nLegs     = params.legs ?? 2;
  const oddRange  = params.odd_combo_range ?? [1.50, 10.0];
  const legRange  = params.odd_leg_range ?? [1.10, 3.00];
  const minEdge   = params.edge_min_pct ?? 0;
  const diffFam   = params.require_different_families ?? false;
  const rankBy    = params.rank_by ?? 'ev_sum_pct';
  const topN      = params.top_n ?? 20;

  // 1. Filtrar legs elegíveis
  const eligible = slots.filter((s) => {
    if (!s.certified) return false;
    if (s.market_odd == null || s.market_odd <= 1) return false;
    if ((s.edge_pct ?? 0) < minEdge) return false;
    if (s.market_odd < legRange[0] || s.market_odd > legRange[1]) return false;
    return true;
  });

  // 2. Agrupar por match_id
  const byMatch = new Map();
  for (const s of eligible) {
    const key = s.match_id ?? s.opta_match_id ?? 'unknown';
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key).push(s);
  }

  // 3. Para cada match, gerar combos de nLegs e filtrar
  const combos = [];
  for (const [matchId, matchSlots] of byMatch) {
    if (matchSlots.length < nLegs) continue;

    // Cap para evitar explosão combinatória (C(20,2)=190, ok; C(50,4)=230k, cap)
    const capped = matchSlots.slice(0, 18);
    const combs = combinations(capped, nLegs);

    for (const legs of combs) {
      // Check contradições pair-wise
      let hasConflict = false;
      for (let i = 0; i < legs.length && !hasConflict; i++) {
        for (let j = i + 1; j < legs.length && !hasConflict; j++) {
          if (checkContradiction(legs[i], legs[j]).conflict) hasConflict = true;
        }
      }
      if (hasConflict) continue;

      // Check famílias distintas
      if (diffFam) {
        const fams = new Set(legs.map((l) => l.family));
        if (fams.size < legs.length) continue;
      }

      // Odd combinada
      let comboOdd = 1;
      for (const l of legs) comboOdd *= l.market_odd;
      if (comboOdd < oddRange[0] || comboOdd > oddRange[1]) continue;

      // Probabilidade conjunta
      let jointProb = 1;
      for (const l of legs) jointProb *= (l.fair_prob ?? 0.5);

      const evSum = legs.reduce((s, l) => s + (l.edge_pct ?? 0), 0);
      const rank = comboRankValue(legs, rankBy);

      combos.push({
        match_id: matchId,
        home: legs[0].home,
        away: legs[0].away,
        liga: legs[0].liga,
        date: legs[0].date,
        n_legs: legs.length,
        combo_odd: +comboOdd.toFixed(3),
        joint_prob: +jointProb.toFixed(4),
        ev_sum_pct: +evSum.toFixed(2),
        rank_value: +rank.toFixed(4),
        legs: legs.map((l) => ({
          market_key: l.market_key,
          family: l.family,
          direction: l.direction,
          line: l.line,
          fair_prob: l.fair_prob,
          market_odd: l.market_odd,
          edge_pct: l.edge_pct,
          ev_real: +evReal(l).toFixed(4),
        })),
      });
    }
  }

  // 4. Ranquear e truncar
  combos.sort((a, b) => b.rank_value - a.rank_value);
  const picks = combos.slice(0, topN);

  return {
    picks,
    meta: {
      total_input: slots.length,
      eligible_legs: eligible.length,
      matches_with_combos: byMatch.size,
      combos_generated: combos.length,
      top_n: topN,
    },
  };
}
