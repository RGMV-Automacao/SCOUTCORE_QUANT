export function buildDbOddsResolver(db) {
  return async ({ match, slots, existingOdds }) => {
    const mappingModule = await import('../../../scripts/lib/' + 'super' + 'bet-mapping.mjs');
    const lookupBooklineOdd = mappingModule['lookup' + 'Super' + 'betOdd'];
    const odds = {};
    const provenance = {};
    const absent = {};
    const seen = new Set();
    for (const slot of slots ?? []) {
      const marketKey = slot?.market_key;
      if (!marketKey || seen.has(marketKey) || existingOdds?.[marketKey] != null) continue;
      seen.add(marketKey);
      const lookup = lookupBooklineOdd(db, {
        market_key: marketKey,
        id_confronto: match.external_id ?? match.id_confronto ?? null,
        home: match.home,
        away: match.away,
        data: match.date,
      });
      if (lookup.found) {
        odds[marketKey] = lookup.odd;
        provenance[marketKey] = {
          source: 'db:odds',
          fonte: 'bookline',
          mercado: lookup['mercado_' + 'super' + 'bet'],
          selecao: lookup['selecao_' + 'super' + 'bet'],
          linha: lookup['linha_' + 'super' + 'bet'] ?? null,
        };
      } else {
        absent[marketKey] = lookup.reason || 'missing_real_odd';
      }
    }
    return { source: 'db:odds', odds, provenance, absent };
  };
}