/**
 * @scoutcore/strategy-engine — correlation.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Penalidades de correlação Superbet Bet Builder para combos intra-match.
 *
 * Portado de opta-extractor/src/motor/config/bomretiro.json (combo.correlation_penalties).
 * Calibrado empiricamente via desk-test real Superbet 2026-04.
 *
 * Categorias de par:
 *   CAT-A: mesma família, mesma direção, períodos cruzados (ex: Esc Under HT + Esc Under FT)
 *   CAT-B: mesma família, direções diferentes, períodos cruzados
 *   CAT-C: mesma família, mesmo período, scopes diferentes (ex: Esc Home + Esc Away)
 *   CAT-D: famílias diferentes, mesmo período
 *   CAT-E: famílias diferentes, períodos cruzados
 */

/** Penalidades default (calibradas via Superbet 2026-04). */
export const DEFAULT_CORRELATION_PENALTIES = {
  same_family_same_dir_cross_period:  0.73,
  same_family_diff_dir_cross_period:  0.85,
  same_family_same_period_diff_scope: 0.87,
  result_goal_same_period:            0.65,
  result_goal_cross_period:           0.78,
  diff_family_same_period:            0.885,
  diff_family_cross_period:           0.97,
};

const RESULT_FAMILIES = new Set(['1x2', 'dupla', 'dnb']);
const GOAL_SCRIPT_FAMILIES = new Set(['gols', 'btts']);

function normalizedFamily(family) {
  return family === 'resultado' ? '1x2' : family === 'dupla_chance' ? 'dupla' : family;
}

function isResultGoalPair(aFamily, bFamily) {
  return (
    (RESULT_FAMILIES.has(aFamily) && GOAL_SCRIPT_FAMILIES.has(bFamily)) ||
    (RESULT_FAMILIES.has(bFamily) && GOAL_SCRIPT_FAMILIES.has(aFamily))
  );
}

/**
 * Classifica o par (a, b) e retorna o fator de correlação.
 * @param {object} a  Slot com { family, scope, period, direction }
 * @param {object} b  Slot com { family, scope, period, direction }
 * @param {object} [penalties]  Penalidades customizadas (default = Superbet calibrado)
 * @returns {number}  Fator multiplicador (0.73 a 1.0)
 */
export function correlationFactor(a, b, penalties = DEFAULT_CORRELATION_PENALTIES) {
  const familyA = normalizedFamily(a.family);
  const familyB = normalizedFamily(b.family);
  const sameFamily  = familyA === familyB;
  const samePeriod  = a.period === b.period;
  const sameDir     = a.direction === b.direction;
  const sameScope   = a.scope === b.scope;

  if (sameFamily && !samePeriod && sameDir) {
    return penalties.same_family_same_dir_cross_period;
  }
  if (sameFamily && !samePeriod && !sameDir) {
    return penalties.same_family_diff_dir_cross_period;
  }
  if (sameFamily && samePeriod && !sameScope) {
    return penalties.same_family_same_period_diff_scope;
  }
  if (isResultGoalPair(familyA, familyB)) {
    return samePeriod ? penalties.result_goal_same_period : penalties.result_goal_cross_period;
  }
  if (!sameFamily && samePeriod) {
    return penalties.diff_family_same_period;
  }
  if (!sameFamily && !samePeriod) {
    return penalties.diff_family_cross_period;
  }

  // Fallback: mesma família, mesmo período, mesmo scope (legs iguais ou muito próximas)
  return 1.0;
}

/**
 * Calcula o fator de correlação combinado para um array de legs.
 * Produto de todos os pares (i, j) com i < j.
 * @param {object[]} legs
 * @param {object} [penalties]
 * @returns {number}
 */
export function comboCorrelationFactor(legs, penalties = DEFAULT_CORRELATION_PENALTIES) {
  if (legs.length < 2) return 1.0;
  let factor = 1.0;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      factor *= correlationFactor(legs[i], legs[j], penalties);
    }
  }
  return factor;
}
