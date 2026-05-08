// @scoutcore/scout — relatório de leitura humana (opt-in via options.scout=true).
//
// Gera um resumo textual derivado dos slots já calibrados (não recomputa nada):
//   - Top 5 picks por score (edge × confidence × phantom)
//   - Distribuição por família
//   - Warnings de baixa confiança / phantom edges
//   - Notas de leitura (mando, regime, lambda totais)
//
// Honestidade:
//  * Não inventa números. Cada bullet referencia fields reais do slot.
//  * Quando faltam dados (sem odds, todos rejeitados por QG, etc.) marca explicitamente.

export const SCOUT_VERSION = '0.1.0';

export function buildScoutReport({ match, slots, evRanked, evRankedCappedOut, warnings }) {
  const t0 = Date.now();
  const slotByKey = new Map(slots.map((s) => [s.market_key, s]));

  // Top 5
  const topPicks = (evRanked ?? []).slice(0, 5).map((k) => {
    const s = slotByKey.get(k);
    if (!s) return null;
    return {
      market_key: k,
      family: s.family,
      direction: s.direction,
      line: s.line,
      fair_prob: s.fair_prob,
      market_odd: s.market_odd ?? null,
      edge_pct: s.edge_pct ?? null,
      confidence: s.confidence ?? null,
      certified: !!s.certified,
      isotonic_applied: !!s.provenance?.isotonic?.applied,
      calib_applied: !!s.provenance?.calib?.applied,
      phantom: !!s.provenance?.phantom_edge_flag,
    };
  }).filter(Boolean);

  // Distribuição por família entre slots com odds
  const familyDist = {};
  for (const s of slots) {
    if (s.market_odd == null) continue;
    familyDist[s.family] = (familyDist[s.family] ?? 0) + 1;
  }

  // Notas
  const notes = [];
  const anyPhantom = slots.some((s) => s.provenance?.phantom_edge_flag);
  if (anyPhantom) notes.push('phantom_edge_detected: revisar odds e lambda');
  const lowConf = topPicks.filter((p) => (p.confidence ?? 0) < 0.4);
  if (lowConf.length > 0) {
    notes.push(`low_confidence_in_top5: ${lowConf.length} pick(s) com confidence<0.4`);
  }
  const noOdds = slots.filter((s) => s.market_odd == null).length;
  if (noOdds > 0 && (evRanked?.length ?? 0) === 0) {
    notes.push('no_odds_provided: ev_ranked vazio — sem odds_snapshot no request');
  }
  if ((evRankedCappedOut?.length ?? 0) > 0) {
    notes.push(`family_cap_filtered: ${evRankedCappedOut.length} mercado(s) excluído(s) do topo`);
  }

  // Resumo textual curto (1-3 linhas)
  let summary;
  if (topPicks.length === 0) {
    summary = `Sem picks ranqueados para ${match.home} × ${match.away}. Verifique odds_snapshot e quality-gates.`;
  } else {
    const top = topPicks[0];
    summary = `Top pick: ${top.market_key} @ ${top.market_odd ?? '?'} ` +
      `(prob=${(top.fair_prob * 100).toFixed(1)}%, edge=${top.edge_pct ?? '?'}pp, ` +
      `conf=${(top.confidence * 100).toFixed(0)}%) — ${top.family}/${top.direction}.`;
  }

  return {
    version: SCOUT_VERSION,
    summary,
    top_picks: topPicks,
    family_distribution: familyDist,
    notes,
    warnings: warnings ?? [],
    capped_out_count: evRankedCappedOut?.length ?? 0,
    generated_in_ms: Date.now() - t0,
  };
}
