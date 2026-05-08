// Engine A — Poisson + Dixon-Coles light.
//
// Cobre nesta versão (honesto):
//   - GOLS total/home/away FT  (over/under linhas .5)
//   - GOLS total HT             (over/under) — usa scaling 0.40 do FT
//   - BTTS FT
//   - 1X2 FT
//
// FORA do escopo desta versão (aparecerão como "uncovered" no /v1/predict):
//   - escanteios, chutes, cartões, faltas (precisam Engine B / heurística separada)
//   - 2T derivado (precisa skel separado, não confiável só com Poisson de gols)
//   - HT scope home/away (scaling não confiável sem dados de bandas)
//
// Não inventa: o que não cobre, não devolve slot certified=true.

import { listMarkets, MARKETS_VERSION } from '@scoutcore/markets';
import { scoreMatrix, poissonPMF } from './poisson.mjs';

export const ENGINE_A_VERSION = '0.1.0';

const HT_SCALE = 0.40;        // share típico de gols 1T
const RHO_DC   = -0.05;
const MAX_GOALS = 8;

/**
 * Calcula λ casa/fora a partir de team profiles + league prior.
 * profileHome/profileAway: { avg_gols_marcados, avg_gols_sofridos } (side-aware)
 * priors.avg_goals_total: gols por jogo médio da liga (FT)
 */
export function computeLambdas({ profileHome, profileAway, priors, homeAdvantage = 1.10 }) {
  const leagueAvg = priors?.avg_goals_total ?? 2.6;
  const leagueHomePerTeam = leagueAvg / 2;

  // Strengths em razão sobre o esperado da liga.
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

/**
 * Predict do Engine A.
 * @param {{home:string, away:string, liga:string, profileHome:object, profileAway:object, priors:object, homeAdvantage?:number}} ctx
 * @returns {{slots:object[], lambdas:object, version:string, markets_catalog_version:string}}
 */
export function predict(ctx) {
  const { lambdaHome, lambdaAway, inputs } = computeLambdas(ctx);
  const matrixFT = scoreMatrix(lambdaHome, lambdaAway, { maxGoals: MAX_GOALS, rho: RHO_DC });
  const matrixHT = scoreMatrix(lambdaHome * HT_SCALE, lambdaAway * HT_SCALE, { maxGoals: MAX_GOALS, rho: RHO_DC });

  const slots = [];
  const provBase = { lambda_home: lambdaHome, lambda_away: lambdaAway, ...inputs };

  // GOLS over/under — total/home/away FT
  for (const m of listMarkets({ family: 'gols', period: 'FT' })) {
    if (m.line == null) continue;
    let pOver;
    if (m.scope === 'total')      pOver = probTotalOver(matrixFT, m.line);
    else if (m.scope === 'home')  pOver = probHomeOver(matrixFT, m.line);
    else if (m.scope === 'away')  pOver = probAwayOver(matrixFT, m.line);
    if (pOver == null) continue;
    const p = m.direction === 'over' ? pOver : (1 - pOver);
    slots.push(mkSlot(m, p, true, { ...provBase, period_scaling: 1.0 }));
  }

  // GOLS over/under — total HT
  for (const m of listMarkets({ family: 'gols', period: 'HT', scope: 'total' })) {
    if (m.line == null) continue;
    const pOver = probTotalOver(matrixHT, m.line);
    const p = m.direction === 'over' ? pOver : (1 - pOver);
    slots.push(mkSlot(m, p, true, { ...provBase, period_scaling: HT_SCALE }));
  }

  // BTTS FT
  const pBTTS_FT = probBTTS(matrixFT);
  for (const m of listMarkets({ family: 'btts', period: 'FT' })) {
    const p = m.direction === 'sim' ? pBTTS_FT : (1 - pBTTS_FT);
    slots.push(mkSlot(m, p, true, provBase));
  }

  // BTTS HT
  const pBTTS_HT = probBTTS(matrixHT);
  for (const m of listMarkets({ family: 'btts', period: 'HT' })) {
    const p = m.direction === 'sim' ? pBTTS_HT : (1 - pBTTS_HT);
    slots.push(mkSlot(m, p, true, { ...provBase, period_scaling: HT_SCALE }));
  }

  // 1X2 FT/HT
  const x2_FT = prob1X2(matrixFT);
  for (const m of listMarkets({ family: '1x2', period: 'FT' })) {
    slots.push(mkSlot(m, x2_FT[m.direction], true, provBase));
  }
  const x2_HT = prob1X2(matrixHT);
  for (const m of listMarkets({ family: '1x2', period: 'HT' })) {
    slots.push(mkSlot(m, x2_HT[m.direction], true, { ...provBase, period_scaling: HT_SCALE }));
  }

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
    { family: 'gols', scope: 'total', period: 'FT' },
    { family: 'gols', scope: 'home',  period: 'FT' },
    { family: 'gols', scope: 'away',  period: 'FT' },
    { family: 'gols', scope: 'total', period: 'HT' },
    { family: 'btts', scope: 'total', period: 'FT' },
    { family: 'btts', scope: 'total', period: 'HT' },
    { family: '1x2',  scope: 'total', period: 'FT' },
    { family: '1x2',  scope: 'total', period: 'HT' },
  ];
}
