// @scoutcore/markets/registry — catálogo canônico de mercados.
//
// Convenção de market_key (canônica, ascii kebab):
//   <familia>_<scope>_<period>_<direction>[_<line>]
// Exemplos:
//   gols_total_ft_over_2_5
//   gols_home_ht_over_0_5
//   btts_total_ft_sim
//   1x2_total_ft_home
//   escanteios_total_ft_over_9_5
//   escanteios_home_ft_over_4_5
//   chutes_alvo_total_ht_over_3_5         (família = chutes_alvo)
//   cartoes_total_ft_over_3_5
//
// SPEC §15: this registry feeds GET /v1/markets and is the source of truth
// para validar request.market_alias_map e para o settle().

const _seed = [];

function reg(entry) { _seed.push(entry); }

// Helper para gerar over/under com várias linhas.
function regOverUnder({ family, scope, period, lines, since = '1.0.0' }) {
  for (const ln of lines) {
    const k = `${family}_${scope}_${period.toLowerCase()}_over_${String(ln).replace('.', '_')}`;
    reg({ key: k, family, scope, period, direction: 'over', line: ln, since });
    const k2 = `${family}_${scope}_${period.toLowerCase()}_under_${String(ln).replace('.', '_')}`;
    reg({ key: k2, family, scope, period, direction: 'under', line: ln, since });
  }
}

// ── GOLS ──────────────────────────────────────────────
regOverUnder({ family: 'gols', scope: 'total', period: 'FT', lines: [0.5, 1.5, 2.5, 3.5, 4.5] });
regOverUnder({ family: 'gols', scope: 'total', period: 'HT', lines: [0.5, 1.5, 2.5] });
regOverUnder({ family: 'gols', scope: 'total', period: '2T', lines: [0.5, 1.5, 2.5] });
regOverUnder({ family: 'gols', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5] });
regOverUnder({ family: 'gols', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5] });
regOverUnder({ family: 'gols', scope: 'home',  period: 'HT', lines: [0.5, 1.5] });
regOverUnder({ family: 'gols', scope: 'away',  period: 'HT', lines: [0.5, 1.5] });

// ── BTTS ──────────────────────────────────────────────
reg({ key: 'btts_total_ft_sim', family: 'btts', scope: 'total', period: 'FT', direction: 'sim', line: null, since: '1.0.0' });
reg({ key: 'btts_total_ft_nao', family: 'btts', scope: 'total', period: 'FT', direction: 'nao', line: null, since: '1.0.0' });
reg({ key: 'btts_total_ht_sim', family: 'btts', scope: 'total', period: 'HT', direction: 'sim', line: null, since: '1.0.0' });
reg({ key: 'btts_total_ht_nao', family: 'btts', scope: 'total', period: 'HT', direction: 'nao', line: null, since: '1.0.0' });

// ── 1X2 ───────────────────────────────────────────────
for (const period of ['FT', 'HT']) {
  for (const dir of ['home', 'draw', 'away']) {
    reg({ key: `1x2_total_${period.toLowerCase()}_${dir}`, family: '1x2', scope: 'total', period, direction: dir, line: null, since: '1.0.0' });
  }
}

// ── ESCANTEIOS ────────────────────────────────────────
regOverUnder({ family: 'escanteios', scope: 'total', period: 'FT', lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5] });
regOverUnder({ family: 'escanteios', scope: 'total', period: 'HT', lines: [3.5, 4.5, 5.5] });
regOverUnder({ family: 'escanteios', scope: 'home',  period: 'FT', lines: [3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'escanteios', scope: 'away',  period: 'FT', lines: [3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'escanteios', scope: 'home',  period: 'HT', lines: [1.5, 2.5, 3.5] });
regOverUnder({ family: 'escanteios', scope: 'away',  period: 'HT', lines: [1.5, 2.5, 3.5] });

// ── CHUTES ────────────────────────────────────────────
regOverUnder({ family: 'chutes', scope: 'total', period: 'FT', lines: [19.5, 21.5, 23.5, 25.5] });
regOverUnder({ family: 'chutes', scope: 'home',  period: 'FT', lines: [9.5, 11.5, 13.5] });
regOverUnder({ family: 'chutes', scope: 'away',  period: 'FT', lines: [9.5, 11.5, 13.5] });

// ── CARTOES ───────────────────────────────────────────
regOverUnder({ family: 'cartoes', scope: 'total', period: 'FT', lines: [2.5, 3.5, 4.5, 5.5] });
regOverUnder({ family: 'cartoes', scope: 'home',  period: 'FT', lines: [1.5, 2.5] });
regOverUnder({ family: 'cartoes', scope: 'away',  period: 'FT', lines: [1.5, 2.5] });

// ── FALTAS ────────────────────────────────────────────
regOverUnder({ family: 'faltas', scope: 'total', period: 'FT', lines: [21.5, 23.5, 25.5] });

// ────────── Index/exports ──────────

const _byKey = new Map(_seed.map((m) => [m.key, m]));

export const MARKETS_VERSION = '1.0.0';
export const MARKETS = _seed.slice();

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
  // best-effort parse para chaves não registradas (extensão futura)
  const m = /^([a-z0-9]+)_([a-z]+)_([a-z0-9]+)_([a-z]+)(?:_(\d+(?:_\d+)?))?$/.exec(key);
  if (!m) return null;
  const [, family, scope, periodLow, direction, lineRaw] = m;
  const line = lineRaw ? Number(lineRaw.replace('_', '.')) : null;
  return { key, family, scope, period: periodLow.toUpperCase(), direction, line, since: 'unregistered' };
}
