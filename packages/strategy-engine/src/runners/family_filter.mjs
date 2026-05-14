/**
 * @scoutcore/strategy-engine — runners/family_filter.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Runner: filtra por família(s), opcionalmente por período, e ranqueia.
 * Estratégias: bingo-resultado, bingo-escanteios, bingo-cartoes.
 *
 * Params suportados:
 *   families           Array de famílias aceitas
 *   periods            Array de períodos aceitos (opcional — all se vazio)
 *   min_edge_pct       Mínimo de edge %
 *   min_prob            Mínimo de fair_prob
 *   rank_by             'edge_pct' | 'confidence' | 'fair_prob' | 'ev_real'
 *   top_n               Máximo de picks
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
    default:            return slot.edge_pct ?? 0;
  }
}

/**
 * @param {object[]} slots
 * @param {object} params
 * @returns {{ picks: object[], meta: object }}
 */
export function run(slots, params = {}) {
  const families = new Set(params.families ?? []);
  const periods  = params.periods?.length ? new Set(params.periods) : null;
  const minEdge  = params.min_edge_pct ?? 0;
  const minProb  = params.min_prob ?? 0;
  const rankBy   = params.rank_by ?? 'edge_pct';
  const topN     = params.top_n ?? 7;

  const filtered = slots.filter((s) => {
    if (!s.certified) return false;
    if (families.size > 0 && !families.has(s.family)) return false;
    if (periods && !periods.has(s.period)) return false;
    if ((s.edge_pct ?? 0) < minEdge) return false;
    if ((s.fair_prob ?? 0) < minProb) return false;
    return true;
  });

  const ranked = filtered
    .map((s) => ({ ...s, _rank_value: rankValue(s, rankBy), _ev_real: evReal(s) }))
    .sort((a, b) => b._rank_value - a._rank_value)
    .slice(0, topN);

  const picks = ranked.map(({ _rank_value, _ev_real, ...rest }) => ({
    ...rest,
    ev_real: _ev_real,
    rank_value: _rank_value,
  }));

  return {
    picks,
    meta: {
      total_input: slots.length,
      family_matched: filtered.length,
      families: [...families],
      rank_by: rankBy,
      top_n: topN,
    },
  };
}
