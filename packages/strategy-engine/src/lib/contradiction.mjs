/**
 * @scoutcore/strategy-engine — contradiction.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Detecção de contradições pair-wise entre slots.
 *
 * Portado literalmente de opta-extractor/src/motor/combinator.js (checkContradiction).
 * Regras:
 *   - over/under na mesma linha → conflito
 *   - btts sim/nao → conflito
 *   - btts_sim + gols_equipe_under_0.5 → contraditório
 *   - btts_sim + gols_total_under_1.5 → contraditório
 *   - btts_sim + gols_equipe_over_0.5 → redundante (tratado como conflito)
 */

/**
 * Verifica se dois slots são contraditórios ou redundantes.
 * @param {object} a  Slot com { family, scope, period, direction, line }
 * @param {object} b  Slot com { family, scope, period, direction, line }
 * @returns {{ conflict: boolean, reason?: string }}
 */
export function checkContradiction(a, b) {
  // ── Cross-family: BTTS × Gols ──────────────────────────────────────────
  const btts = [a, b].find(
    (x) => x.family === 'btts' && (x.direction === 'sim' || x.direction === 'yes'),
  );
  const other = btts === a ? b : a;
  if (btts) {
    if (btts.period === other.period) {
      if (other.family === 'gols' && other.scope?.startsWith('equipe_')) {
        if (other.direction === 'over' && other.line <= 0.5) {
          return {
            conflict: true,
            reason: 'btts_sim + gols_equipe_over_0.5: redundante (equipe já garantida pelo BTTS)',
          };
        }
        if (other.direction === 'under' && other.line <= 0.5) {
          return {
            conflict: true,
            reason: 'btts_sim + gols_equipe_under_0.5: contraditório (BTTS exige ≥1 gol da equipe)',
          };
        }
      }
      if (other.family === 'gols' && other.scope === 'total') {
        if (other.direction === 'under' && other.line <= 1.5) {
          return {
            conflict: true,
            reason: 'btts_sim + gols_total_under_1.5: contraditório (BTTS exige ≥2 gols totais)',
          };
        }
      }
    }
  }

  if (a.family !== b.family) return { conflict: false };
  if (a.scope !== b.scope || a.period !== b.period) return { conflict: false };

  // over vs under na mesma linha
  if (a.line != null && b.line != null && a.line === b.line) {
    const dirs = new Set([a.direction, b.direction]);
    if (dirs.has('over') && dirs.has('under')) {
      return { conflict: true, reason: 'over/under same line' };
    }
    if (dirs.has('mais') && dirs.has('menos')) {
      return { conflict: true, reason: 'mais/menos same line' };
    }
  }

  // BTTS sim/nao mutuamente exclusivo
  if (a.family === 'btts') {
    const dirs = new Set([a.direction, b.direction]);
    if ((dirs.has('sim') && dirs.has('nao')) || (dirs.has('yes') && dirs.has('no'))) {
      return { conflict: true, reason: 'btts sim/nao' };
    }
  }

  return { conflict: false };
}
