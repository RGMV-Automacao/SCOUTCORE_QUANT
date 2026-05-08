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
  // Matriz 2T (segundo tempo) = matriz com lambdas reduzidos por 1-share
  const matrix2T = scoreMatrix(lambdaHome * (1 - HT_SCALE_GOLS), lambdaAway * (1 - HT_SCALE_GOLS), { maxGoals: MAX_GOALS, rho: RHO_DC });

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

  // ─────────────────────────────────────────────
  // Derivações Poisson bivariado (gratuitas — usam matrixFT/HT/2T já calculados)
  // ─────────────────────────────────────────────
  slots.push(...derive2T(matrix2T, provBaseGoals));
  slots.push(...deriveAsianTotal(matrixFT, matrixHT, provBaseGoals));
  slots.push(...deriveBTTSExtras(matrixFT, matrixHT, matrix2T, provBaseGoals));
  slots.push(...derive1X2_2T(matrix2T, provBaseGoals));
  slots.push(...deriveDuplaChance(matrixFT, matrixHT, matrix2T, provBaseGoals));
  slots.push(...deriveDNB(matrixFT, matrixHT, matrix2T, provBaseGoals));
  slots.push(...deriveHTFT(matrixHT, matrix2T, provBaseGoals));
  slots.push(...deriveCorrectScore(matrixFT, matrixHT, provBaseGoals));
  slots.push(...deriveMargem(matrixFT, provBaseGoals));
  slots.push(...deriveMarcaPrimeiroUltimo(lambdaHome, lambdaAway, provBaseGoals));
  slots.push(...deriveMarca(matrixFT, provBaseGoals));
  slots.push(...deriveHandicap(matrixFT, provBaseGoals));
  slots.push(...deriveAsianHandicap(matrixFT, provBaseGoals));

  // Famílias contagem auxiliares (Poisson independente por equipe)
  slots.push(...deriveCountAuxiliary({
    family: 'escanteios', profileKey: 'avg_escanteios', leagueTotalKey: 'avg_escanteios_total',
    profileHome: ctx.profileHome, profileAway: ctx.profileAway, priors: ctx.priors, lambdaMult: lm('escanteios'),
  }));
  slots.push(...deriveCountAuxiliary({
    family: 'cartoes', profileKey: 'avg_cartoes_amarelos', leagueTotalKey: 'avg_cartoes_total',
    profileHome: ctx.profileHome, profileAway: ctx.profileAway, priors: ctx.priors, lambdaMult: lm('cartoes'),
    lowConfidence: true,
  }));

  // Chutes no gol (separado de chutes), impedimentos e defesas — Poisson básico
  slots.push(...predictCountFamily({
    family: 'chutes_alvo',
    profileKey: 'avg_chutes_alvo',
    leagueTotalKey: 'avg_chutes_alvo_total',
    profileHome: ctx.profileHome,
    profileAway: ctx.profileAway,
    priors: ctx.priors,
    lambdaMult: lm('chutes_alvo'),
  }));
  slots.push(...predictCountFamily({
    family: 'impedimentos',
    profileKey: 'avg_impedimentos',
    leagueTotalKey: 'avg_impedimentos_total',
    profileHome: ctx.profileHome,
    profileAway: ctx.profileAway,
    priors: ctx.priors,
    lambdaMult: lm('impedimentos'),
  }));
  slots.push(...predictCountFamily({
    family: 'defesas',
    profileKey: 'avg_defesas',
    leagueTotalKey: 'avg_defesas_total',
    profileHome: ctx.profileHome,
    profileAway: ctx.profileAway,
    priors: ctx.priors,
    lambdaMult: lm('defesas'),
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

function deriveAsianTotal(matrixFT, matrixHT, provBase) {
  // Asiáticos com .25 e .75 (quarter-line). Probabilidade reportada é a prob
  // de "win" pura (não considera push-half-back). Settle aplica payout fracionado.
  const out = [];
  for (const m of listMarkets({ family: 'asian_total' })) {
    const matrix = m.period === 'HT' ? matrixHT : matrixFT;
    const line = m.line;
    const pOver = probTotalOver(matrix, line);
    const p = m.direction === 'over' ? pOver : (1 - pOver);
    out.push(mkSlot(m, p, true, { ...provBase, family: 'asian_total', asian: true }));
  }
  return out;
}

function deriveBTTSExtras(matrixFT, matrixHT, matrix2T, provBase) {
  const out = [];
  const pHT = probBTTS(matrixHT);
  const p2T = probBTTS(matrix2T);
  const pAmbos = pHT * p2T;
  // P(algum tempo) = 1 - P(nenhum tempo) onde P(nenhum tempo) = (1-pHT)*(1-p2T)
  const pAlgum = 1 - (1 - pHT) * (1 - p2T);
  for (const m of listMarkets({ family: 'btts_ambos_tempos' })) {
    const p = m.direction === 'sim' ? pAmbos : (1 - pAmbos);
    out.push(mkSlot(m, p, true, { ...provBase, family: 'btts_ambos_tempos' }));
  }
  for (const m of listMarkets({ family: 'btts_algum_tempo' })) {
    const p = m.direction === 'sim' ? pAlgum : (1 - pAlgum);
    out.push(mkSlot(m, p, true, { ...provBase, family: 'btts_algum_tempo' }));
  }
  return out;
}

function derive1X2_2T(matrix2T, provBase) {
  const out = [];
  const x = prob1X2(matrix2T);
  for (const m of listMarkets({ family: '1x2', period: '2T' })) {
    out.push(mkSlot(m, x[m.direction], true, { ...provBase, family: '1x2', period_scaling: 1 - HT_SCALE_GOLS }));
  }
  return out;
}

function deriveDuplaChance(matrixFT, matrixHT, matrix2T, provBase) {
  const out = [];
  const matrices = { FT: matrixFT, HT: matrixHT, '2T': matrix2T };
  for (const m of listMarkets({ family: 'dupla' })) {
    const x = prob1X2(matrices[m.period]);
    let p;
    if (m.direction === '1x') p = x.home + x.draw;
    else if (m.direction === '12') p = x.home + x.away;
    else if (m.direction === 'x2') p = x.draw + x.away;
    out.push(mkSlot(m, p, true, { ...provBase, family: 'dupla' }));
  }
  return out;
}

function deriveDNB(matrixFT, matrixHT, matrix2T, provBase) {
  // P(DNB home) = P(home win) / (P(home) + P(away))
  const out = [];
  const matrices = { FT: matrixFT, HT: matrixHT, '2T': matrix2T };
  for (const m of listMarkets({ family: 'dnb' })) {
    const x = prob1X2(matrices[m.period]);
    const denom = x.home + x.away;
    const p = denom > 0 ? (m.direction === 'home' ? x.home : x.away) / denom : 0.5;
    out.push(mkSlot(m, p, true, { ...provBase, family: 'dnb' }));
  }
  return out;
}

function deriveHTFT(matrixHT, matrix2T, provBase) {
  // P(HT=a, FT=b) = P(HT=a) * P(2T resulta em transição a→b)
  // Aproximação por enumeração: sobre todos os scores HT (i,j) e 2T (i',j'),
  // soma onde resHT == a e res(i+i', j+j') == b.
  const out = [];
  const M = matrixHT.length;
  // P(htCat, ftCat) acumulado
  const acc = { '1_1': 0, '1_x': 0, '1_2': 0, 'x_1': 0, 'x_x': 0, 'x_2': 0, '2_1': 0, '2_x': 0, '2_2': 0 };
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
    const pHT = matrixHT[i][j];
    if (pHT === 0) continue;
    const htCat = i > j ? '1' : i === j ? 'x' : '2';
    for (let ip = 0; ip < M; ip++) for (let jp = 0; jp < M; jp++) {
      const p2 = matrix2T[ip][jp];
      if (p2 === 0) continue;
      const fh = i + ip, fa = j + jp;
      const ftCat = fh > fa ? '1' : fh === fa ? 'x' : '2';
      acc[`${htCat}_${ftCat}`] += pHT * p2;
    }
  }
  // Renormaliza por fora-da-grade
  const total = Object.values(acc).reduce((a, b) => a + b, 0);
  if (total > 0) for (const k of Object.keys(acc)) acc[k] /= total;
  for (const m of listMarkets({ family: 'htft' })) {
    out.push(mkSlot(m, acc[m.direction] ?? 0, true, { ...provBase, family: 'htft' }));
  }
  return out;
}

function deriveCorrectScore(matrixFT, matrixHT, provBase) {
  const out = [];
  // FT 0..4 grid + overflow (other_home/draw/away)
  const M = matrixFT.length;
  let pOtherHome = 0, pOtherDraw = 0, pOtherAway = 0;
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
    if (i <= 4 && j <= 4) continue;
    if (i > j) pOtherHome += matrixFT[i][j];
    else if (i === j) pOtherDraw += matrixFT[i][j];
    else pOtherAway += matrixFT[i][j];
  }
  for (const m of listMarkets({ family: 'correct_score', period: 'FT' })) {
    let p;
    if (m.direction === 'other_home') p = pOtherHome;
    else if (m.direction === 'other_draw') p = pOtherDraw;
    else if (m.direction === 'other_away') p = pOtherAway;
    else {
      const [h, a] = m.direction.split('_').map(Number);
      p = matrixFT[h]?.[a] ?? 0;
    }
    out.push(mkSlot(m, p, true, { ...provBase, family: 'correct_score' }));
  }
  // HT 0..2 grid + overflow
  const Mh = matrixHT.length;
  let pOtherHT = 0;
  for (let i = 0; i < Mh; i++) for (let j = 0; j < Mh; j++) {
    if (i <= 2 && j <= 2) continue;
    pOtherHT += matrixHT[i][j];
  }
  for (const m of listMarkets({ family: 'correct_score', period: 'HT' })) {
    let p;
    if (m.direction === 'other') p = pOtherHT;
    else {
      const [h, a] = m.direction.split('_').map(Number);
      p = matrixHT[h]?.[a] ?? 0;
    }
    out.push(mkSlot(m, p, true, { ...provBase, family: 'correct_score', period_scaling: HT_SCALE_GOLS }));
  }
  return out;
}

function deriveMargem(matrixFT, provBase) {
  const out = [];
  const M = matrixFT.length;
  const acc = { home_1: 0, home_2: 0, home_3: 0, home_4_plus: 0, draw: 0, away_1: 0, away_2: 0, away_3: 0, away_4_plus: 0 };
  for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
    const p = matrixFT[i][j];
    if (p === 0) continue;
    const d = i - j;
    if (d === 0) acc.draw += p;
    else if (d > 0) {
      const k = d >= 4 ? 'home_4_plus' : `home_${d}`;
      acc[k] += p;
    } else {
      const k = -d >= 4 ? 'away_4_plus' : `away_${-d}`;
      acc[k] += p;
    }
  }
  for (const m of listMarkets({ family: 'margem' })) {
    out.push(mkSlot(m, acc[m.direction] ?? 0, true, { ...provBase, family: 'margem' }));
  }
  return out;
}

function deriveMarcaPrimeiroUltimo(lambdaHome, lambdaAway, provBase) {
  // Aproximação por taxa relativa de gols. Dado que pelo menos 1 gol ocorre,
  // P(primeiro=home) = lh/(lh+la). P(none) = P(0-0) = e^(-lh-la).
  const out = [];
  const sum = lambdaHome + lambdaAway;
  const pNone = sum > 0 ? Math.exp(-sum) : 1;
  const pHome = sum > 0 ? (1 - pNone) * (lambdaHome / sum) : 0;
  const pAway = sum > 0 ? (1 - pNone) * (lambdaAway / sum) : 0;
  for (const fam of ['marca_primeiro', 'marca_ultimo']) {
    for (const m of listMarkets({ family: fam })) {
      const p = m.direction === 'home' ? pHome : m.direction === 'away' ? pAway : pNone;
      out.push(mkSlot(m, p, true, { ...provBase, family: fam }));
    }
  }
  return out;
}

function deriveMarca(matrixFT, provBase) {
  // P(home marca) = 1 - P(home=0) ; idem away
  const out = [];
  const M = matrixFT.length;
  let pH0 = 0, pA0 = 0;
  for (let j = 0; j < M; j++) pH0 += matrixFT[0][j];
  for (let i = 0; i < M; i++) pA0 += matrixFT[i][0];
  const pHome = 1 - pH0;
  const pAway = 1 - pA0;
  for (const m of listMarkets({ family: 'marca' })) {
    let p;
    if (m.direction === 'home_sim') p = pHome;
    else if (m.direction === 'home_nao') p = 1 - pHome;
    else if (m.direction === 'away_sim') p = pAway;
    else if (m.direction === 'away_nao') p = 1 - pAway;
    out.push(mkSlot(m, p, true, { ...provBase, family: 'marca' }));
  }
  return out;
}

function deriveHandicap(matrixFT, provBase) {
  const out = [];
  const M = matrixFT.length;
  for (const m of listMarkets({ family: 'handicap' })) {
    const h = m.line; // handicap aplicado à casa
    let pH = 0, pD = 0, pA = 0;
    for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
      const eff = (i + h) - j;
      const p = matrixFT[i][j];
      if (eff > 0) pH += p;
      else if (eff === 0) pD += p;
      else pA += p;
    }
    const target = m.direction.startsWith('home') ? pH : m.direction.startsWith('draw') ? pD : pA;
    out.push(mkSlot(m, target, true, { ...provBase, family: 'handicap', handicap_line: h }));
  }
  return out;
}

function deriveAsianHandicap(matrixFT, provBase) {
  // Asian: linha aplicada como diff favorável ao lado. Reporta apenas P(win) puro.
  // Settle calcula payout (full/half push) em settle.mjs.
  const out = [];
  const M = matrixFT.length;
  for (const m of listMarkets({ family: 'asian_handicap' })) {
    const h = m.line;
    let pHomeWin = 0;
    for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
      const diff = i - j + h;
      if (diff > 0) pHomeWin += matrixFT[i][j];
    }
    const p = m.direction.startsWith('home') ? pHomeWin : (1 - pHomeWin);
    out.push(mkSlot(m, p, true, { ...provBase, family: 'asian_handicap', asian: true, handicap_line: h }));
  }
  return out;
}

function deriveCountAuxiliary({ family, profileKey, leagueTotalKey, profileHome, profileAway, priors, lambdaMult, lowConfidence = false }) {
  // Para cada família count, deriva 1x2_count, race e exato a partir de
  // distribuições Poisson independentes home/away.
  const out = [];
  const r = resolveCountLambdas({ profileHome, profileAway, priors, key: profileKey, leagueTotalKey });
  const lh = r.lambdaHome, la = r.lambdaAway;
  if (lh == null || la == null) return out;

  const lhFT = lh * lambdaMult;
  const laFT = la * lambdaMult;
  const htShare = HT_SHARE[family] ?? 0.4;
  const lhHT = lhFT * htShare;
  const laHT = laFT * htShare;

  // Distribuições truncadas
  const distHome = (lambda) => {
    const arr = [];
    for (let k = 0; k <= MAX_COUNT; k++) arr.push(poissonPMF(k, lambda));
    return arr;
  };
  const buildJoint = (lH, lA) => {
    const dH = distHome(lH), dA = distHome(lA);
    return { dH, dA };
  };

  const provBase = {
    engine: 'A',
    family,
    lambda_home: lh,
    lambda_away: la,
    lambda_mult: lambdaMult,
    used: r.used,
    ...(lowConfidence ? { low_confidence_family: true } : {}),
  };

  // 1x2 por contagem (FT e HT)
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
      out.push(mkSlot(m, target, true, provBase));
    }
  }

  // Race-to-N (apenas FT, family escanteios_race)
  if (family === 'escanteios') {
    const { dH, dA } = buildJoint(lhFT, laFT);
    for (const m of listMarkets({ family: 'escanteios_race', period: 'FT' })) {
      const n = m.line;
      // Aproximação: probabilidade de o time atingir N antes do outro = P(home>=n e away<n) etc
      let pH = 0, pA = 0, pNone = 0;
      for (let i = 0; i < dH.length; i++) for (let j = 0; j < dA.length; j++) {
        const p = dH[i] * dA[j];
        const hReached = i >= n;
        const aReached = j >= n;
        if (hReached && !aReached) pH += p;
        else if (!hReached && aReached) pA += p;
        else if (!hReached && !aReached) pNone += p;
        else {
          // Ambos atingiram — divide pela proporção das taxas
          const sum = lhFT + laFT;
          if (sum > 0) {
            pH += p * (lhFT / sum);
            pA += p * (laFT / sum);
          }
        }
      }
      const target = m.direction === 'home' ? pH : m.direction === 'away' ? pA : pNone;
      out.push(mkSlot(m, target, true, provBase));
    }

    // Exato (total escanteios FT)
    const dT = [];
    for (let n = 0; n <= MAX_COUNT * 2; n++) {
      let s = 0;
      for (let i = 0; i <= n && i < dH.length; i++) {
        const j = n - i;
        if (j >= 0 && j < dA.length) s += dH[i] * dA[j];
      }
      dT.push(s);
    }
    for (const m of listMarkets({ family: 'escanteios_exato', period: 'FT' })) {
      let p;
      if (m.direction === 'eq_15_plus') {
        p = 0;
        for (let n = 15; n < dT.length; n++) p += dT[n];
      } else {
        const n = m.line;
        p = dT[n] ?? 0;
      }
      out.push(mkSlot(m, p, true, provBase));
    }
  }

  return out;
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
