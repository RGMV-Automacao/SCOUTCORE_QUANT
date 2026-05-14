/**
 * @scoutcore/strategy-engine — runners/global_filter.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Runner genérico: filtra slots globalmente e ranqueia por métrica.
 * Estratégias: singles-ev, seguros.
 *
 * Params suportados:
 *   min_edge_pct      Mínimo de edge %
 *   min_prob           Mínimo de fair_prob
 *   require_market_odd Se true, exclui slots sem market_odd
 *   rank_by            'ev_real' | 'edge_pct' | 'fair_prob' | 'confidence'
 *   top_n              Máximo de picks
 */

/**
 * Calcula EV real: (fair_prob * market_odd) - 1
 */
function evReal(slot) {
  const prob = slot.fair_prob ?? 0;
  const odd = slot.market_odd ?? 0;
  return prob > 0 && odd > 0 ? odd * prob - 1 : 0;
}

function rankValue(slot, rankBy) {
  switch (rankBy) {
    case 'ev_real':     return evReal(slot);
    case 'edge_pct':    return slot.edge_pct ?? 0;
    case 'fair_prob':   return slot.fair_prob ?? 0;
    case 'confidence':  return slot.confidence ?? 0;
    default:            return evReal(slot);
  }
}

/**
 * @param {object[]} slots
 * @param {object} params
 * @returns {{ picks: object[], meta: object }}
 */
export function run(slots, params = {}) {
  const minEdge  = params.min_edge_pct ?? 0;
  const minProb  = params.min_prob ?? 0;
  const needOdd  = params.require_market_odd ?? false;
  const rankBy   = params.rank_by ?? 'ev_real';
  const topN     = params.top_n ?? 30;

  const filtered = slots.filter((s) => {
    if (!s.certified) return false;
    if ((s.edge_pct ?? 0) < minEdge) return false;
    if ((s.fair_prob ?? 0) < minProb) return false;
    if (needOdd && (s.market_odd == null || s.market_odd <= 1)) return false;
    return true;
  });

  const ranked = filtered
    .map((s) => ({ ...s, _rank_value: rankValue(s, rankBy), _ev_real: evReal(s) }))
    .sort((a, b) => b._rank_value - a._rank_value)
    .slice(0, topN);

  // Limpar campos internos
  const picks = ranked.map(({ _rank_value, _ev_real, ...rest }) => ({
    ...rest,
    ev_real: _ev_real,
    rank_value: _rank_value,
  }));

  return {
    picks,
    meta: {
      total_input: slots.length,
      after_filter: filtered.length,
      rank_by: rankBy,
      top_n: topN,
    },
  };
}
