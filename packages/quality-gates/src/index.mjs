// @scoutcore/quality-gates
//
// Carrega o JSON de quality-gates (origem: motor legacy, calibração walk-forward
// 2026-04-11..2026-04-28) e expõe helpers para o predict.mjs aplicar nos slots.
//
// Fonte: config/quality-gates.json no root do repositório.
// NÃO inventamos defaults — quando uma chave não existe, retornamos 1.0
// (no-op) e logamos no provenance que QG não tinha entrada.
//
// O legacy mapeava por "heading" (string da Superbet, ex: "1º Tempo - Total
// de Gols"). Aqui mapeamos por (family, scope, period, direction) que é o
// formato canônico interno. A tradução heading→canon mora em LEGACY_HEADING_MAP.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path resolution: pacote vive em packages/quality-gates/src/index.mjs.
// Config está em <repo-root>/config/quality-gates.json.
const QG_PATH = resolve(__dirname, '..', '..', '..', 'config', 'quality-gates.json');

let _qg = null;
function load() {
  if (_qg) return _qg;
  _qg = JSON.parse(readFileSync(QG_PATH, 'utf8'));
  return _qg;
}

export function getRaw() {
  return load();
}

/**
 * @param {string} key dotpath ex: 'gates.ev_min_pct'
 * @returns {*} valor ou null
 */
export function get(key) {
  const root = load();
  return key.split('.').reduce((acc, k) => (acc != null ? acc[k] : null), root);
}

// ── Mapeamento heading legacy ↔ canônico (family/scope/period) ───────────────
//
// O quality-gates legacy usa headings da Superbet em PT-BR. Convertemos para
// nossa convenção. Quando não há entrada exata, caímos no default 1.0.

const HEADING_BY_CANON = new Map();
function regHeading({ headings, family, scope, period }) {
  for (const h of headings) {
    HEADING_BY_CANON.set(`${family}::${scope}::${period}`, h);
  }
}

// Demote/promote — registro de pares heading↔canon usados no JSON legacy.
regHeading({ headings: ['1º Tempo - Total de Gols'],         family: 'gols', scope: 'total', period: 'HT' });
regHeading({ headings: ['Total de Gols da Equipe'],          family: 'gols', scope: 'home',  period: 'FT' });
regHeading({ headings: ['Total de Gols da Equipe'],          family: 'gols', scope: 'away',  period: 'FT' });
regHeading({ headings: ['1º Tempo - Total de Gols do Time'], family: 'gols', scope: 'home',  period: 'HT' });
regHeading({ headings: ['1º Tempo - Total de Gols do Time'], family: 'gols', scope: 'away',  period: 'HT' });
regHeading({ headings: ['Total de Faltas'],                  family: 'faltas', scope: 'total', period: 'FT' });

/**
 * Multiplicador de confiança canônico para um slot.
 * Lê confidence_multipliers do JSON.
 */
export function getConfidenceMultiplier(slot) {
  const qg = load();
  const cm = qg.confidence_multipliers ?? {};
  const { family, scope, period, direction } = slot;

  if (family === 'escanteios') {
    if (direction === 'handicap') return cm.corners_handicap ?? 1.0;
    if (period === 'HT') return scope === 'total' ? (cm.corners_ht ?? 1.0) : (cm.corners_team_ht ?? 1.0);
    return scope === 'total' ? (cm.corners_total ?? 1.0) : (cm.corners_team ?? 1.0);
  }
  if (family === 'cartoes') {
    if (direction === 'handicap') {
      return period === 'HT'
        ? (cm.cards_ht_handicap ?? cm.cards_handicap ?? 1.0)
        : (cm.cards_handicap ?? 1.0);
    }
    return cm.cards_audited ?? 1.0;
  }
  if (family === 'chutes')       return cm.shots ?? 1.0;
  if (family === 'chutes_alvo')  return cm.sot ?? 1.0;
  if (family === 'finalizacoes') return cm.shots ?? 1.0;
  if (family === 'faltas')       return cm.fouls_audited ?? 1.0;

  if (family === 'gols' && direction === 'handicap') {
    return period === 'HT'
      ? (cm.goals_ht_handicap ?? cm.goals_handicap ?? cm.ht_handicap ?? 1.0)
      : (cm.goals_handicap ?? 1.0);
  }
  if (family === 'gols' && period === 'HT') {
    return scope === 'total' ? (cm.ht_goals ?? 1.0) : (cm.ht_goals_team ?? 1.0);
  }
  return 1.0;
}

/** Fator de demote (≤ 1.0) por canon (family/scope/period). 1.0 = no-op. */
export function getDemoteFactor({ family, scope, period }) {
  const qg = load();
  const heading = HEADING_BY_CANON.get(`${family}::${scope}::${period}`);
  if (!heading) return 1.0;
  const rule = qg.market_ranking?.demote?.[heading];
  if (!rule) return 1.0;
  return Math.max(0.50, 1 + (rule.safety_delta ?? 0) / 10);
}

/** Fator de promote (≥ 1.0) por canon. Respeita allowed_leagues. */
export function getPromoteFactor({ family, scope, period }, liga) {
  const qg = load();
  const heading = HEADING_BY_CANON.get(`${family}::${scope}::${period}`);
  if (!heading) return 1.0;
  const rule = qg.market_ranking?.promote?.[heading];
  if (!rule) return 1.0;
  if (Array.isArray(rule.allowed_leagues) && rule.allowed_leagues.length > 0) {
    if (!rule.allowed_leagues.includes(liga)) return 1.0;
  }
  return Math.min(1.20, 1 + (rule.safety_delta ?? 0) / 40);
}

/** Cap de quantidade por família (ex: gols=6, escanteios=5). */
export function getFamilyCap(family) {
  const qg = load();
  return qg.family_cap?.[family] ?? qg.family_cap?._default ?? null;
}

/** Gates centrais (ev_min_pct, edge_min_pp, sample_min, phantom_edge_threshold_pp). */
export function getGates() {
  return load().gates ?? {};
}

/**
 * Resumo aplicado a um slot. Não muta o slot; devolve um envelope com:
 *   { confidence_multiplier, demote_factor, promote_factor, qg_confidence }
 * onde qg_confidence ∈ [0..1.2] é o produto (clamped) dos três.
 */
export function evaluateSlot(slot, { liga } = {}) {
  const cm = getConfidenceMultiplier(slot);
  const dm = getDemoteFactor(slot);
  const pm = getPromoteFactor(slot, liga);
  const raw = cm * dm * pm;
  const qg_confidence = Math.max(0, Math.min(1.2, raw));
  return { confidence_multiplier: cm, demote_factor: dm, promote_factor: pm, qg_confidence };
}

export const QG_VERSION = (() => {
  const qg = load();
  return `qg-${qg.version ?? 0}`;
})();
