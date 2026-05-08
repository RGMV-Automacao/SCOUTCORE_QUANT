// Engine A — Poisson + Dixon-Coles light.
//
// Cobre nesta versão:
//   - GOLS total/home/away FT  (over/under linhas .5)
//   - GOLS total HT             (over/under) — usa scaling 0.40 do FT
//   - BTTS FT/HT
//   - 1X2 FT/HT
//   - ESCANTEIOS total/home/away FT + total/home/away HT (Poisson independente)
//   - CHUTES total/home/away FT (Poisson independente)
//   - CARTOES total/home/away FT  (Poisson, low confidence flag)
//   - FALTAS total FT             (Poisson, low confidence flag)
//
// Escanteios/Chutes/Cartões/Faltas: Poisson SEM Dixon-Coles (rho=0). λ vem de
// profile.avg_X (side-aware) e shrink suave para média da liga quando a amostra
// for pequena. Quando profile/prior faltarem, slot vai com certified=false.
//
// FORA do escopo:
//   - 2T derivado FT-HT (precisa skel separado, não confiável só por subtração).
//   - HT scope home/away para gols (scaling não confiável sem dados de bandas).

import { listMarkets, MARKETS_VERSION } from '@scoutcore/markets';
import { scoreMatrix, poissonPMF } from './poisson.mjs';

export const ENGINE_A_VERSION = '0.3.0';

const HT_SCALE_GOLS = 0.40;        // share típico de gols 1T
const RHO_DC   = -0.05;
const MAX_GOALS = 8;
const MAX_COUNT = 30;              // truncamento Poisson para escanteios/chutes/etc

// Heurística de share por família 1T/FT (literatura + observação prática).
const HT_SHARE = {
  escanteios: 0.42,
  chutes: 0.48,
  cartoes: 0.30,
  faltas: 0.50,
};

// Famílias com baixa aderência ao Poisson.
const LOW_CONFIDENCE_FAMILIES = new Set(['cartoes', 'faltas']);

/**
 * Calcula λ casa/fora a partir de team profiles + league prior (gols).
 */
export function computeLambdas({ profileHome, profileAway, priors, homeAdvantage = 1.10 }) {
  const leagueAvg = priors?.avg_goals_total ?? 2.6;
  const leagueHomePerTeam = leagueAvg / 2;

  const attH = (profileHome?.avg_gols_marcados ?? leagueHomePerTeam) / leagueHomePerTeam;
  const defA = (profileAway?.avg_gols_sofridos ?? leagueHomePerTeam) / leagueHomePerTeam;
  const attA = (profileAway?.avg_gols_marcados ?? leagueHomePerTeam) / leagueHomePerTeam;
  const defH = (profileHome?.avg_gols_sofridos ?? leagueHomePerTeam) / leagueHomePerTeam;

  const lambdaHome = leagueHomePerTeam * attH * defA * homeAdvantage;
  const lambdaAway = leagueHomePerTeam * attA * defH / homeAdvantage;
  return {
    lambdaHome,
    lambdaAway,
    inputs: { leagueAvg, attH, defA, attA, defH, homeAdvantage },
  };
}

/** Soma das probabilidades do score matrix onde (i+j) > line. */
function probTotalOver(matrix, line) {
  const M = matrix.length;
  let s = 0;
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
    if (i + j > line) s += matrix[i][j];
  }
  return s;
}
function probHomeOver(matrix, line) {
  const M = matrix.length;
  let s = 0;
  for (let i = 0; i < M; i++) {
    if (i > line) for (let j = 0; j < M; j++) s += matrix[i][j];
  }
  return s;
}
function probAwayOver(matrix, line) {
  const M = matrix.length;
  let s = 0;
  for (let j = 0; j < M; j++) {
    if (j > line) for (let i = 0; i < M; i++) s += matrix[i][j];
  }
  return s;
}
function probBTTS(matrix) {
  const M = matrix.length;
  let s = 0;
  for (let i = 1; i < M; i++) for (let j = 1; j < M; j++) s += matrix[i][j];
  return s;
}
function prob1X2(matrix) {
  const M = matrix.length;
  let h = 0, d = 0, a = 0;
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
    if (i > j) h += matrix[i][j];
    else if (i === j) d += matrix[i][j];
    else a += matrix[i][j];
  }
  return { home: h, draw: d, away: a };
}

/** Faz clipping numérico para evitar 0 ou 1 exatos. */
function clamp(p) { return Math.min(1 - 1e-6, Math.max(1e-6, p)); }

/** Vira slot a partir de (market, prob). */
function mkSlot(market, prob, certified, provenance = {}) {
  const p = clamp(prob);
  return {
    market_key: market.key,
    family: market.family,
    scope: market.scope,
    period: market.period,
    direction: market.direction,
    label: null,
    line: market.line ?? null,
    fair_prob_raw: p,
    fair_prob: p,
    fair_odd: 1 / p,
    market_odd: null,
    edge_pct: null,
    confidence: null,
    provenance,
    evidence: undefined,
    certified,
  };
}

/** Probabilidade Poisson(λ) > line semi-integer. */
function poissonProbOver(lambda, line) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  let cdf = 0;
  const k = Math.floor(line);
  for (let i = 0; i <= k && i <= MAX_COUNT; i++) cdf += poissonPMF(i, lambda);
  return Math.max(0, Math.min(1, 1 - cdf));
}

/**
 * Resolve λ_home e λ_away para uma família contagem usando profile side-aware
 * + shrink leve para média da liga.
 */
function resolveCountLambdas({ profileHome, profileAway, priors, key, leagueTotalKey }) {
  const leagueTotal = priors?.[leagueTotalKey] ?? null;
  const leaguePerTeam = leagueTotal != null ? leagueTotal / 2 : null;

  const lh = profileHome?.[key];
  const la = profileAway?.[key];

  let lambdaHome = lh ?? leaguePerTeam;
  let lambdaAway = la ?? leaguePerTeam;

  const nH = profileHome?.n_events ?? 0;
  const nA = profileAway?.n_events ?? 0;
  if (lh != null && leaguePerTeam != null && nH < 8) {
    lambdaHome = 0.5 * lh + 0.5 * leaguePerTeam;
  }
  if (la != null && leaguePerTeam != null && nA < 8) {
    lambdaAway = 0.5 * la + 0.5 * leaguePerTeam;
  }

  let used = 'profile';
  if (lh == null && la == null) used = 'prior';
  else if (lh == null || la == null) used = 'partial';

  return {
    lambdaHome: lambdaHome ?? null,
    lambdaAway: lambdaAway ?? null,
    used,
    n_events_home: nH,
    n_events_away: nA,
  };
}

/** Slots Poisson para uma família contagem.
 *  `lambdaMult` opcional vem da calibração EWMA (settler) e é aplicado
 *  ao lambda ANTES do cálculo de probabilidade. Simétrico para over/under
 *  por design: lambda é propriedade da contagem, não da direção. */
function predictCountFamily({ family, profileKey, leagueTotalKey, profileHome, profileAway, priors, lambdaMult = 1.0 }) {
  const out = [];
  const lambdas = resolveCountLambdas({
    profileHome, profileAway, priors, key: profileKey, leagueTotalKey,
  });
  if (lambdas.lambdaHome == null || lambdas.lambdaAway == null) {
    for (const m of listMarkets({ family })) {
      if (m.line == null) continue;
      out.push(mkSlot(m, 0.5, false, {
        engine: 'A', family, reason: 'insufficient_inputs', used: lambdas.used,
      }));
    }
    return out;
  }

  const lambdaTotalFT = (lambdas.lambdaHome + lambdas.lambdaAway) * lambdaMult;
  const htShare = HT_SHARE[family] ?? 0.4;
  const lambdaHomeHT = lambdas.lambdaHome * lambdaMult * htShare;
  const lambdaAwayHT = lambdas.lambdaAway * lambdaMult * htShare;
  const lambdaTotalHT = lambdaTotalFT * htShare;
  const lambdaHomeFT = lambdas.lambdaHome * lambdaMult;
  const lambdaAwayFT = lambdas.lambdaAway * lambdaMult;

  const provBase = {
    engine: 'A',
    family,
    lambda_home: lambdas.lambdaHome,
    lambda_away: lambdas.lambdaAway,
    lambda_mult: lambdaMult,
    n_events_home: lambdas.n_events_home,
    n_events_away: lambdas.n_events_away,
    used: lambdas.used,
    ...(LOW_CONFIDENCE_FAMILIES.has(family) ? { low_confidence_family: true } : {}),
  };

  for (const m of listMarkets({ family })) {
    if (m.line == null) continue;
    let lambda;
    if (m.period === 'FT') {
      if (m.scope === 'total') lambda = lambdaTotalFT;
      else if (m.scope === 'home') lambda = lambdaHomeFT;
      else if (m.scope === 'away') lambda = lambdaAwayFT;
    } else if (m.period === 'HT') {
      if (m.scope === 'total') lambda = lambdaTotalHT;
      else if (m.scope === 'home') lambda = lambdaHomeHT;
      else if (m.scope === 'away') lambda = lambdaAwayHT;
    }
    if (lambda == null) continue;
    const pOver = poissonProbOver(lambda, m.line);
    const p = m.direction === 'over' ? pOver : (1 - pOver);
    const prov = {
      ...provBase,
      lambda_for_slot: lambda,
      ...(m.period === 'HT' ? { period_scaling: htShare } : {}),
    };
    out.push(mkSlot(m, p, true, prov));
  }
  return out;
}

/**
 * Predict do Engine A.
 *
 * @param {object} ctx
 * @param {object} [ctx.calibration] — opcional. Map de calibração por família
 *   contagem: { escanteios?: { lambda_mult: number }, chutes?, cartoes?, faltas? }.
 *   Quando ausente, lambda_mult=1.0 (no-op). Aplicado APENAS em count families;
 *   gols/btts/1x2 (matrix conjunta) não recebem lambda assimétrico para preservar
 *   coerência sim/nao e home/draw/away.
 */
export function predict(ctx) {
  const { lambdaHome, lambdaAway, inputs } = computeLambdas(ctx);
  const matrixFT = scoreMatrix(lambdaHome, lambdaAway, { maxGoals: MAX_GOALS, rho: RHO_DC });
  const matrixHT = scoreMatrix(lambdaHome * HT_SCALE_GOLS, lambdaAway * HT_SCALE_GOLS, { maxGoals: MAX_GOALS, rho: RHO_DC });

  const calib = ctx.calibration ?? {};
  const lm = (family) => Number(calib[family]?.lambda_mult ?? 1.0);

  const slots = [];
  const provBaseGoals = {
    engine: 'A', family: 'gols',
    lambda_home: lambdaHome, lambda_away: lambdaAway,
    ...inputs,
  };

  // GOLS over/under — total/home/away FT
  for (const m of listMarkets({ family: 'gols', period: 'FT' })) {
    if (m.line == null) continue;
    let pOver;
    if (m.scope === 'total')      pOver = probTotalOver(matrixFT, m.line);
    else if (m.scope === 'home')  pOver = probHomeOver(matrixFT, m.line);
    else if (m.scope === 'away')  pOver = probAwayOver(matrixFT, m.line);
    if (pOver == null) continue;
    const p = m.direction === 'over' ? pOver : (1 - pOver);
    slots.push(mkSlot(m, p, true, { ...provBaseGoals, period_scaling: 1.0 }));
  }

  // GOLS over/under — total HT
  for (const m of listMarkets({ family: 'gols', period: 'HT', scope: 'total' })) {
    if (m.line == null) continue;
    const pOver = probTotalOver(matrixHT, m.line);
    const p = m.direction === 'over' ? pOver : (1 - pOver);
    slots.push(mkSlot(m, p, true, { ...provBaseGoals, period_scaling: HT_SCALE_GOLS }));
  }

  // BTTS FT
  const pBTTS_FT = probBTTS(matrixFT);
  for (const m of listMarkets({ family: 'btts', period: 'FT' })) {
    const p = m.direction === 'sim' ? pBTTS_FT : (1 - pBTTS_FT);
    slots.push(mkSlot(m, p, true, { ...provBaseGoals, family: 'btts' }));
  }

  // BTTS HT
  const pBTTS_HT = probBTTS(matrixHT);
  for (const m of listMarkets({ family: 'btts', period: 'HT' })) {
    const p = m.direction === 'sim' ? pBTTS_HT : (1 - pBTTS_HT);
    slots.push(mkSlot(m, p, true, { ...provBaseGoals, family: 'btts', period_scaling: HT_SCALE_GOLS }));
  }

  // 1X2 FT/HT
  const x2_FT = prob1X2(matrixFT);
  for (const m of listMarkets({ family: '1x2', period: 'FT' })) {
    slots.push(mkSlot(m, x2_FT[m.direction], true, { ...provBaseGoals, family: '1x2' }));
  }
  const x2_HT = prob1X2(matrixHT);
  for (const m of listMarkets({ family: '1x2', period: 'HT' })) {
    slots.push(mkSlot(m, x2_HT[m.direction], true, { ...provBaseGoals, family: '1x2', period_scaling: HT_SCALE_GOLS }));
  }

  // ESCANTEIOS — total/home/away FT + HT
  slots.push(...predictCountFamily({
    family: 'escanteios',
    profileKey: 'avg_escanteios',
    leagueTotalKey: 'avg_escanteios_total',
    profileHome: ctx.profileHome,
    profileAway: ctx.profileAway,
    priors: ctx.priors,
    lambdaMult: lm('escanteios'),
  }));

  // CHUTES — total/home/away FT
  slots.push(...predictCountFamily({
    family: 'chutes',
    profileKey: 'avg_chutes',
    leagueTotalKey: 'avg_chutes_total',
    profileHome: ctx.profileHome,
    profileAway: ctx.profileAway,
    priors: ctx.priors,
    lambdaMult: lm('chutes'),
  }));

  // CARTOES — total/home/away FT (low confidence)
  // Proxy: avg_cartoes_amarelos. Cartões vermelhos diluem em ruído.
  slots.push(...predictCountFamily({
    family: 'cartoes',
    profileKey: 'avg_cartoes_amarelos',
    leagueTotalKey: 'avg_cartoes_total',
    profileHome: ctx.profileHome,
    profileAway: ctx.profileAway,
    priors: ctx.priors,
    lambdaMult: lm('cartoes'),
  }));

  // FALTAS — total FT (low confidence)
  slots.push(...predictCountFamily({
    family: 'faltas',
    profileKey: 'avg_faltas_cometidas',
    leagueTotalKey: 'avg_faltas_total',
    profileHome: ctx.profileHome,
    profileAway: ctx.profileAway,
    priors: ctx.priors,
    lambdaMult: lm('faltas'),
  }));

  return {
    slots,
    lambdas: { lambdaHome, lambdaAway, inputs },
    version: ENGINE_A_VERSION,
    markets_catalog_version: MARKETS_VERSION,
  };
}

/** Famílias cobertas pela versão atual do Engine A. */
export function coveredFamilies() {
  return [
    { family: 'gols',        scope: 'total', period: 'FT' },
    { family: 'gols',        scope: 'home',  period: 'FT' },
    { family: 'gols',        scope: 'away',  period: 'FT' },
    { family: 'gols',        scope: 'total', period: 'HT' },
    { family: 'btts',        scope: 'total', period: 'FT' },
    { family: 'btts',        scope: 'total', period: 'HT' },
    { family: '1x2',         scope: 'total', period: 'FT' },
    { family: '1x2',         scope: 'total', period: 'HT' },
    { family: 'escanteios',  scope: 'total', period: 'FT' },
    { family: 'escanteios',  scope: 'home',  period: 'FT' },
    { family: 'escanteios',  scope: 'away',  period: 'FT' },
    { family: 'escanteios',  scope: 'total', period: 'HT' },
    { family: 'escanteios',  scope: 'home',  period: 'HT' },
    { family: 'escanteios',  scope: 'away',  period: 'HT' },
    { family: 'chutes',      scope: 'total', period: 'FT' },
    { family: 'chutes',      scope: 'home',  period: 'FT' },
    { family: 'chutes',      scope: 'away',  period: 'FT' },
    { family: 'cartoes',     scope: 'total', period: 'FT', low_confidence: true },
    { family: 'cartoes',     scope: 'home',  period: 'FT', low_confidence: true },
    { family: 'cartoes',     scope: 'away',  period: 'FT', low_confidence: true },
    { family: 'faltas',      scope: 'total', period: 'FT', low_confidence: true },
  ];
}
