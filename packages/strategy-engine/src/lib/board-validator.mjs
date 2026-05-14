/**
 * @scoutcore/strategy-engine — board-validator.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Port puro do board-validator.js legado.
 * Regras:
 *   Per-combo:
 *     - n_legs ∈ [legs_min, legs_max]
 *     - combo_odd ∈ [odd_min, odd_max]
 *     - edge_pct ≥ ev_min_pct
 *   Board-level:
 *     - min_confrontos
 *     - min_families, min_team_or_ht, max_same_family_pct, max_per_league
 */

const KICKOFF_MIN_MINUTES = 30;
const PHANTOM_CAP_REAL_ODD = 200;
const PHANTOM_CAP_VIRTUAL = 50;

function isTeamOrHTLeg(leg) {
  const scope = leg?.scope ?? '';
  const period = leg?.period ?? '';
  return scope.startsWith('equipe_') || period === '1T' || period === 'HT';
}

function validateDiversity(combos, gates) {
  const familyCounts = {};
  let teamOrHTCount = 0;
  let totalLegs = 0;

  for (const c of combos) {
    for (const leg of (c.legs ?? [])) {
      familyCounts[leg.family] = (familyCounts[leg.family] ?? 0) + 1;
      totalLegs++;
      if (isTeamOrHTLeg(leg)) teamOrHTCount++;
    }
  }

  const issues = [];
  const uniqueFamilies = Object.keys(familyCounts).length;
  if (uniqueFamilies < gates.minFamilies) {
    issues.push(`${uniqueFamilies} famílias no board (precisa ≥${gates.minFamilies})`);
  }
  if (teamOrHTCount < gates.minTeamOrHT) {
    issues.push(`${teamOrHTCount} legs team/HT (precisa ≥${gates.minTeamOrHT})`);
  }
  if (totalLegs > 0) {
    for (const [fam, count] of Object.entries(familyCounts)) {
      const pct = count / totalLegs;
      if (pct > gates.maxSameFamilyPct) {
        issues.push(
          `família "${fam}" = ${(pct * 100).toFixed(0)}% > ${(gates.maxSameFamilyPct * 100).toFixed(0)}%`,
        );
      }
    }
  }

  return { pass: issues.length === 0, issues, familyCounts, teamOrHTCount, totalLegs };
}

function validateExposure(combos, gates) {
  const leagueCounts = {};
  for (const c of combos) {
    // Pegar liga de primeira leg (se houver)
    const lg = c.legs?.[0]?.liga ?? c.league ?? 'unknown';
    leagueCounts[lg] = (leagueCounts[lg] ?? 0) + 1;
  }
  const issues = [];
  for (const [lg, count] of Object.entries(leagueCounts)) {
    if (count > gates.maxPerLeague) {
      issues.push(`liga "${lg}": ${count} > ${gates.maxPerLeague}`);
    }
  }
  return { pass: issues.length === 0, issues, leagueCounts };
}

export function validateConfronto(combo, gates) {
  const reasons = [];

  if (!combo || combo.status !== 'ready') {
    reasons.push(`combo status=${combo?.status ?? 'null'} (esperado: ready)`);
    return { status: 'rejected', reasons };
  }

  if (combo.kickoff_utc) {
    const kickoff = new Date(combo.kickoff_utc);
    const minsDiff = (kickoff.getTime() - Date.now()) / 60_000;
    if (minsDiff > -120 && minsDiff < KICKOFF_MIN_MINUTES) {
      reasons.push(`kickoff em ${Math.round(minsDiff)}min (< ${KICKOFF_MIN_MINUTES}min)`);
    }
  }

  const legs = combo.legs ?? [];

  if (legs.length < gates.legsMinPerConfronto) {
    reasons.push(`n_legs=${legs.length} < min ${gates.legsMinPerConfronto}`);
  } else if (legs.length > gates.legsExceptionMax) {
    reasons.push(`n_legs=${legs.length} > max ${gates.legsExceptionMax}`);
  }

  const distinctFamilies = new Set(legs.map((l) => l.family)).size;
  if (legs.length >= 3 && distinctFamilies < 2) {
    reasons.push(`famílias repetidas: ${distinctFamilies} distintas para ${legs.length} legs`);
  }

  const isException = legs.length > gates.legsPerConfronto;
  const oddMaxEffective = isException ? gates.oddMaxException : gates.oddMax;
  if (combo.combo_odd == null) {
    reasons.push('combo_odd ausente');
  } else if (combo.combo_odd < gates.oddMin || combo.combo_odd > oddMaxEffective) {
    reasons.push(`combo_odd ${combo.combo_odd} fora de [${gates.oddMin}, ${oddMaxEffective}]`);
  }

  for (const leg of legs) {
    const edgePct = leg.edge_pct ?? null;
    if (edgePct != null && edgePct < gates.evMinPct) {
      reasons.push(`leg ${leg.market_key || leg.family}: edge_pct ${edgePct.toFixed(1)}% < ${gates.evMinPct}% (ev_min)`);
    }
  }

  for (const leg of legs) {
    const edgePct = leg.edge_pct ?? null;
    if (edgePct == null) continue;
    const hasRealOdd = leg.market_odd != null && leg.market_odd > 1;
    const cap = hasRealOdd ? PHANTOM_CAP_REAL_ODD : PHANTOM_CAP_VIRTUAL;
    if (edgePct > cap) {
      reasons.push(`leg ${leg.market_key || leg.family}: edge_pct ${edgePct.toFixed(1)}% > ${cap}% (phantom cap)`);
    }
  }

  return {
    status: reasons.length === 0 ? 'approved' : 'rejected',
    reasons,
  };
}

export function validateBoard(combos, gates) {
  const ready_combos = [];
  const rejected = [];

  for (const combo of (combos ?? [])) {
    const v = validateConfronto(combo, gates);
    if (v.status === 'approved') {
      ready_combos.push(combo);
    } else {
      rejected.push({ match_id: combo?.match_id ?? combo?.opta_match_id ?? null, reasons: v.reasons });
    }
  }

  const warnings = [];
  let status = 'ok';

  if (ready_combos.length < gates.minConfrontos) {
    status = 'insufficient';
    warnings.push(`apenas ${ready_combos.length} confrontos ready (mínimo ${gates.minConfrontos})`);
  }

  const diversity = validateDiversity(ready_combos, gates);
  if (!diversity.pass) {
    if (status === 'ok') status = 'diversity_fail';
    warnings.push(...diversity.issues);
  }

  const exposure = validateExposure(ready_combos, gates);
  if (!exposure.pass) {
    if (status === 'ok') status = 'exposure_fail';
    warnings.push(...exposure.issues);
  }

  return {
    ready_combos,
    rejected,
    board_status: status,
    warnings,
    stats: {
      total_input: combos?.length ?? 0,
      ready_count: ready_combos.length,
      rejected_count: rejected.length,
      family_counts: diversity.familyCounts,
      team_or_ht_legs: diversity.teamOrHTCount,
      total_legs: diversity.totalLegs,
      league_counts: exposure.leagueCounts,
    },
  };
}
