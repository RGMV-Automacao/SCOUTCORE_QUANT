// Engine A — Poisson + Dixon-Coles light.
//
// Cobre nesta versão:
//   - GOLS total/home/away FT  (over/under linhas .5)
//   - GOLS total/home/away HT   (over/under) — usa scaling 0.40 do FT
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
//   - Gols HT por equipe usa scaling global conservador; confidence/QG deve tratar como mais fraco.

import { safeParse, EngineAContextZ } from '@scoutcore/contracts';
import { listMarkets, MARKETS_VERSION } from '@scoutcore/markets';
import { scoreMatrix, poissonPMF } from './poisson.mjs';

export const ENGINE_A_VERSION = '0.4.0';

const HT_SCALE_GOLS = 0.40;        // share típico de gols 1T
const RHO_DC   = -0.05;
const MAX_GOALS = 12;              // amplia para suportar over_5_5 / over_6_5 / over_7_5
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

function validatePredictContext(ctx) {
  const parsed = safeParse(EngineAContextZ, ctx);
  if (!parsed.ok) {
    const summary = parsed.errors
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'root'}:${issue.message}`)
      .join('|');
    throw new Error(`engine_a_invalid_context:${summary}`);
  }
  return parsed.value;
}

/**
 * Calcula λ casa/fora a partir de team profiles + league prior (gols).
 */
export function computeLambdas({ profileHome, profileAway, priors, homeAdvantage = 1.10 }) {
  if (!Number.isFinite(priors?.avg_goals_total)) {
    throw new Error('engine_a_missing_priors:avg_goals_total');
  }
  if (!Number.isFinite(profileHome?.avg_gols_marcados) || !Number.isFinite(profileHome?.avg_gols_sofridos)) {
    throw new Error('engine_a_missing_profile_home');
  }
  if (!Number.isFinite(profileAway?.avg_gols_marcados) || !Number.isFinite(profileAway?.avg_gols_sofridos)) {
    throw new Error('engine_a_missing_profile_away');
  }
  const leagueAvg = priors.avg_goals_total;
  const leagueHomePerTeam = leagueAvg / 2;

  const attH = profileHome.avg_gols_marcados / leagueHomePerTeam;
  const defA = profileAway.avg_gols_sofridos / leagueHomePerTeam;
  const attA = profileAway.avg_gols_marcados / leagueHomePerTeam;
  const defH = profileHome.avg_gols_sofridos / leagueHomePerTeam;

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
    // Insufficient inputs — não fabrica fair_prob. Família é omitida do output.
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
  const validatedCtx = validatePredictContext(ctx);
  const { profileHome, profileAway, priors, calibration = {} } = validatedCtx;
  const { lambdaHome, lambdaAway, inputs } = computeLambdas(validatedCtx);
  const matrixFT = scoreMatrix(lambdaHome, lambdaAway, { maxGoals: MAX_GOALS, rho: RHO_DC });
  const matrixHT = scoreMatrix(lambdaHome * HT_SCALE_GOLS, lambdaAway * HT_SCALE_GOLS, { maxGoals: MAX_GOALS, rho: RHO_DC });
  // Matriz 2T (segundo tempo) = matriz com lambdas reduzidos por 1-share
  const matrix2T = scoreMatrix(lambdaHome * (1 - HT_SCALE_GOLS), lambdaAway * (1 - HT_SCALE_GOLS), { maxGoals: MAX_GOALS, rho: RHO_DC });

  const calib = calibration;
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

  // GOLS over/under — home/away HT (aprox. por matrix HT escalada)
  for (const scope of ['home', 'away']) {
    for (const m of listMarkets({ family: 'gols', period: 'HT', scope })) {
      if (m.line == null) continue;
      const pOver = scope === 'home' ? probHomeOver(matrixHT, m.line) : probAwayOver(matrixHT, m.line);
      const p = m.direction === 'over' ? pOver : (1 - pOver);
      slots.push(mkSlot(m, p, true, { ...provBaseGoals, period_scaling: HT_SCALE_GOLS, ht_team_goal_approx: true }));
    }
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
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('escanteios'),
  }));

  // CHUTES — total/home/away FT
  slots.push(...predictCountFamily({
    family: 'chutes',
    profileKey: 'avg_chutes',
    leagueTotalKey: 'avg_chutes_total',
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('chutes'),
  }));

  // CARTOES — total/home/away FT (low confidence)
  // Proxy: avg_cartoes_amarelos. Cartões vermelhos diluem em ruído.
  slots.push(...predictCountFamily({
    family: 'cartoes',
    profileKey: 'avg_cartoes_amarelos',
    leagueTotalKey: 'avg_cartoes_total',
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('cartoes'),
  }));

  // FALTAS — total FT (low confidence)
  slots.push(...predictCountFamily({
    family: 'faltas',
    profileKey: 'avg_faltas_cometidas',
    leagueTotalKey: 'avg_faltas_total',
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('faltas'),
  }));

  // ─────────────────────────────────────────────
  // Derivações Poisson bivariado (gratuitas — usam matrixFT/HT/2T já calculados)
  // ─────────────────────────────────────────────
  slots.push(...derive2T(matrix2T, provBaseGoals));
  slots.push(...deriveDuplaChance(matrixFT, matrixHT, provBaseGoals));
  slots.push(...deriveGolsOddEven(matrixFT, matrixHT, provBaseGoals));

  // Famílias contagem auxiliares (Poisson independente por equipe)
  slots.push(...deriveCountAuxiliary({
    family: 'escanteios', profileKey: 'avg_escanteios', leagueTotalKey: 'avg_escanteios_total',
    profileHome, profileAway, priors, lambdaMult: lm('escanteios'),
  }));
  slots.push(...deriveCountAuxiliary({
    family: 'chutes', profileKey: 'avg_chutes', leagueTotalKey: 'avg_chutes_total',
    profileHome, profileAway, priors, lambdaMult: lm('chutes'),
  }));
  slots.push(...deriveCountAuxiliary({
    family: 'chutes_alvo', profileKey: 'avg_chutes_alvo', leagueTotalKey: 'avg_chutes_alvo_total',
    profileHome, profileAway, priors, lambdaMult: lm('chutes_alvo'),
  }));
  slots.push(...deriveCountAuxiliary({
    family: 'cartoes', profileKey: 'avg_cartoes_amarelos', leagueTotalKey: 'avg_cartoes_total',
    profileHome, profileAway, priors, lambdaMult: lm('cartoes'),
    lowConfidence: true,
  }));

  // Chutes no gol (separado de chutes), impedimentos, defesas e desarmes — Poisson básico
  slots.push(...predictCountFamily({
    family: 'chutes_alvo',
    profileKey: 'avg_chutes_alvo',
    leagueTotalKey: 'avg_chutes_alvo_total',
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('chutes_alvo'),
  }));
  slots.push(...predictCountFamily({
    family: 'impedimentos',
    profileKey: 'avg_impedimentos',
    leagueTotalKey: 'avg_impedimentos_total',
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('impedimentos'),
  }));
  slots.push(...predictCountFamily({
    family: 'defesas',
    profileKey: 'avg_defesas',
    leagueTotalKey: 'avg_defesas_total',
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('defesas'),
  }));
  slots.push(...predictCountFamily({
    family: 'desarmes',
    profileKey: 'avg_desarmes',
    leagueTotalKey: 'avg_desarmes_total',
    profileHome,
    profileAway,
    priors,
    lambdaMult: lm('desarmes'),
  }));

  return {
    slots,
    lambdas: { lambdaHome, lambdaAway, inputs },
    version: ENGINE_A_VERSION,
    markets_catalog_version: MARKETS_VERSION,
  };
}

// ════════════════════════════════════════════════════════════════════
// DERIVADORES — todos consomem matrizes Poisson já calculadas. Custo zero.
// ════════════════════════════════════════════════════════════════════

function derive2T(matrix2T, provBase) {
  const out = [];
  const prov = { ...provBase, period_scaling: 1 - HT_SCALE_GOLS };
  // gols 2T over/under
  for (const m of listMarkets({ family: 'gols', period: '2T', scope: 'total' })) {
    if (m.line == null) continue;
    const pOver = probTotalOver(matrix2T, m.line);
    const p = m.direction === 'over' ? pOver : (1 - pOver);
    out.push(mkSlot(m, p, true, prov));
  }
  return out;
}

function deriveBTTSExtras(matrixFT, matrixHT, matrix2T, provBase) {
  // DEPRECATED v2.0.0 — `btts_algum_tempo` saiu do whitelist Superbet.
  // Mantido como no-op para compatibilidade caller; remove em refactor futuro.
  return [];
}

function derive1X2_2T(matrix2T, provBase) {
  // DEPRECATED v2.0.0 — `1x2_2t` saiu do whitelist Superbet.
  return [];
}

function deriveDuplaChance(matrixFT, matrixHT, provBase) {
  const out = [];
  const matrices = { FT: matrixFT, HT: matrixHT };
  for (const m of listMarkets({ family: 'dupla' })) {
    const mtx = matrices[m.period];
    if (!mtx) continue;
    const x = prob1X2(mtx);
    let p;
    if (m.direction === '1x') p = x.home + x.draw;
    else if (m.direction === '12') p = x.home + x.away;
    else if (m.direction === 'x2') p = x.draw + x.away;
    out.push(mkSlot(m, p, true, { ...provBase, family: 'dupla', ...(m.period === 'HT' ? { period_scaling: HT_SCALE_GOLS } : {}) }));
  }
  return out;
}

/** P(soma de gols par/impar) por matriz Poisson 2D. */
function deriveGolsOddEven(matrixFT, matrixHT, provBase) {
  const out = [];
  const matrices = { FT: matrixFT, HT: matrixHT };
  for (const m of listMarkets({ family: 'gols_oddeven' })) {
    const mtx = matrices[m.period];
    if (!mtx) continue;
    const M = mtx.length;
    let pPar = 0, pImpar = 0;
    for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
      const s = i + j;
      if (s % 2 === 0) pPar += mtx[i][j];
      else pImpar += mtx[i][j];
    }
    const p = m.direction === 'par' ? pPar : pImpar;
    out.push(mkSlot(m, p, true, { ...provBase, family: 'gols_oddeven', ...(m.period === 'HT' ? { period_scaling: HT_SCALE_GOLS } : {}) }));
  }
  return out;
}

function deriveDNB(matrixFT, matrixHT, matrix2T, provBase) {
  // DEPRECATED v2.0.0 — DNB fora do whitelist Superbet.
  return [];
}

function deriveHTFT(matrixHT, matrix2T, provBase) {
  // DEPRECATED v2.0.0 — HT/FT fora do whitelist Superbet.
  return [];
}

function deriveCorrectScore(matrixFT, matrixHT, provBase) {
  // DEPRECATED v2.0.0 — Correct Score fora do whitelist Superbet.
  return [];
}

function deriveMargem(matrixFT, provBase) {
  // DEPRECATED v2.0.0 — Margem fora do whitelist Superbet.
  return [];
}

function deriveMarcaPrimeiroUltimo(lambdaHome, lambdaAway, provBase) {
  // DEPRECATED v2.0.0 — Marca Primeiro/Último fora do whitelist Superbet.
  return [];
}

function deriveMarca(matrixFT, provBase) {
  // DEPRECATED v2.0.0 — `marca` fora do whitelist Superbet.
  return [];
}

function deriveHandicap(matrixFT, provBase) {
  // DEPRECATED v2.0.0 — handicap europeu de gols fora do whitelist Superbet.
  return [];
}

function deriveAsianHandicap(matrixFT, provBase) {
  // DEPRECATED v2.0.0 — Asian Handicap fora do whitelist Superbet.
  return [];
}

function deriveCountAuxiliary({ family, profileKey, leagueTotalKey, profileHome, profileAway, priors, lambdaMult, lowConfidence = false }) {
  // Para cada família count, deriva _1x2 (FT/HT) por Poisson independente; e,
  // quando aplicável, _oddeven e _handicap (apenas escanteios).
  const out = [];
  const r = resolveCountLambdas({ profileHome, profileAway, priors, key: profileKey, leagueTotalKey });
  const lh = r.lambdaHome, la = r.lambdaAway;
  if (lh == null || la == null) return out;

  const lhFT = lh * lambdaMult;
  const laFT = la * lambdaMult;
  const htShare = HT_SHARE[family] ?? 0.4;
  const lhHT = lhFT * htShare;
  const laHT = laFT * htShare;

  const distVec = (lambda) => {
    const arr = [];
    for (let k = 0; k <= MAX_COUNT; k++) arr.push(poissonPMF(k, lambda));
    return arr;
  };
  const buildJoint = (lH, lA) => ({ dH: distVec(lH), dA: distVec(lA) });

  const provBase = {
    engine: 'A',
    family,
    lambda_home: lh,
    lambda_away: la,
    lambda_mult: lambdaMult,
    used: r.used,
    ...(lowConfidence ? { low_confidence_family: true } : {}),
  };

  // _1x2 por contagem (FT e HT)
  for (const period of ['FT', 'HT']) {
    const fam1x2 = `${family}_1x2`;
    const markets = listMarkets({ family: fam1x2, period });
    if (markets.length === 0) continue;
    const { dH, dA } = buildJoint(period === 'HT' ? lhHT : lhFT, period === 'HT' ? laHT : laFT);
    let pH = 0, pD = 0, pA = 0;
    for (let i = 0; i < dH.length; i++) for (let j = 0; j < dA.length; j++) {
      const p = dH[i] * dA[j];
      if (i > j) pH += p;
      else if (i === j) pD += p;
      else pA += p;
    }
    for (const m of markets) {
      const target = m.direction === 'home' ? pH : m.direction === 'draw' ? pD : pA;
      out.push(mkSlot(m, target, true, { ...provBase, ...(period === 'HT' ? { period_scaling: htShare } : {}) }));
    }
  }

  // Escanteios oddeven (par/impar do total) — FT e HT
  if (family === 'escanteios') {
    for (const period of ['FT', 'HT']) {
      const markets = listMarkets({ family: 'escanteios_oddeven', period });
      if (markets.length === 0) continue;
      const { dH, dA } = buildJoint(period === 'HT' ? lhHT : lhFT, period === 'HT' ? laHT : laFT);
      let pPar = 0, pImpar = 0;
      for (let i = 0; i < dH.length; i++) for (let j = 0; j < dA.length; j++) {
        const p = dH[i] * dA[j];
        if ((i + j) % 2 === 0) pPar += p; else pImpar += p;
      }
      for (const m of markets) {
        const target = m.direction === 'par' ? pPar : pImpar;
        out.push(mkSlot(m, target, true, { ...provBase, family: 'escanteios_oddeven', ...(period === 'HT' ? { period_scaling: htShare } : {}) }));
      }
    }
  }

  // Escanteios handicap (direction `home_minus_X_Y` / `home_plus_X_Y` / `away_*`).
  // Linha sempre fracionária .5 → sem push possível.
  if (family === 'escanteios') {
    for (const period of ['FT', 'HT']) {
      const markets = listMarkets({ family: 'escanteios_handicap', period });
      if (markets.length === 0) continue;
      const { dH, dA } = buildJoint(period === 'HT' ? lhHT : lhFT, period === 'HT' ? laHT : laFT);
      for (const m of markets) {
        const h = m.line; // handicap aplicado ao home (positivo = favorece home)
        const side = m.direction.startsWith('home') ? 'home' : 'away';
        let pHomeAdj = 0;
        for (let i = 0; i < dH.length; i++) for (let j = 0; j < dA.length; j++) {
          if ((i + h) > j) pHomeAdj += dH[i] * dA[j];
        }
        const target = side === 'home' ? pHomeAdj : (1 - pHomeAdj);
        out.push(mkSlot(m, target, true, { ...provBase, family: 'escanteios_handicap', handicap_line: h, ...(period === 'HT' ? { period_scaling: htShare } : {}) }));
      }
    }
  }

  return out;
}

/** Famílias cobertas pela versão atual do Engine A (v2.0.0 — whitelist Superbet). */
export function coveredFamilies() {
  return [
    // Gols — matrix conjunta Dixon-Coles
    { family: 'gols',                scope: 'total', period: 'FT' },
    { family: 'gols',                scope: 'home',  period: 'FT' },
    { family: 'gols',                scope: 'away',  period: 'FT' },
    { family: 'gols',                scope: 'total', period: 'HT' },
    { family: 'gols',                scope: 'home',  period: 'HT' },
    { family: 'gols',                scope: 'away',  period: 'HT' },
    { family: 'gols',                scope: 'total', period: '2T' },
    { family: 'gols_oddeven',        scope: 'total', period: 'FT' },
    { family: 'gols_oddeven',        scope: 'total', period: 'HT' },
    // 1x2 / Dupla — matrix FT/HT
    { family: '1x2',                 scope: 'total', period: 'FT' },
    { family: '1x2',                 scope: 'total', period: 'HT' },
    { family: 'dupla',               scope: 'total', period: 'FT' },
    { family: 'dupla',               scope: 'total', period: 'HT' },
    // BTTS — matrix FT/HT
    { family: 'btts',                scope: 'total', period: 'FT' },
    { family: 'btts',                scope: 'total', period: 'HT' },
    // Cartões — Poisson independente (low confidence)
    { family: 'cartoes',             scope: 'total', period: 'FT', low_confidence: true },
    { family: 'cartoes',             scope: 'home',  period: 'FT', low_confidence: true },
    { family: 'cartoes',             scope: 'away',  period: 'FT', low_confidence: true },
    { family: 'cartoes',             scope: 'total', period: 'HT', low_confidence: true },
    { family: 'cartoes',             scope: 'home',  period: 'HT', low_confidence: true },
    { family: 'cartoes',             scope: 'away',  period: 'HT', low_confidence: true },
    { family: 'cartoes_1x2',         scope: 'total', period: 'FT', low_confidence: true },
    { family: 'cartoes_1x2',         scope: 'total', period: 'HT', low_confidence: true },
    // Chutes (Finalizações) — Poisson independente
    { family: 'chutes',              scope: 'total', period: 'FT' },
    { family: 'chutes',              scope: 'home',  period: 'FT' },
    { family: 'chutes',              scope: 'away',  period: 'FT' },
    { family: 'chutes',              scope: 'total', period: 'HT' },
    { family: 'chutes',              scope: 'home',  period: 'HT' },
    { family: 'chutes',              scope: 'away',  period: 'HT' },
    { family: 'chutes_1x2',          scope: 'total', period: 'FT' },
    { family: 'chutes_1x2',          scope: 'total', period: 'HT' },
    // Chutes no gol — Poisson independente
    { family: 'chutes_alvo',         scope: 'total', period: 'FT' },
    { family: 'chutes_alvo',         scope: 'home',  period: 'FT' },
    { family: 'chutes_alvo',         scope: 'away',  period: 'FT' },
    { family: 'chutes_alvo',         scope: 'total', period: 'HT' },
    { family: 'chutes_alvo',         scope: 'home',  period: 'HT' },
    { family: 'chutes_alvo',         scope: 'away',  period: 'HT' },
    { family: 'chutes_alvo_1x2',     scope: 'total', period: 'FT' },
    { family: 'chutes_alvo_1x2',     scope: 'total', period: 'HT' },
    // Defesas / Desarmes — Poisson independente
    { family: 'defesas',             scope: 'total', period: 'FT' },
    { family: 'defesas',             scope: 'home',  period: 'FT' },
    { family: 'defesas',             scope: 'away',  period: 'FT' },
    { family: 'defesas',             scope: 'total', period: 'HT' },
    { family: 'defesas',             scope: 'home',  period: 'HT' },
    { family: 'defesas',             scope: 'away',  period: 'HT' },
    { family: 'desarmes',            scope: 'total', period: 'FT' },
    { family: 'desarmes',            scope: 'home',  period: 'FT' },
    { family: 'desarmes',            scope: 'away',  period: 'FT' },
    // Escanteios — Poisson independente + derivados
    { family: 'escanteios',          scope: 'total', period: 'FT' },
    { family: 'escanteios',          scope: 'home',  period: 'FT' },
    { family: 'escanteios',          scope: 'away',  period: 'FT' },
    { family: 'escanteios',          scope: 'total', period: 'HT' },
    { family: 'escanteios',          scope: 'home',  period: 'HT' },
    { family: 'escanteios',          scope: 'away',  period: 'HT' },
    { family: 'escanteios_1x2',      scope: 'total', period: 'FT' },
    { family: 'escanteios_1x2',      scope: 'total', period: 'HT' },
    { family: 'escanteios_handicap', scope: 'total', period: 'FT' },
    { family: 'escanteios_handicap', scope: 'total', period: 'HT' },
    { family: 'escanteios_oddeven',  scope: 'total', period: 'FT' },
    { family: 'escanteios_oddeven',  scope: 'total', period: 'HT' },
    // Faltas — Poisson (low confidence)
    { family: 'faltas',              scope: 'total', period: 'FT', low_confidence: true },
    { family: 'faltas',              scope: 'home',  period: 'FT', low_confidence: true },
    { family: 'faltas',              scope: 'away',  period: 'FT', low_confidence: true },
    { family: 'faltas',              scope: 'total', period: 'HT', low_confidence: true },
    { family: 'faltas',              scope: 'home',  period: 'HT', low_confidence: true },
    { family: 'faltas',              scope: 'away',  period: 'HT', low_confidence: true },
    // Impedimentos — Poisson
    { family: 'impedimentos',        scope: 'total', period: 'FT' },
    { family: 'impedimentos',        scope: 'home',  period: 'FT' },
    { family: 'impedimentos',        scope: 'away',  period: 'FT' },
  ];
}
