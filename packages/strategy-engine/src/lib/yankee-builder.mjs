/**
 * @scoutcore/strategy-engine — yankee-builder.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Port puro do yankee-builder.js legado.
 * Constrói tickets BIBD a partir de um board de combos válidos.
 */

import { getDesign } from './designs.mjs';

export function buildYankee(validation, gates) {
  if (!validation || validation.board_status !== 'ok') {
    return {
      status: 'skipped',
      skip_reason: `board_status=${validation?.board_status ?? 'null'} (esperado: ok)`,
      n_confrontos: 0,
      n_truncated: 0,
      n_tickets: 0,
      tickets: [],
      stake_per_combo: gates.stakePerCombo,
      total_stake_brl: 0,
      avg_ticket_odd: 0,
    };
  }

  const ready = validation.ready_combos ?? [];
  const total = ready.length;

  if (total < gates.minN) {
    return {
      status: 'skipped',
      skip_reason: `ready_combos=${total} < min ${gates.minN}`,
      n_confrontos: total,
      n_truncated: 0,
      n_tickets: 0,
      tickets: [],
      stake_per_combo: gates.stakePerCombo,
      total_stake_brl: 0,
      avg_ticket_odd: 0,
    };
  }

  const candidates = gates.supportedN.filter((o) => o <= total).sort((a, b) => b - a);
  const n = candidates[0];
  if (n == null) {
    return {
      status: 'skipped',
      skip_reason: `nenhum N suportado em ${gates.supportedN.join(',')} cabe em ${total} combos`,
      n_confrontos: total,
      n_truncated: 0,
      n_tickets: 0,
      tickets: [],
      stake_per_combo: gates.stakePerCombo,
      total_stake_brl: 0,
      avg_ticket_odd: 0,
    };
  }

  const useCombos = ready.slice(0, n);
  const truncated = total - n;
  const design = getDesign(n);
  if (!design) {
    return {
      status: 'skipped',
      skip_reason: `design indisponível para N=${n}`,
      n_confrontos: n,
      n_truncated: truncated,
      n_tickets: 0,
      tickets: [],
      stake_per_combo: gates.stakePerCombo,
      total_stake_brl: 0,
      avg_ticket_odd: 0,
    };
  }

  const tickets = design.map((indices, ticketIdx) => {
    const picked = indices.map((i) => useCombos[i]);
    const ticket_odd = Number(picked.reduce((acc, c) => acc * Number(c.combo_odd ?? 1), 1).toFixed(4));
    return {
      ticket_idx: ticketIdx,
      status: 'pending',
      confronto_indices: indices.slice(),
      match_ids: picked.map((c) => c.match_id ?? c.opta_match_id ?? null),
      boards: picked.map((c) => ({
        match_id: c.match_id ?? c.opta_match_id ?? null,
        status: 'pending',
        legs: (c.legs || []).map((l) => ({
          market_key: l.market_key,
          status: 'pending'
        }))
      })),
      ticket_odd,
      stake_brl: gates.stakePerCombo,
    };
  });

  const total_stake_brl = Number((tickets.length * gates.stakePerCombo).toFixed(2));
  const avg_ticket_odd = Number((tickets.reduce((s, t) => s + t.ticket_odd, 0) / tickets.length).toFixed(4));

  return {
    status: 'ok',
    n_confrontos: n,
    n_truncated: truncated,
    n_tickets: tickets.length,
    tickets,
    stake_per_combo: gates.stakePerCombo,
    total_stake_brl,
    avg_ticket_odd,
  };
}
