// @scoutcore/markets/registry — catálogo canônico de mercados.
//
// **Escopo único: Superbet (bookline).** A partir de v2.0.0 (refactor
// 2026-05-18) o registry só inclui mercados ofertados pela Superbet. Famílias
// fora do whitelist (asian_handicap, htft, correct_score, escanteios_race,
// escanteios_exato, escanteios_asian, asian_total, handicap, btts_algum_tempo,
// btts_ambos_tempos, dnb, margem, marca*, ...) foram removidas; o motor não
// gera mais nenhuma predição para elas.
//
// Convenção de market_key (canônica, ascii kebab):
//   <familia>_<scope>_<period>_<direction>[_<line>]
// Exemplos:
//   gols_total_ft_over_2_5
//   btts_total_ft_sim
//   gols_oddeven_total_ft_par
//   1x2_total_ft_home
//   dupla_total_ht_1x
//   escanteios_total_ft_over_9_5
//   escanteios_1x2_total_ht_home
//   escanteios_handicap_total_ft_home_minus_2_5
//   escanteios_oddeven_total_ft_par
//   chutes_total_ft_over_24_5             // "Total de Finalizações"
//   chutes_1x2_total_ft_home              // "Equipe Com Mais Finalizações"
//   chutes_alvo_total_ft_over_8_5         // "Total de Chutes no Gol"
//   chutes_alvo_1x2_total_ft_home         // "Equipe Com Mais Chutes no Gol"
//   defesas_home_ft_over_2_5
//   defesas_total_ht_over_2_5
//   desarmes_total_ft_over_30_5
//   cartoes_total_ft_over_3_5
//   cartoes_1x2_total_ft_home
//   faltas_home_ft_over_10_5
//   impedimentos_total_ft_over_2_5
//
// Famílias whitelist (19):
//   1x2, dupla,
//   gols, btts, gols_oddeven,
//   cartoes, cartoes_1x2,
//   chutes, chutes_1x2,
//   chutes_alvo, chutes_alvo_1x2,
//   defesas, desarmes,
//   escanteios, escanteios_1x2, escanteios_handicap, escanteios_oddeven,
//   faltas, impedimentos.

const _seed = [];

function reg(entry) { _seed.push(entry); }

function regOverUnder({ family, scope, period, lines, since = '2.0.0' }) {
  for (const ln of lines) {
    const tag = String(ln).replace('.', '_');
    reg({ key: `${family}_${scope}_${period.toLowerCase()}_over_${tag}`,  family, scope, period, direction: 'over',  line: ln, since });
    reg({ key: `${family}_${scope}_${period.toLowerCase()}_under_${tag}`, family, scope, period, direction: 'under', line: ln, since });
  }
}

function regOddEven({ family, scope, period, since = '2.0.0' }) {
  for (const dir of ['par', 'impar']) {
    reg({ key: `${family}_${scope}_${period.toLowerCase()}_${dir}`, family, scope, period, direction: dir, line: null, since });
  }
}

function regHandicap({ family, scope, period, lines, since = '2.0.0' }) {
  for (const h of lines) {
    const absTag = String(Math.abs(h)).replace('.', '_');
    const sign = h < 0 ? 'minus' : 'plus';
    for (const side of ['home', 'away']) {
      reg({
        key: `${family}_${scope}_${period.toLowerCase()}_${side}_${sign}_${absTag}`,
        family, scope, period,
        direction: `${side}_${sign}_${absTag}`,
        line: h, since,
      });
    }
  }
}

// ─────────────────────────────────────────────
// GOLS — over/under em total/home/away, FT/HT/2T
// ─────────────────────────────────────────────
regOverUnder({ family: 'gols', scope: 'total', period: 'FT', lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'gols', scope: 'total', period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'total', period: '2T', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'home',  period: 'HT', lines: [0.5, 1.5] });
regOverUnder({ family: 'gols', scope: 'away',  period: 'HT', lines: [0.5, 1.5] });

// ─────────────────────────────────────────────
// BTTS — sim/nao em FT e HT (Superbet expõe 1T)
// ─────────────────────────────────────────────
for (const period of ['FT', 'HT']) {
  for (const dir of ['sim', 'nao']) {
    reg({ key: `btts_total_${period.toLowerCase()}_${dir}`, family: 'btts', scope: 'total', period, direction: dir, line: null, since: '2.0.0' });
  }
}

// ─────────────────────────────────────────────
// GOLS ODD/EVEN — paridade da soma total de gols, FT e HT
// ─────────────────────────────────────────────
regOddEven({ family: 'gols_oddeven', scope: 'total', period: 'FT' });
regOddEven({ family: 'gols_oddeven', scope: 'total', period: 'HT' });

// ─────────────────────────────────────────────
// 1X2 / Dupla Chance — FT e HT (Superbet não oferece 1x2 2T)
// ─────────────────────────────────────────────
for (const period of ['FT', 'HT']) {
  for (const dir of ['home', 'draw', 'away']) {
    reg({ key: `1x2_total_${period.toLowerCase()}_${dir}`, family: '1x2', scope: 'total', period, direction: dir, line: null, since: '2.0.0' });
  }
  for (const dir of ['1x', '12', 'x2']) {
    reg({ key: `dupla_total_${period.toLowerCase()}_${dir}`, family: 'dupla', scope: 'total', period, direction: dir, line: null, since: '2.0.0' });
  }
}

// ─────────────────────────────────────────────
// ESCANTEIOS — over/under, 1x2, handicap, oddeven, em FT e HT
// ─────────────────────────────────────────────
regOverUnder({ family: 'escanteios', scope: 'total', period: 'FT', lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5] });
regOverUnder({ family: 'escanteios', scope: 'total', period: 'HT', lines: [2.5, 3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'escanteios', scope: 'home',  period: 'FT', lines: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'escanteios', scope: 'away',  period: 'FT', lines: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'escanteios', scope: 'home',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5, 4.5] });
regOverUnder({ family: 'escanteios', scope: 'away',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5, 4.5] });

for (const period of ['FT', 'HT']) {
  for (const dir of ['home', 'draw', 'away']) {
    reg({ key: `escanteios_1x2_total_${period.toLowerCase()}_${dir}`, family: 'escanteios_1x2', scope: 'total', period, direction: dir, line: null, since: '2.0.0' });
  }
}

regHandicap({ family: 'escanteios_handicap', scope: 'total', period: 'FT', lines: [-4.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 4.5] });
regHandicap({ family: 'escanteios_handicap', scope: 'total', period: 'FT', lines: [-5.5, 5.5], since: '2.1.1' });
regHandicap({ family: 'escanteios_handicap', scope: 'total', period: 'HT', lines: [-2.5, -1.5, 1.5, 2.5] });

regOddEven({ family: 'escanteios_oddeven', scope: 'total', period: 'FT' });
regOddEven({ family: 'escanteios_oddeven', scope: 'total', period: 'HT' });

// ─────────────────────────────────────────────
// CHUTES (= Finalizações totais) — over/under + 1x2, FT/HT
// ─────────────────────────────────────────────
regOverUnder({ family: 'chutes', scope: 'total', period: 'FT', lines: [17.5, 19.5, 21.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5] });
regOverUnder({ family: 'chutes', scope: 'home',  period: 'FT', lines: [8.5, 10.5, 12.5, 13.5, 14.5, 15.5] });
regOverUnder({ family: 'chutes', scope: 'away',  period: 'FT', lines: [8.5, 10.5, 12.5, 13.5, 14.5, 15.5] });
regOverUnder({ family: 'chutes', scope: 'total', period: 'HT', lines: [8.5, 9.5, 10.5, 11.5, 12.5] });
regOverUnder({ family: 'chutes', scope: 'home',  period: 'HT', lines: [3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'chutes', scope: 'away',  period: 'HT', lines: [3.5, 4.5, 5.5, 6.5] });
for (const period of ['FT', 'HT']) {
  for (const dir of ['home', 'draw', 'away']) {
    reg({ key: `chutes_1x2_total_${period.toLowerCase()}_${dir}`, family: 'chutes_1x2', scope: 'total', period, direction: dir, line: null, since: '2.0.0' });
  }
}

// ─────────────────────────────────────────────
// CHUTES NO GOL (= Chutes no Gol / shots on target) — over/under + 1x2, FT/HT
// ─────────────────────────────────────────────
regOverUnder({ family: 'chutes_alvo', scope: 'total', period: 'FT', lines: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'home',  period: 'FT', lines: [2.5, 3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'away',  period: 'FT', lines: [2.5, 3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'total', period: 'HT', lines: [2.5, 3.5, 4.5, 5.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'home',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'away',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });
for (const period of ['FT', 'HT']) {
  for (const dir of ['home', 'draw', 'away']) {
    reg({ key: `chutes_alvo_1x2_total_${period.toLowerCase()}_${dir}`, family: 'chutes_alvo_1x2', scope: 'total', period, direction: dir, line: null, since: '2.0.0' });
  }
}

// ─────────────────────────────────────────────
// DEFESAS DO GOLEIRO — total/home/away, FT
// ─────────────────────────────────────────────
regOverUnder({ family: 'defesas', scope: 'total', period: 'FT', lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5] });
regOverUnder({ family: 'defesas', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'defesas', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'defesas', scope: 'total', period: 'HT', lines: [1.5, 2.5, 3.5, 4.5] });
regOverUnder({ family: 'defesas', scope: 'home',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'defesas', scope: 'away',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });

// ─────────────────────────────────────────────
// DESARMES (tackles) — total/home/away, FT
// ─────────────────────────────────────────────
regOverUnder({ family: 'desarmes', scope: 'total', period: 'FT', lines: [25.5, 26.5, 27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5, 34.5, 35.5] });
regOverUnder({ family: 'desarmes', scope: 'home',  period: 'FT', lines: [12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5] });
regOverUnder({ family: 'desarmes', scope: 'away',  period: 'FT', lines: [12.5, 13.5, 14.5, 15.5, 16.5, 17.5, 18.5, 19.5] });

// ─────────────────────────────────────────────
// CARTOES — total/home/away, FT/HT + 1x2 FT (Equipe Mais Cartões)
// ─────────────────────────────────────────────
regOverUnder({ family: 'cartoes', scope: 'total', period: 'FT', lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'cartoes', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'cartoes', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'cartoes', scope: 'total', period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'cartoes', scope: 'home',  period: 'HT', lines: [0.5, 1.5] });
regOverUnder({ family: 'cartoes', scope: 'away',  period: 'HT', lines: [0.5, 1.5] });
for (const period of ['FT', 'HT']) {
  for (const dir of ['home', 'draw', 'away']) {
    reg({ key: `cartoes_1x2_total_${period.toLowerCase()}_${dir}`, family: 'cartoes_1x2', scope: 'total', period, direction: dir, line: null, since: '2.1.0' });
  }
}

// ─────────────────────────────────────────────
// FALTAS — total/home/away, FT
// ─────────────────────────────────────────────
regOverUnder({ family: 'faltas', scope: 'total', period: 'FT', lines: [17.5, 19.5, 21.5, 23.5, 25.5, 27.5] });
regOverUnder({ family: 'faltas', scope: 'home',  period: 'FT', lines: [8.5, 10.5, 12.5, 14.5] });
regOverUnder({ family: 'faltas', scope: 'away',  period: 'FT', lines: [8.5, 10.5, 12.5, 14.5] });
regOverUnder({ family: 'faltas', scope: 'total', period: 'HT', lines: [8.5, 9.5, 10.5, 11.5, 12.5, 13.5] });
regOverUnder({ family: 'faltas', scope: 'home',  period: 'HT', lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5] });
regOverUnder({ family: 'faltas', scope: 'away',  period: 'HT', lines: [3.5, 4.5, 5.5, 6.5, 7.5, 8.5] });

// ─────────────────────────────────────────────
// IMPEDIMENTOS — total/home/away, FT
// ─────────────────────────────────────────────
regOverUnder({ family: 'impedimentos', scope: 'total', period: 'FT', lines: [2.5, 3.5, 4.5, 5.5] });
regOverUnder({ family: 'impedimentos', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5] });
regOverUnder({ family: 'impedimentos', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5] });

// ────────── Index/exports ──────────

const _byKey = new Map(_seed.map((m) => [m.key, m]));

function buildCompactLineAlias(key) {
  const match = /^(.*_(?:over|under)_)(\d+)_(\d+)$/.exec(key);
  if (!match) return null;
  const [, prefix, integerPart, fractionalPart] = match;
  return `${prefix}${integerPart}${fractionalPart}`;
}

function buildMarketKeyAliases() {
  const aliases = {};
  for (const market of _seed) {
    const period = market.period.toLowerCase();
    const compactLineAlias = buildCompactLineAlias(market.key);
    if (compactLineAlias && compactLineAlias !== market.key) {
      aliases[compactLineAlias] = market.key;
    }
    if (market.family === 'btts') {
      aliases[`btts_${period}_${market.direction}`] = market.key;
      if (market.period === 'FT') aliases[`btts_${market.direction}`] = market.key;
    }
    if (market.family === '1x2') {
      aliases[`resultado_1x2_${period}_${market.direction}`] = market.key;
      if (market.period === 'FT') aliases[`1x2_${market.direction}`] = market.key;
    }
    if (market.family === 'dupla') {
      aliases[`resultado_dupla_${period}_${market.direction}`] = market.key;
    }
  }
  return Object.freeze(aliases);
}

export const MARKETS_VERSION = '2.1.1';
export const MARKETS = _seed.slice();
export const MARKET_KEY_ALIASES = buildMarketKeyAliases();

/** Whitelist canônica das famílias Superbet (escopo único v2.0.0). */
export const WHITELIST_FAMILIES = Object.freeze([
  '1x2', 'dupla',
  'gols', 'btts', 'gols_oddeven',
  'cartoes', 'cartoes_1x2',
  'chutes', 'chutes_1x2',
  'chutes_alvo', 'chutes_alvo_1x2',
  'defesas', 'desarmes',
  'escanteios', 'escanteios_1x2', 'escanteios_handicap', 'escanteios_oddeven',
  'faltas', 'impedimentos',
]);
const _whitelistSet = new Set(WHITELIST_FAMILIES);

export function isWhitelistedFamily(family) {
  return _whitelistSet.has(family);
}

export function assertWhitelistedFamily(family, ctx = 'family') {
  if (!_whitelistSet.has(family)) {
    throw new Error(`whitelist_violation:${ctx}:${family}`);
  }
}

export function canonicalizeMarketKey(key) {
  if (!key) return key;
  return MARKET_KEY_ALIASES[key] ?? key;
}

export function normalizeMarketSnapshot(snapshot = {}, aliasMap = {}, warnings = []) {
  const out = {};
  for (const [rawKey, odd] of Object.entries(snapshot ?? {})) {
    const canonical = aliasMap?.[rawKey] ?? canonicalizeMarketKey(rawKey);
    if (canonical !== rawKey) warnings.push(`market_alias_resolved:${rawKey}->${canonical}`);
    if (out[canonical] != null) warnings.push(`market_alias_collision:${rawKey}->${canonical}`);
    out[canonical] = odd;
  }
  return out;
}

export function getMarket(key) {
  return _byKey.get(key) || null;
}

export function listMarkets({ family, scope, period } = {}) {
  return _seed.filter((m) =>
    (!family || m.family === family) &&
    (!scope  || m.scope === scope) &&
    (!period || m.period === period)
  );
}

/** Parse de market_key canônico → { family, scope, period, direction, line }. */
export function parseMarketKey(key) {
  const cached = _byKey.get(key);
  if (cached) return cached;
  const m = /^([a-z0-9_]+?)_(total|home|away)_(ft|ht|2t|full)_([a-z0-9_]+?)(?:_(\d+(?:_\d+)?))?$/.exec(key);
  if (!m) return null;
  const [, family, scope, periodLow, direction, lineRaw] = m;
  const line = lineRaw ? Number(lineRaw.replace('_', '.')) : null;
  return { key, family, scope, period: periodLow.toUpperCase(), direction, line, since: 'unregistered' };
}
