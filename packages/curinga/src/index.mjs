// @scoutcore/curinga — combinador A/B + sanity gates.
//
// Combinação A/B (quando ambos disponíveis):
//   - fair_prob_combined = wA * fair_prob_A + wB * fair_prob_B   (média ponderada)
//   - peso default: wA=0.5, wB=0.5 (override via weightAOverride)
//   - divergence = |pA - pB|. Se >= DIVERGENCE_FLAG_PP/100 → flag.
//   - provenance registra pA, pB, divergence, weight_a, weight_b.
//   - Mercados só em B (sem contraparte A) são adicionados ao final.
//
// Sanity gates: drop slots com fair_prob fora de [0.02, 0.98].

const SANITY = {
  minProb: 0.02,
  maxProb: 0.98,
};

const DIVERGENCE_FLAG_PP = 15; // |pA-pB| em pp acima disso → flag

export function combine({ slotsA, slotsB = null, weightAOverride = null } = {}) {
  if (!slotsB || slotsB.length === 0) {
    return slotsA.map((s) => ({
      ...s,
      provenance: {
        ...s.provenance,
        weight_a: 1,
        weight_b: 0,
        divergence: null,
        divergence_resolved_by: 'engine_b_unavailable',
      },
      certified: s.certified && s.fair_prob >= SANITY.minProb && s.fair_prob <= SANITY.maxProb,
    }));
  }

  const wA = weightAOverride ?? 0.5;
  const wB = 1 - wA;
  const bByKey = new Map(slotsB.map((s) => [s.market_key, s]));
  const seenA = new Set();

  const merged = slotsA.map((sa) => {
    seenA.add(sa.market_key);
    const sb = bByKey.get(sa.market_key);
    if (!sb) {
      return {
        ...sa,
        provenance: {
          ...sa.provenance,
          weight_a: 1, weight_b: 0,
          divergence: null,
          divergence_resolved_by: 'engine_b_no_slot',
        },
        certified: sa.certified && sa.fair_prob >= SANITY.minProb && sa.fair_prob <= SANITY.maxProb,
      };
    }
    const pA = sa.fair_prob;
    const pB = sb.fair_prob;
    const pCombined = wA * pA + wB * pB;
    const divPp = Math.abs(pA - pB) * 100;
    const fairOdd = pCombined > 0 ? +(1 / pCombined).toFixed(4) : null;
    return {
      ...sa,
      fair_prob: +pCombined.toFixed(6),
      fair_odd: fairOdd,
      provenance: {
        ...sa.provenance,
        weight_a: wA, weight_b: wB,
        fair_prob_a: pA, fair_prob_b: pB,
        divergence_pp: +divPp.toFixed(2),
        divergence_flag: divPp >= DIVERGENCE_FLAG_PP,
        divergence_resolved_by: 'weighted_average',
      },
      certified: sa.certified && pCombined >= SANITY.minProb && pCombined <= SANITY.maxProb,
    };
  });

  // Adiciona mercados B-only (sem contraparte A).
  for (const sb of slotsB) {
    if (seenA.has(sb.market_key)) continue;
    if (sb.fair_prob < SANITY.minProb || sb.fair_prob > SANITY.maxProb) continue;
    merged.push({
      market_key: sb.market_key,
      family: sb.family ?? inferFamily(sb.market_key),
      direction: sb.direction ?? null,
      scope: sb.scope ?? 'total',
      period: sb.period ?? 'FT',
      fair_prob: sb.fair_prob,
      fair_odd: sb.fair_prob > 0 ? +(1 / sb.fair_prob).toFixed(4) : null,
      certified: !!sb.certified,
      source: 'engine_b_only',
      provenance: {
        ...(sb.provenance ?? {}),
        weight_a: 0, weight_b: 1,
        divergence: null,
        divergence_resolved_by: 'engine_a_no_slot',
      },
    });
  }
  return merged;
}

function inferFamily(marketKey) {
  if (!marketKey) return 'unknown';
  if (marketKey.startsWith('gols_')) return 'gols';
  if (marketKey.startsWith('btts')) return 'btts';
  if (marketKey.startsWith('1x2')) return '1x2';
  return 'unknown';
}

export const CURINGA_VERSION = '0.2.0';
