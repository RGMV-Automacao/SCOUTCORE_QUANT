/**
 * @scoutcore/strategy-engine — runners/board_based.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Runner: Board-based strategies (e.g., Yankee BIBD).
 * Orquestra combinator -> board validator -> yankee builder.
 */

import { buildCombo } from '../lib/combinator.mjs';
import { validateBoard } from '../lib/board-validator.mjs';
import { buildYankee } from '../lib/yankee-builder.mjs';

function extractGates(params) {
  return {
    // Combinator / Board
    edgeMinPp: params.edge_min_pct ?? 2,
    legsMinPerConfronto: params.legs_per_confronto?.min ?? 2,
    legsPerConfronto: params.legs_per_confronto?.normal ?? 3,
    legsExceptionMax: params.legs_per_confronto?.max ?? 4,
    oddCombinedMin: params.odd_combo_range?.[0] ?? 2.50,
    oddCombinedMax: params.odd_combo_range?.[1] ?? 3.50,
    oddCombinedMaxException: params.odd_combo_exception ?? 3.80,
    builderDiscountBase: params.builder_discount ?? 0.854,
    builderDiscountMinLegs: params.builder_discount_min_legs ?? 3,
    comboEvMin: params.combo_ev_min ?? 0,
    correlationPenalties: params.correlation_penalties,
    oddMinLeg: params.odd_leg_range?.[0] ?? 1.20,
    oddMaxLeg: params.odd_leg_range?.[1] ?? 2.10,
    suspendedFamilies: new Set(params.suspended_families ?? []),
    suspendedMarketKeys: new Set(params.suspended_market_keys ?? []),
    suspendedMarketKeyPrefixes: params.suspended_market_key_prefixes ?? [],
    
    // Board validation
    minConfrontos: params.min_confrontos ?? 10,
    oddMin: params.odd_combo_range?.[0] ?? 2.50,
    oddMax: params.odd_combo_range?.[1] ?? 3.50,
    oddMaxException: params.odd_combo_exception ?? 3.80,
    evMinPct: params.edge_min_pct ?? 2,
    minFamilies: params.diversity?.min_families ?? 3,
    minTeamOrHT: params.diversity?.min_team_or_ht ?? 2,
    maxSameFamilyPct: params.diversity?.max_same_family_pct ?? 0.45,
    maxPerLeague: params.diversity?.max_per_league ?? 4,

    // Yankee Builder
    supportedN: params.n_confrontos ?? [10, 12],
    stakePerCombo: params.stake_per_ticket_brl ?? 3,
    minN: params.min_confrontos ?? 10,
    excludedMatchIds: new Set(params.excluded_match_ids ?? []),
  };
}

/**
 * @param {object[]} slots
 * @param {object} params
 * @returns {{ board: object, tickets: object[], meta: object }}
 */
export function run(slots, params = {}) {
  const gates = extractGates(params);

  // 1. Group slots by match_id
  const byMatch = new Map();
  for (const s of slots) {
    const key = s.match_id ?? s.opta_match_id ?? 'unknown';
    if (gates.excludedMatchIds.has(key)) continue;
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key).push(s);
  }

  // 2. Build Combos
  const combos = [];
  for (const matchSlots of byMatch.values()) {
    const combo = buildCombo(matchSlots, gates);
    if (combo.status === 'ready' || combo.status === 'weak' || combo.status === 'no_combo') {
      combos.push(combo);
    }
  }

  // 3. Validate Board
  const validation = validateBoard(combos, gates);

  // 4. Build Yankee Tickets
  const yankee = buildYankee(validation, gates);

  return {
    board: validation,
    tickets: yankee.status === 'ok' ? yankee.tickets : [],
    meta: {
      total_input: slots.length,
      matches: byMatch.size,
      board_status: validation.board_status,
      yankee_status: yankee.status,
      n_tickets: yankee.n_tickets,
      avg_ticket_odd: yankee.avg_ticket_odd,
      warnings: validation.warnings,
      skip_reason: yankee.skip_reason,
    },
  };
}
