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

function comboLeague(combo) {
  return combo?.legs?.[0]?.liga ?? combo?.league ?? 'unknown';
}

function comboRank(combo) {
  const explicitRank = Number(combo?.rank_score);
  if (Number.isFinite(explicitRank)) return explicitRank;
  const quality = Number(combo?.quality_score ?? 0);
  const jointProb = Number(combo?.joint_prob ?? 0);
  const odd = Number(combo?.combo_odd ?? 0);
  const comboEv = jointProb > 0 && odd > 0 ? (jointProb * odd) - 1 : 0;
  return quality + comboEv;
}

function sortForBoard(combos) {
  return [...(combos ?? [])].sort((a, b) => {
    const rankDiff = comboRank(b) - comboRank(a);
    if (rankDiff !== 0) return rankDiff;
    return Number(b?.combo_odd ?? 0) - Number(a?.combo_odd ?? 0);
  });
}

function selectForN(candidates, n, gates, diversityBoost = false) {
  const pool = sortForBoard(candidates);
  const selected = [];
  const used = new Set();
  const leagueCounts = {};
  const familyCounts = {};
  let teamOrHTCount = 0;

  while (selected.length < n) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const combo = pool[i];
      const league = comboLeague(combo);
      if ((leagueCounts[league] ?? 0) >= gates.maxPerLeague) continue;

      let score = comboRank(combo);
      if (diversityBoost) {
        const newFamilies = (combo.legs ?? []).filter((leg) => (familyCounts[leg.family] ?? 0) === 0).length;
        const hasTeamOrHT = (combo.legs ?? []).some(isTeamOrHTLeg);
        score += newFamilies * 0.35;
        if (teamOrHTCount < gates.minTeamOrHT && hasTeamOrHT) score += 0.75;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    const picked = pool[bestIdx];
    used.add(bestIdx);
    selected.push(picked);

    const league = comboLeague(picked);
    leagueCounts[league] = (leagueCounts[league] ?? 0) + 1;
    for (const leg of (picked.legs ?? [])) {
      familyCounts[leg.family] = (familyCounts[leg.family] ?? 0) + 1;
      if (isTeamOrHTLeg(leg)) teamOrHTCount++;
    }
  }

  return selected;
}

function selectBoardCombos(approved, gates) {
  const supported = Array.isArray(gates.supportedN) && gates.supportedN.length > 0
    ? gates.supportedN
    : [gates.minConfrontos];
  const targets = [...supported]
    .filter((n) => Number.isFinite(n) && n <= approved.length)
    .sort((a, b) => b - a);

  if (targets.length === 0) {
    return {
      selected: sortForBoard(approved),
      target_n: null,
      diversity: validateDiversity(approved, gates),
      exposure: validateExposure(approved, gates),
      status: 'insufficient',
    };
  }

  let best = null;
  for (const target of targets) {
    for (const diversityBoost of [false, true]) {
      const selected = selectForN(approved, target, gates, diversityBoost);
      const diversity = validateDiversity(selected, gates);
      const exposure = validateExposure(selected, gates);
      const candidate = { selected, target_n: target, diversity, exposure, status: 'ok' };
      if (!best || selected.length > best.selected.length) best = candidate;

      if (selected.length === target && diversity.pass && exposure.pass) {
        return candidate;
      }
    }

    const fallbackSelected = sortForBoard(approved).slice(0, target);
    const fallbackCandidate = {
      selected: fallbackSelected,
      target_n: target,
      diversity: validateDiversity(fallbackSelected, gates),
      exposure: validateExposure(fallbackSelected, gates),
      status: 'ok',
    };
    if (!best || fallbackSelected.length > best.selected.length) best = fallbackCandidate;
  }

  if (!best) {
    const selected = sortForBoard(approved).slice(0, gates.minConfrontos);
    return {
      selected,
      target_n: gates.minConfrontos,
      diversity: validateDiversity(selected, gates),
      exposure: validateExposure(selected, gates),
      status: 'insufficient',
    };
  }

  if (best.selected.length < best.target_n) best.status = 'insufficient';
  else if (!best.diversity.pass) best.status = 'diversity_fail';
  else if (!best.exposure.pass) best.status = 'exposure_fail';
  return best;
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
  if (distinctFamilies !== legs.length) {
    reasons.push(`famílias repetidas: ${distinctFamilies} distintas para ${legs.length} legs`);
  }

  const isException = legs.length > gates.legsPerConfronto;
  const oddMaxEffective = isException ? gates.oddMaxException : gates.oddMax;
  if (combo.combo_odd == null) {
    reasons.push('combo_odd ausente');
  } else if (combo.combo_odd < gates.oddMin || combo.combo_odd > oddMaxEffective) {
    reasons.push(`combo_odd ${combo.combo_odd} fora de [${gates.oddMin}, ${oddMaxEffective}]`);
  }

  if (combo.combo_ev != null && combo.combo_ev < (gates.comboEvMin ?? -Infinity)) {
    reasons.push(`combo_ev ${combo.combo_ev} < ${gates.comboEvMin}`);
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
  const approved_combos = [];
  const rejected = [];

  for (const combo of (combos ?? [])) {
    const v = validateConfronto(combo, gates);
    if (v.status === 'approved') {
      approved_combos.push(combo);
    } else {
      rejected.push({ match_id: combo?.match_id ?? combo?.opta_match_id ?? null, reasons: v.reasons });
    }
  }

  const selection = selectBoardCombos(approved_combos, gates);
  const ready_combos = selection.selected;

  const warnings = [];
  let status = selection.status;

  if (approved_combos.length < gates.minConfrontos) {
    status = 'insufficient';
    warnings.push(`apenas ${approved_combos.length} confrontos aprovados (mínimo ${gates.minConfrontos})`);
  } else if (selection.target_n != null && ready_combos.length < selection.target_n) {
    status = 'insufficient';
    warnings.push(`board selecionou ${ready_combos.length}/${selection.target_n} confrontos respeitando exposição`);
  }

  const diversity = selection.diversity;
  if (!diversity.pass) {
    if (status === 'ok') status = 'diversity_fail';
    warnings.push(...diversity.issues);
  }

  const exposure = selection.exposure;
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
      approved_count: approved_combos.length,
      ready_count: ready_combos.length,
      rejected_count: rejected.length,
      target_n: selection.target_n,
      family_counts: diversity.familyCounts,
      team_or_ht_legs: diversity.teamOrHTCount,
      total_legs: diversity.totalLegs,
      league_counts: exposure.leagueCounts,
    },
  };
}
