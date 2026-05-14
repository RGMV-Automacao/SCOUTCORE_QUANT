// @scoutcore/curinga — combinador A/B + sanity gates.
//
// Combinação A/B (quando ambos disponíveis):
//   - fair_prob_combined = wA * pA + wB * pB
//   - peso DINÂMICO por (family, liga) via ewma_brier (menor brier → mais peso).
//     Fallback: wA=0.5/wB=0.5. Override manual via weightAOverride.
//   - Family reliability multiplier: famílias mais confiáveis para cada engine
//     (D13/D15) ganham boost suave no respectivo lado.
//   - divergence = |pA - pB|.
//   - Consenso: diferenca <= 5pp.
//   - Calibracao: diferenca moderada, usa pesos dinamicos.
//   - Flagged: diferenca >= 15pp ou fair odds divergem >= 20%; certified=false.
//
// Sanity gates: drop slots com fair_prob fora de [0.02, 0.98].

const SANITY = { minProb: 0.02, maxProb: 0.98 };
const CONSENSUS_MAX_PP = 5;
const DIVERGENCE_FLAG_PP = 15;
const FAIR_ODD_FLAG_PCT = 20;

// D13/D15 family reliability heuristics. Valores conservadores.
// Engine A (Poisson) é confiável em famílias de contagem (gols, escanteios, chutes,
// faltas, cartões). Engine B (ML) tende a ir melhor em mercados de label/contexto
// (1x2, btts, htft, dupla, dnb).
const FAMILY_RELIABILITY = {
  A: new Set(['gols','escanteios','chutes','chutes_alvo','faltas','cartoes',
              'impedimentos','defesas','asian_total','escanteios_asian',
              'escanteios_race','escanteios_exato']),
  B: new Set(['1x2','btts','htft','dupla','dnb','correct_score','margem',
              'marca_primeiro','marca_ultimo','marca','cartoes_1x2',
              'escanteios_1x2','btts_ambos_tempos','btts_algum_tempo']),
};
const RELIABILITY_BOOST = 0.10; // ±10pp shift quando a família é "casa" do engine

/**
 * Calcula peso dinâmico A/B baseado em ewma_brier por (family, liga).
 * @param {object} calib  { ewma_brier_a, ewma_brier_b } ou similar.
 * @param {string} family
 * @returns {{wA:number, wB:number, source:string}}
 */
export function computeWeights(calib, family) {
  const bA = Number.isFinite(calib?.ewma_brier_a) ? calib.ewma_brier_a : null;
  const bB = Number.isFinite(calib?.ewma_brier_b) ? calib.ewma_brier_b : null;
  let wA, source;
  if (bA != null && bB != null && (bA + bB) > 0) {
    wA = bB / (bA + bB);                         // menor brier → maior peso
    source = 'ewma_brier';
  } else if (bA != null && bB == null) {
    wA = 0.65;                                   // A tem track-record, B novo
    source = 'a_only_history';
  } else if (bA == null && bB != null) {
    wA = 0.35;
    source = 'b_only_history';
  } else {
    wA = 0.5;
    source = 'default';
  }

  // Family reliability shift (D13/D15)
  if (FAMILY_RELIABILITY.A.has(family))      wA = Math.min(0.85, wA + RELIABILITY_BOOST);
  else if (FAMILY_RELIABILITY.B.has(family)) wA = Math.max(0.15, wA - RELIABILITY_BOOST);

  wA = +Math.max(0.10, Math.min(0.90, wA)).toFixed(4);
  return { wA, wB: +(1 - wA).toFixed(4), source };
}

/**
 * @param {object} args
 * @param {Array} args.slotsA
 * @param {Array|null} args.slotsB
 * @param {number|null} [args.weightAOverride]  Força wA fixo (ignora calibMap).
 * @param {Map|null} [args.calibMap]            Map<`${family}::${liga}`, {ewma_brier_a, ewma_brier_b}>
 * @param {string|null} [args.liga]
 */
export function combine({ slotsA, slotsB = null, weightAOverride = null, calibMap = null, liga = null } = {}) {
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

  const bByKey = new Map(slotsB.map((s) => [s.market_key, s]));
  const seenA = new Set();

  function pickWeights(family) {
    if (weightAOverride != null) {
      const w = +weightAOverride;
      return { wA: w, wB: 1 - w, source: 'override' };
    }
    if (!calibMap) {
      return computeWeights(null, family);
    }
    const key = `${family}::${liga ?? '*'}`;
    return computeWeights(calibMap.get(key) ?? calibMap.get(`${family}::*`) ?? null, family);
  }

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
    const { wA, wB, source } = pickWeights(sa.family);
    const pA = sa.fair_prob;
    const pB = sb.fair_prob;
    const pCombined = wA * pA + wB * pB;
    const divPp = Math.abs(pA - pB) * 100;
    const fairOddDeltaPct = fairOddDelta(pA, pB);
    const resolution = resolveDivergence({ divPp, fairOddDeltaPct });
    const fairOdd = pCombined > 0 ? +(1 / pCombined).toFixed(4) : null;
    return {
      ...sa,
      fair_prob: +pCombined.toFixed(6),
      fair_odd: fairOdd,
      provenance: {
        ...sa.provenance,
        weight_a: wA, weight_b: wB,
        weight_source: source,
        fair_prob_a: pA, fair_prob_b: pB,
        divergence_pp: +divPp.toFixed(2),
        divergence_fair_odd_delta_pct: fairOddDeltaPct,
        divergence_flag: resolution === 'flagged',
        divergence_resolved_by: resolution === 'consensus' ? 'consensus' : resolution === 'calibration' ? 'calibration_weighted' : 'flagged_divergence',
      },
      certified: sa.certified && sb.certified !== false && resolution !== 'flagged'
        && pCombined >= SANITY.minProb && pCombined <= SANITY.maxProb,
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
      certified: false,
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

function fairOddDelta(pA, pB) {
  if (!Number.isFinite(pA) || !Number.isFinite(pB) || pA <= 0 || pB <= 0) return null;
  const oddA = 1 / pA;
  const oddB = 1 / pB;
  const base = Math.min(oddA, oddB);
  if (base <= 0) return null;
  return +(Math.abs(oddA - oddB) / base * 100).toFixed(2);
}

function resolveDivergence({ divPp, fairOddDeltaPct }) {
  if (divPp >= DIVERGENCE_FLAG_PP || (fairOddDeltaPct != null && fairOddDeltaPct >= FAIR_ODD_FLAG_PCT)) {
    return 'flagged';
  }
  if (divPp <= CONSENSUS_MAX_PP) return 'consensus';
  return 'calibration';
}

function inferFamily(marketKey) {
  if (!marketKey) return 'unknown';
  if (marketKey.startsWith('gols_')) return 'gols';
  if (marketKey.startsWith('btts')) return 'btts';
  if (marketKey.startsWith('1x2')) return '1x2';
  return 'unknown';
}

export const CURINGA_VERSION = '0.4.0';
