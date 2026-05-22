// Smoke test: registry whitelist consistency.
import { MARKETS, MARKETS_VERSION, WHITELIST_FAMILIES, listMarkets, parseMarketKey, getMarket, canonicalizeMarketKey, MARKET_KEY_ALIASES, isWhitelistedFamily } from './src/registry.mjs';

const seen = new Set();
const bad = [];
for (const m of MARKETS) {
  if (seen.has(m.key)) bad.push({ kind: 'dup', key: m.key });
  seen.add(m.key);
  if (!isWhitelistedFamily(m.family)) bad.push({ kind: 'out_of_wl', key: m.key, family: m.family });
  const p = parseMarketKey(m.key);
  if (!p) bad.push({ kind: 'unparseable', key: m.key });
}

const familiesPresent = new Set(MARKETS.map(m => m.family));
const missingFromWL = WHITELIST_FAMILIES.filter(f => !familiesPresent.has(f));

const aliasCount = Object.keys(MARKET_KEY_ALIASES).length;
const aliasBad = Object.entries(MARKET_KEY_ALIASES).filter(([, v]) => !getMarket(v));

console.log(JSON.stringify({
  version: MARKETS_VERSION,
  total_keys: MARKETS.length,
  families_count: familiesPresent.size,
  families_present: [...familiesPresent].sort(),
  missing_from_whitelist: missingFromWL,
  bad,
  alias_count: aliasCount,
  alias_dangling: aliasBad,
}, null, 2));

if (bad.length || missingFromWL.length || aliasBad.length) {
  console.error('REGISTRY_SMOKE_FAILED');
  process.exit(1);
}
