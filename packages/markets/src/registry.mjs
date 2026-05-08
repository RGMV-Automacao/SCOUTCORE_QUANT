// @scoutcore/markets/registry — catálogo canônico de mercados.
//
// Convenção de market_key (canônica, ascii kebab):
//   <familia>_<scope>_<period>_<direction>[_<line>]
// Exemplos:
//   gols_total_ft_over_2_5
//   btts_total_ft_sim
//   1x2_total_ft_home
//   dupla_total_ft_1x
//   dnb_total_ft_home
//   correct_score_total_ft_2_1
//   htft_total_full_1_1
//   margem_total_ft_home_1
//   marca_primeiro_total_ft_home
//   handicap_total_ft_home_minus_1
//   asian_handicap_total_ft_home_minus_0_5
//   asian_total_total_ft_over_2_25
//   race_total_ft_home_3
//   exato_total_ft_2
//   escanteios_total_ft_over_9_5
//   escanteios_1x2_total_ft_home
//   chutes_alvo_total_ft_over_3_5
//   cartoes_total_ft_over_3_5
//   faltas_home_ft_over_10_5
//   impedimentos_total_ft_over_2_5
//
// Princípio P9 do MOTOR4x4_SPEC: nenhum mercado é vetado pelo motor.
// Aqui registramos o universo. Engine A deriva via Poisson bivariado,
// Engine B treina nas famílias-base e o resto sai por derivação.

const _seed = [];

function reg(entry) { _seed.push(entry); }

function regOverUnder({ family, scope, period, lines, since = '1.0.0' }) {
  for (const ln of lines) {
    const tag = String(ln).replace('.', '_');
    reg({ key: `${family}_${scope}_${period.toLowerCase()}_over_${tag}`,  family, scope, period, direction: 'over',  line: ln, since });
    reg({ key: `${family}_${scope}_${period.toLowerCase()}_under_${tag}`, family, scope, period, direction: 'under', line: ln, since });
  }
}

// ─────────────────────────────────────────────
// GOLS
// ─────────────────────────────────────────────
regOverUnder({ family: 'gols', scope: 'total', period: 'FT', lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'gols', scope: 'total', period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'total', period: '2T', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'gols', scope: 'home',  period: 'HT', lines: [0.5, 1.5] });
regOverUnder({ family: 'gols', scope: 'away',  period: 'HT', lines: [0.5, 1.5] });

// Asiáticos (.25 / .75) — payout fracionado, mas probabilidade derivável
regOverUnder({ family: 'asian_total', scope: 'total', period: 'FT', lines: [1.25, 1.75, 2.25, 2.75, 3.25, 3.75] });
regOverUnder({ family: 'asian_total', scope: 'total', period: 'HT', lines: [0.75, 1.25, 1.75] });

// ─────────────────────────────────────────────
// BTTS
// ─────────────────────────────────────────────
for (const period of ['FT', 'HT']) {
  for (const dir of ['sim', 'nao']) {
    reg({ key: `btts_total_${period.toLowerCase()}_${dir}`, family: 'btts', scope: 'total', period, direction: dir, line: null, since: '1.0.0' });
  }
}
// BTTS - ambos os tempos / pelo menos um tempo
reg({ key: 'btts_ambos_tempos_sim', family: 'btts_ambos_tempos', scope: 'total', period: 'FULL', direction: 'sim', line: null, since: '1.0.0' });
reg({ key: 'btts_ambos_tempos_nao', family: 'btts_ambos_tempos', scope: 'total', period: 'FULL', direction: 'nao', line: null, since: '1.0.0' });
reg({ key: 'btts_algum_tempo_sim',  family: 'btts_algum_tempo',  scope: 'total', period: 'FULL', direction: 'sim', line: null, since: '1.0.0' });
reg({ key: 'btts_algum_tempo_nao',  family: 'btts_algum_tempo',  scope: 'total', period: 'FULL', direction: 'nao', line: null, since: '1.0.0' });

// ─────────────────────────────────────────────
// 1X2 / Dupla Chance / DNB
// ─────────────────────────────────────────────
for (const period of ['FT', 'HT', '2T']) {
  for (const dir of ['home', 'draw', 'away']) {
    reg({ key: `1x2_total_${period.toLowerCase()}_${dir}`, family: '1x2', scope: 'total', period, direction: dir, line: null, since: '1.0.0' });
  }
  for (const dir of ['1x', '12', 'x2']) {
    reg({ key: `dupla_total_${period.toLowerCase()}_${dir}`, family: 'dupla', scope: 'total', period, direction: dir, line: null, since: '1.0.0' });
  }
  for (const dir of ['home', 'away']) {
    reg({ key: `dnb_total_${period.toLowerCase()}_${dir}`, family: 'dnb', scope: 'total', period, direction: dir, line: null, since: '1.0.0' });
  }
}

// ─────────────────────────────────────────────
// HT/FT (intervalo / final)
// ─────────────────────────────────────────────
for (const a of ['1', 'x', '2']) {
  for (const b of ['1', 'x', '2']) {
    reg({ key: `htft_total_full_${a}_${b}`, family: 'htft', scope: 'total', period: 'FULL', direction: `${a}_${b}`, line: null, since: '1.0.0' });
  }
}

// ─────────────────────────────────────────────
// Correct Score (resultado exato) FT e HT
// ─────────────────────────────────────────────
const SCORE_GRID_FT = [];
for (let h = 0; h <= 4; h++) for (let a = 0; a <= 4; a++) SCORE_GRID_FT.push([h, a]);
for (const [h, a] of SCORE_GRID_FT) {
  reg({ key: `correct_score_total_ft_${h}_${a}`, family: 'correct_score', scope: 'total', period: 'FT', direction: `${h}_${a}`, line: null, since: '1.0.0' });
}
reg({ key: 'correct_score_total_ft_other_home', family: 'correct_score', scope: 'total', period: 'FT', direction: 'other_home', line: null, since: '1.0.0' });
reg({ key: 'correct_score_total_ft_other_draw', family: 'correct_score', scope: 'total', period: 'FT', direction: 'other_draw', line: null, since: '1.0.0' });
reg({ key: 'correct_score_total_ft_other_away', family: 'correct_score', scope: 'total', period: 'FT', direction: 'other_away', line: null, since: '1.0.0' });

const SCORE_GRID_HT = [];
for (let h = 0; h <= 2; h++) for (let a = 0; a <= 2; a++) SCORE_GRID_HT.push([h, a]);
for (const [h, a] of SCORE_GRID_HT) {
  reg({ key: `correct_score_total_ht_${h}_${a}`, family: 'correct_score', scope: 'total', period: 'HT', direction: `${h}_${a}`, line: null, since: '1.0.0' });
}
reg({ key: 'correct_score_total_ht_other', family: 'correct_score', scope: 'total', period: 'HT', direction: 'other', line: null, since: '1.0.0' });

// ─────────────────────────────────────────────
// Margem de vitória
// ─────────────────────────────────────────────
for (const lado of ['home', 'away']) {
  for (const m of [1, 2, 3]) reg({ key: `margem_total_ft_${lado}_${m}`, family: 'margem', scope: 'total', period: 'FT', direction: `${lado}_${m}`, line: m, since: '1.0.0' });
  reg({ key: `margem_total_ft_${lado}_4_plus`, family: 'margem', scope: 'total', period: 'FT', direction: `${lado}_4_plus`, line: 4, since: '1.0.0' });
}
reg({ key: 'margem_total_ft_draw', family: 'margem', scope: 'total', period: 'FT', direction: 'draw', line: 0, since: '1.0.0' });

// ─────────────────────────────────────────────
// Marca primeiro / Marca último / Marca em algum momento
// ─────────────────────────────────────────────
for (const dir of ['home', 'away', 'none']) {
  reg({ key: `marca_primeiro_total_ft_${dir}`, family: 'marca_primeiro', scope: 'total', period: 'FT', direction: dir, line: null, since: '1.0.0' });
  reg({ key: `marca_ultimo_total_ft_${dir}`,   family: 'marca_ultimo',   scope: 'total', period: 'FT', direction: dir, line: null, since: '1.0.0' });
}
for (const lado of ['home', 'away']) {
  reg({ key: `marca_total_ft_${lado}_sim`, family: 'marca', scope: 'total', period: 'FT', direction: `${lado}_sim`, line: null, since: '1.0.0' });
  reg({ key: `marca_total_ft_${lado}_nao`, family: 'marca', scope: 'total', period: 'FT', direction: `${lado}_nao`, line: null, since: '1.0.0' });
}

// ─────────────────────────────────────────────
// Handicap europeu (resultado com h ∈ {-2,-1,+1,+2} para casa)
// ─────────────────────────────────────────────
for (const h of [-2, -1, +1, +2]) {
  for (const dir of ['home', 'draw', 'away']) {
    const tag = `${dir}_${h < 0 ? 'minus_' + Math.abs(h) : 'plus_' + h}`;
    reg({ key: `handicap_total_ft_${tag}`, family: 'handicap', scope: 'total', period: 'FT', direction: tag, line: h, since: '1.0.0' });
  }
}

// Handicap asiático (linhas .5 e inteiras) — payout simplificado fica no settle
for (const h of [-2, -1.5, -1, -0.5, +0.5, +1, +1.5, +2]) {
  for (const lado of ['home', 'away']) {
    const tag = `${lado}_${h < 0 ? 'minus_' + String(Math.abs(h)).replace('.', '_') : 'plus_' + String(h).replace('.', '_')}`;
    reg({ key: `asian_handicap_total_ft_${tag}`, family: 'asian_handicap', scope: 'total', period: 'FT', direction: tag, line: h, since: '1.0.0' });
  }
}

// ─────────────────────────────────────────────
// ESCANTEIOS — over/under expandido + 1x2 + race + exato
// ─────────────────────────────────────────────
regOverUnder({ family: 'escanteios', scope: 'total', period: 'FT', lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5, 14.5] });
regOverUnder({ family: 'escanteios', scope: 'total', period: 'HT', lines: [2.5, 3.5, 4.5, 5.5, 6.5] });
regOverUnder({ family: 'escanteios', scope: 'home',  period: 'FT', lines: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'escanteios', scope: 'away',  period: 'FT', lines: [2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'escanteios', scope: 'home',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5, 4.5] });
regOverUnder({ family: 'escanteios', scope: 'away',  period: 'HT', lines: [0.5, 1.5, 2.5, 3.5, 4.5] });

regOverUnder({ family: 'escanteios_asian', scope: 'total', period: 'FT', lines: [8.25, 8.75, 9.25, 9.75, 10.25, 10.75] });

for (const dir of ['home', 'draw', 'away']) {
  reg({ key: `escanteios_1x2_total_ft_${dir}`, family: 'escanteios_1x2', scope: 'total', period: 'FT', direction: dir, line: null, since: '1.0.0' });
  reg({ key: `escanteios_1x2_total_ht_${dir}`, family: 'escanteios_1x2', scope: 'total', period: 'HT', direction: dir, line: null, since: '1.0.0' });
}
// Race (qual time atinge primeiro N escanteios)
for (const n of [3, 5, 7]) {
  for (const dir of ['home', 'away', 'none']) {
    reg({ key: `escanteios_race_total_ft_${dir}_${n}`, family: 'escanteios_race', scope: 'total', period: 'FT', direction: dir, line: n, since: '1.0.0' });
  }
}
// Exato (faixas)
for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
  reg({ key: `escanteios_exato_total_ft_${n}`, family: 'escanteios_exato', scope: 'total', period: 'FT', direction: `eq_${n}`, line: n, since: '1.0.0' });
}
reg({ key: 'escanteios_exato_total_ft_15_plus', family: 'escanteios_exato', scope: 'total', period: 'FT', direction: 'eq_15_plus', line: 15, since: '1.0.0' });

// ─────────────────────────────────────────────
// CHUTES (todos) — total/home/away FT + HT
// ─────────────────────────────────────────────
regOverUnder({ family: 'chutes', scope: 'total', period: 'FT', lines: [9.5, 11.5, 13.5, 15.5, 17.5, 19.5, 21.5, 23.5, 24.5, 25.5, 26.5, 27.5, 28.5, 29.5, 30.5] });
regOverUnder({ family: 'chutes', scope: 'home',  period: 'FT', lines: [4.5, 6.5, 8.5, 10.5, 12.5, 13.5, 14.5, 15.5] });
regOverUnder({ family: 'chutes', scope: 'away',  period: 'FT', lines: [4.5, 6.5, 8.5, 10.5, 12.5, 13.5, 14.5, 15.5] });
regOverUnder({ family: 'chutes', scope: 'total', period: 'HT', lines: [4.5, 5.5, 6.5, 7.5, 8.5] });
regOverUnder({ family: 'chutes', scope: 'home',  period: 'HT', lines: [2.5, 3.5, 4.5, 5.5] });
regOverUnder({ family: 'chutes', scope: 'away',  period: 'HT', lines: [2.5, 3.5, 4.5, 5.5] });

// ─────────────────────────────────────────────
// CHUTES NO GOL (chutes_alvo) — separado de chutes
// ─────────────────────────────────────────────
regOverUnder({ family: 'chutes_alvo', scope: 'total', period: 'FT', lines: [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'home',  period: 'FT', lines: [1.5, 2.5, 3.5, 4.5, 5.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'away',  period: 'FT', lines: [1.5, 2.5, 3.5, 4.5, 5.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'total', period: 'HT', lines: [2.5, 3.5, 4.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'home',  period: 'HT', lines: [0.5, 1.5, 2.5] });
regOverUnder({ family: 'chutes_alvo', scope: 'away',  period: 'HT', lines: [0.5, 1.5, 2.5] });

// ─────────────────────────────────────────────
// CARTOES — expandido
// ─────────────────────────────────────────────
regOverUnder({ family: 'cartoes', scope: 'total', period: 'FT', lines: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5] });
regOverUnder({ family: 'cartoes', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'cartoes', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'cartoes', scope: 'total', period: 'HT', lines: [0.5, 1.5, 2.5, 3.5] });
regOverUnder({ family: 'cartoes', scope: 'home',  period: 'HT', lines: [0.5, 1.5] });
regOverUnder({ family: 'cartoes', scope: 'away',  period: 'HT', lines: [0.5, 1.5] });
for (const dir of ['home', 'draw', 'away']) {
  reg({ key: `cartoes_1x2_total_ft_${dir}`, family: 'cartoes_1x2', scope: 'total', period: 'FT', direction: dir, line: null, since: '1.0.0' });
}

// ─────────────────────────────────────────────
// FALTAS — expandido
// ─────────────────────────────────────────────
regOverUnder({ family: 'faltas', scope: 'total', period: 'FT', lines: [17.5, 19.5, 21.5, 23.5, 25.5, 27.5] });
regOverUnder({ family: 'faltas', scope: 'home',  period: 'FT', lines: [8.5, 10.5, 12.5, 14.5] });
regOverUnder({ family: 'faltas', scope: 'away',  period: 'FT', lines: [8.5, 10.5, 12.5, 14.5] });

// ─────────────────────────────────────────────
// IMPEDIMENTOS
// ─────────────────────────────────────────────
regOverUnder({ family: 'impedimentos', scope: 'total', period: 'FT', lines: [2.5, 3.5, 4.5, 5.5] });
regOverUnder({ family: 'impedimentos', scope: 'home',  period: 'FT', lines: [0.5, 1.5, 2.5] });
regOverUnder({ family: 'impedimentos', scope: 'away',  period: 'FT', lines: [0.5, 1.5, 2.5] });

// ─────────────────────────────────────────────
// DEFESAS DO GOLEIRO
// ─────────────────────────────────────────────
regOverUnder({ family: 'defesas', scope: 'total', period: 'FT', lines: [4.5, 5.5, 6.5, 7.5, 8.5] });
regOverUnder({ family: 'defesas', scope: 'home',  period: 'FT', lines: [1.5, 2.5, 3.5, 4.5] });
regOverUnder({ family: 'defesas', scope: 'away',  period: 'FT', lines: [1.5, 2.5, 3.5, 4.5] });

// ────────── Index/exports ──────────

const _byKey = new Map(_seed.map((m) => [m.key, m]));

export const MARKETS_VERSION = '1.1.0';
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
  const m = /^([a-z0-9_]+?)_(total|home|away)_(ft|ht|2t|full)_([a-z0-9_]+?)(?:_(\d+(?:_\d+)?))?$/.exec(key);
  if (!m) return null;
  const [, family, scope, periodLow, direction, lineRaw] = m;
  const line = lineRaw ? Number(lineRaw.replace('_', '.')) : null;
  return { key, family, scope, period: periodLow.toUpperCase(), direction, line, since: 'unregistered' };
}
