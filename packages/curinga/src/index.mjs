// @scoutcore/curinga — combinador A/B + sanity gates.
//
// VERSÃO INICIAL: Engine B indisponível, então o curinga retorna Engine A
// puro com provenance honesto (weight_a=1, weight_b=0, divergence=null).
// Quando Engine B existir, esta função aplicará:
//   - Resolução de divergence via z-score em ewma_brier histórico
//   - Pesos dinâmicos (CLV-aware)
//   - Gates de sanity (cap edge_pct, drop slots com fair_prob fora de [0.02, 0.98])

const SANITY = {
  minProb: 0.02,
  maxProb: 0.98,
};

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

  // TODO: implementar combinação real quando Engine B estiver disponível.
  // Por ora delegamos a A pleno e marcamos provenance.
  const wA = weightAOverride ?? 1;
  return slotsA.map((s) => ({
    ...s,
    provenance: { ...s.provenance, weight_a: wA, weight_b: 1 - wA, divergence: null, divergence_resolved_by: 'todo_combine' },
  }));
}

export const CURINGA_VERSION = '0.0.1-stub';
