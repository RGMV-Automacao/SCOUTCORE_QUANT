/**
 * @scoutcore/strategy-engine — combinator.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Port puro do combinator.js legado.
 * Extrai o melhor combo de 2-4 legs de um confronto, aplicando quality gates
 * e ranking heurístico.
 */

import { checkContradiction } from './contradiction.mjs';
import { getStrategyEngineGovernance } from '@scoutcore/quality-gates';
import { comboCorrelationFactor, DEFAULT_CORRELATION_PENALTIES } from './correlation.mjs';
import { normalizeFamily } from './family-aliases.mjs';

const STRATEGY_ENGINE_GOVERNANCE = getStrategyEngineGovernance();
const TRUSTED_FAMILIES = STRATEGY_ENGINE_GOVERNANCE.trusted_families;
const FAMILY_RELIABILITY = STRATEGY_ENGINE_GOVERNANCE.family_reliability;

function reliabilityOf(family) {
  return FAMILY_RELIABILITY[normalizeFamily(family)] ?? 0.50;
}

function directionGroup(slot) {
  return `${normalizeFamily(slot.family)}|${slot.scope}|${slot.period}|${slot.direction}`;
}

function resolveDiscount(legs, gates) {
  const minDiscountLegs = gates.builderDiscountMinLegs ?? 3;
  const baseDiscount = legs.length >= minDiscountLegs ? gates.builderDiscountBase : 1.0;
  const correlationFactor = comboCorrelationFactor(
    legs,
    gates.correlationPenalties ?? DEFAULT_CORRELATION_PENALTIES,
  );
  const effectiveDiscount = Math.min(baseDiscount, correlationFactor);

  return {
    baseDiscount: Number(baseDiscount.toFixed(4)),
    correlationFactor: Number(correlationFactor.toFixed(4)),
    effectiveDiscount: Number(effectiveDiscount.toFixed(4)),
  };
}

export function selectCandidates(slots, gates) {
  const useful = (slots ?? []).filter((s) => {
    if (!s) return false;
    if (s.certified !== true) return false;
    if (s.market_odd == null) return false;
    if (s.market_odd < gates.oddMinLeg || s.market_odd > gates.oddMaxLeg) return false;
    if (s.edge_pct == null || s.edge_pct < gates.edgeMinPp) return false;
    // Removido check rígido de fair_odd_curinga para usar fair_prob genérico
    if (s.fair_prob == null || s.fair_prob > 0.95) return false;
    if (gates.suspendedFamilies && gates.suspendedFamilies.has(s.family)) return false;
    if (gates.suspendedMarketKeys?.size && gates.suspendedMarketKeys.has(s.market_key)) return false;
    if (gates.suspendedMarketKeyPrefixes?.length) {
      const mk = s.market_key ?? '';
      if (gates.suspendedMarketKeyPrefixes.some((p) => mk.startsWith(p))) return false;
    }
    return true;
  });

  const groups = {};
  for (const s of useful) {
    const k = directionGroup(s);
    if (!groups[k]) groups[k] = [];
    groups[k].push(s);
  }

  const result = [];
  for (const arr of Object.values(groups)) {
    arr.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    result.push(...arr.slice(0, 5));
  }
  return result;
}

function* combinations(arr, k) {
  if (k > arr.length || k <= 0) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === arr.length - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

function scoreSubset(legs, gates) {
  const jointProb = legs.reduce((p, l) => p * (l.fair_prob ?? 0.5), 1);
  const probGeo = Math.pow(jointProb, 1 / legs.length);
  const odds = legs.map((l) => l.market_odd);
  const sbProduct = odds.reduce((p, o) => p * o, 1);
  const discount = resolveDiscount(legs, gates);
  const comboOddBruta = sbProduct;
  const comboOdd = Number((sbProduct * discount.effectiveDiscount).toFixed(3));

  const families = [...new Set(legs.map((l) => normalizeFamily(l.family)))];
  const trustedCount = legs.filter((l) => TRUSTED_FAMILIES.has(normalizeFamily(l.family))).length;
  const trustedRatio = trustedCount / legs.length;
  const avgReliability = legs.reduce((s, l) => s + reliabilityOf(l.family), 0) / legs.length;
  const comboEv = jointProb > 0 && comboOdd > 0 ? (jointProb * comboOdd) - 1 : -1;

  const qualityScore = Number(
    (trustedRatio * 2.0 + avgReliability + probGeo).toFixed(4),
  );
  const rankScore = Number((qualityScore + comboEv).toFixed(4));

  return {
    legs,
    n_legs: legs.length,
    n_families: families.length,
    families,
    combo_odd: comboOdd,
    combo_odd_bruta: Number(comboOddBruta.toFixed(3)),
    builder_discount: Number(discount.effectiveDiscount.toFixed(3)),
    builder_discount_base: Number(discount.baseDiscount.toFixed(3)),
    correlation_factor: Number(discount.correlationFactor.toFixed(3)),
    joint_prob: Number(jointProb.toFixed(6)),
    prob_geo: Number(probGeo.toFixed(6)),
    trusted_count: trustedCount,
    avg_reliability: Number(avgReliability.toFixed(3)),
    quality_score: qualityScore,
    combo_ev: Number(comboEv.toFixed(4)),
    rank_score: rankScore,
  };
}

function findBestSubset(pool, gates) {
  const Nmax = Math.min(gates.legsExceptionMax, pool.length);
  const Nnormal = gates.legsPerConfronto;
  const Nmin = Math.max(2, gates.legsMinPerConfronto);

  let best = null;
  let bestScore = -Infinity;

  for (let n = Nmin; n <= Nmax; n++) {
    const isException = n > Nnormal;
    const oddMaxForN = isException ? gates.oddCombinedMaxException : gates.oddCombinedMax;

    for (const subset of combinations(pool, n)) {
      let conflict = false;
      for (let i = 0; i < subset.length && !conflict; i++) {
        for (let j = i + 1; j < subset.length && !conflict; j++) {
          if (checkContradiction(subset[i], subset[j]).conflict) conflict = true;
        }
      }
      if (conflict) continue;

      const scored = scoreSubset(subset, gates);
      if (scored.n_families !== scored.n_legs) continue;
      if (scored.combo_odd < gates.oddCombinedMin) continue;
      if (scored.combo_odd > oddMaxForN) continue;
      if (scored.combo_ev < (gates.comboEvMin ?? -Infinity)) continue;

      if (scored.rank_score > bestScore) {
        bestScore = scored.rank_score;
        best = { ...scored, is_exception: isException, n_legs_target: n };
      }
    }
  }
  return best;
}

export function buildCombo(slots, gates) {
  const candidates = selectCandidates(slots, gates);
  const matchId = slots[0]?.match_id ?? slots[0]?.opta_match_id ?? null;

  if (candidates.length < 2) {
    return {
      match_id: matchId, status: 'no_combo',
      reason: candidates.length === 0 ? 'no_candidates' : 'less_than_2_candidates',
      legs: [], candidates_count: candidates.length,
    };
  }

  const byFamily = {};
  for (const c of candidates) {
    const family = normalizeFamily(c.family);
    if (!byFamily[family]) byFamily[family] = c;
  }
  const pool = Object.values(byFamily);

  let best = null;
  if (pool.length >= 2) best = findBestSubset(pool, gates);

  if (!best) {
    best = findBestSubset(candidates, gates);
    if (best) best.fallback_used = 'direction_group_pool';
  }

  if (!best) {
    return {
      match_id: matchId, status: 'weak', reason: 'no_subset_in_odd_range',
      legs: [], candidates_count: candidates.length,
    };
  }

  return {
    match_id: matchId, status: 'ready', legs: best.legs,
    n_legs: best.n_legs, n_families: best.n_families, families: best.families,
    combo_odd: best.combo_odd, combo_odd_bruta: best.combo_odd_bruta,
    builder_discount: best.builder_discount,
    builder_discount_base: best.builder_discount_base,
    correlation_factor: best.correlation_factor,
    joint_prob: best.joint_prob,
    prob_geo: best.prob_geo,
    trusted_count: best.trusted_count, avg_reliability: best.avg_reliability,
    quality_score: best.quality_score,
    combo_ev: best.combo_ev,
    rank_score: best.rank_score,
    is_exception: best.is_exception,
    n_legs_target: best.n_legs_target, fallback_used: best.fallback_used,
    candidates_count: candidates.length,
  };
}
