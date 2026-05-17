/**
 * @scoutcore/strategy-engine — contradiction.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Detecção de contradições pair-wise entre slots.
 *
 * Portado de opta-extractor/src/motor/combinator.js (checkContradiction)
 * com extensão local para bloquear pares dominados/redundantes no Yankee.
 * Regras:
 *   - over/under na mesma linha → conflito
 *   - btts sim/nao → conflito
 *   - btts_sim + gols_equipe_under_0.5 → contraditório
 *   - btts_sim + gols_total_under_1.5 → contraditório
 *   - btts sim + gols_total_over_1.5 → redundante
 *   - btts nao + gols_total_under_2.5 → redundante/correlacionado
 *   - btts_sim + gols_equipe_over_0.5 → redundante (tratado como conflito)
 *   - 1x2_home ⊂ dupla_1x / 1x2_away ⊂ dupla_x2 → dominado (mesma period)
 */

const BTTS_YES = new Set(['sim', 'yes']);
const BTTS_NO = new Set(['nao', 'no']);

/**
 * Verifica se dois slots são contraditórios ou redundantes.
 * @param {object} a  Slot com { family, scope, period, direction, line }
 * @param {object} b  Slot com { family, scope, period, direction, line }
 * @returns {{ conflict: boolean, reason?: string }}
 */
export function checkContradiction(a, b) {
  // ── Cross-family: BTTS × Gols ──────────────────────────────────────────
  const bttsYes = [a, b].find((x) => x.family === 'btts' && BTTS_YES.has(x.direction));
  const bttsYesOther = bttsYes === a ? b : a;
  if (bttsYes) {
    if (bttsYes.period === bttsYesOther.period) {
      const other = bttsYesOther;
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
        if (other.direction === 'over' && other.line <= 1.5) {
          return {
            conflict: true,
            reason: 'btts_sim + gols_total_over_1.5: redundante (BTTS já implica ≥2 gols totais)',
          };
        }
        if (other.direction === 'under' && other.line <= 1.5) {
          return {
            conflict: true,
            reason: 'btts_sim + gols_total_under_1.5: contraditório (BTTS exige ≥2 gols totais)',
          };
        }
      }
    }
  }

  const bttsNo = [a, b].find((x) => x.family === 'btts' && BTTS_NO.has(x.direction));
  const bttsNoOther = bttsNo === a ? b : a;
  if (bttsNo) {
    if (bttsNo.period === bttsNoOther.period) {
      const other = bttsNoOther;
      if (other.family === 'gols' && other.scope === 'total') {
        if (other.direction === 'under' && other.line <= 2.5) {
          const reason = other.line <= 1.5
            ? `btts_nao + gols_total_under_${other.line}: redundante (Under ${other.line} já implica BTTS não)`
            : `btts_nao + gols_total_under_${other.line}: altamente correlacionados (combinação sem diversificação real)`;
          return { conflict: true, reason };
        }
      }
    }
  }

  // ── Cross-family: 1x2 dominado por Dupla ──────────────────────────────────
  const oneX2 = [a, b].find((x) => x.family === '1x2');
  const duplaSlot = oneX2 ? [a, b].find((x) => x.family === 'dupla') : null;
  if (oneX2 && duplaSlot && oneX2.period === duplaSlot.period) {
    if (
      (oneX2.direction === 'home' && duplaSlot.direction === '1x') ||
      (oneX2.direction === 'away' && duplaSlot.direction === 'x2')
    ) {
      return {
        conflict: true,
        reason: `1x2_${oneX2.direction} dominado por dupla_${duplaSlot.direction}: resultado 1x2 já está contido na aposta dupla`,
      };
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
