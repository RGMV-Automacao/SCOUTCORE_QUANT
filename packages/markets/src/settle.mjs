// @scoutcore/markets/settle — função única que decide se um slot foi GREEN/RED/PUSH/VOID
// dado o resultado real. Sem ambiguidade: cada family×scope×period mapeia para
// um observable derivado de Result; cada direction+line vira inequação fixa.
//
// Asiáticos (asian_total, asian_handicap) podem retornar 'half_green' / 'half_red'
// quando a quarter-line implica em metade da banca em push. Settle reporta o
// outcome categórico + um campo `payoutMult` para o caller multiplicar pela odd.

import { parseMarketKey } from './registry.mjs';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
function buildAggregates(result) {
  const r = result || {};
  const homeFt = r.home_goals_ft, awayFt = r.away_goals_ft;
  const homeHt = r.home_goals_ht, awayHt = r.away_goals_ht;
  const totalFt = (homeFt != null && awayFt != null) ? homeFt + awayFt : null;
  const totalHt = (homeHt != null && awayHt != null) ? homeHt + awayHt : null;
  const total2T = (totalFt != null && totalHt != null) ? totalFt - totalHt : null;
  const home2T = (homeFt != null && homeHt != null) ? homeFt - homeHt : null;
  const away2T = (awayFt != null && awayHt != null) ? awayFt - awayHt : null;
  return { homeFt, awayFt, homeHt, awayHt, totalFt, totalHt, total2T, home2T, away2T };
}

function dirOf(home, away) {
  if (home == null || away == null) return null;
  if (home > away) return 'home';
  if (home === away) return 'draw';
  return 'away';
}

function btts(home, away) {
  if (home == null || away == null) return null;
  return (home > 0 && away > 0) ? 1 : 0;
}

function compareOverUnder(obs, line, dir) {
  if (obs == null) return { outcome: 'void', reason: 'missing_observable' };
  if (line == null) return { outcome: 'void', reason: 'missing_line' };
  if (obs > line) return { outcome: dir === 'over' ? 'green' : 'red', observable: obs };
  if (obs < line) return { outcome: dir === 'under' ? 'green' : 'red', observable: obs };
  return { outcome: 'push', observable: obs };
}

function compareAsian(obs, line, dir) {
  if (obs == null) return { outcome: 'void', reason: 'missing_observable' };
  if (line == null) return { outcome: 'void', reason: 'missing_line' };
  const frac = Math.abs(line - Math.trunc(line));
  if (Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9) {
    const lo = line - 0.25, hi = line + 0.25;
    const r1 = compareOverUnder(obs, lo, dir);
    const r2 = compareOverUnder(obs, hi, dir);
    return combineHalves(r1, r2, obs);
  }
  return compareOverUnder(obs, line, dir);
}

function combineHalves(r1, r2, obs) {
  const code = (o) => o === 'green' ? 'G' : o === 'red' ? 'R' : o === 'push' ? 'P' : 'V';
  const a = code(r1.outcome), b = code(r2.outcome);
  if (a === 'V' || b === 'V') return { outcome: 'void', reason: r1.reason || r2.reason, observable: obs };
  const key = a + b;
  switch (key) {
    case 'GG': return { outcome: 'green', payoutMult: 1.0, observable: obs };
    case 'RR': return { outcome: 'red', payoutMult: 0.0, observable: obs };
    case 'GP': case 'PG': return { outcome: 'half_green', payoutMult: 0.5, observable: obs };
    case 'RP': case 'PR': return { outcome: 'half_red', payoutMult: -0.5, observable: obs };
    default: return { outcome: 'push', payoutMult: 0.0, observable: obs };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────
export function settle(slot, result) {
  const m = typeof slot === 'string' ? parseMarketKey(slot) : slot;
  if (!m) return { outcome: 'void', reason: 'unknown_market' };

  const A = buildAggregates(result);
  const fam = m.family;

  if (fam === 'gols') {
    const obs = pickGoals(m, A);
    return compareOverUnder(obs, m.line, m.direction);
  }

  if (fam === 'btts') {
    const obs = m.period === 'HT' ? btts(A.homeHt, A.awayHt) : btts(A.homeFt, A.awayFt);
    if (obs == null) return { outcome: 'void', reason: 'missing_observable' };
    const want = m.direction === 'sim' ? 1 : 0;
    return { outcome: obs === want ? 'green' : 'red', observable: obs };
  }

  if (fam === 'btts_ambos_tempos') {
    const ht = btts(A.homeHt, A.awayHt);
    const tt2 = btts(A.home2T, A.away2T);
    if (ht == null || tt2 == null) return { outcome: 'void', reason: 'missing_observable' };
    const ambos = (ht === 1 && tt2 === 1) ? 1 : 0;
    const want = m.direction === 'sim' ? 1 : 0;
    return { outcome: ambos === want ? 'green' : 'red', observable: ambos };
  }

  if (fam === 'btts_algum_tempo') {
    const ht = btts(A.homeHt, A.awayHt);
    const tt2 = btts(A.home2T, A.away2T);
    if (ht == null || tt2 == null) return { outcome: 'void', reason: 'missing_observable' };
    const algum = (ht === 1 || tt2 === 1) ? 1 : 0;
    const want = m.direction === 'sim' ? 1 : 0;
    return { outcome: algum === want ? 'green' : 'red', observable: algum };
  }

  if (fam === '1x2') {
    const d = m.period === 'HT' ? dirOf(A.homeHt, A.awayHt)
            : m.period === '2T' ? dirOf(A.home2T, A.away2T)
            : dirOf(A.homeFt, A.awayFt);
    if (d == null) return { outcome: 'void', reason: 'missing_observable' };
    return { outcome: d === m.direction ? 'green' : 'red', observable: d };
  }

  if (fam === 'dupla') {
    const d = m.period === 'HT' ? dirOf(A.homeHt, A.awayHt)
            : m.period === '2T' ? dirOf(A.home2T, A.away2T)
            : dirOf(A.homeFt, A.awayFt);
    if (d == null) return { outcome: 'void', reason: 'missing_observable' };
    const wins = m.direction === '1x' ? ['home','draw']
               : m.direction === '12' ? ['home','away']
               : ['draw','away'];
    return { outcome: wins.includes(d) ? 'green' : 'red', observable: d };
  }

  if (fam === 'dnb') {
    const d = m.period === 'HT' ? dirOf(A.homeHt, A.awayHt)
            : m.period === '2T' ? dirOf(A.home2T, A.away2T)
            : dirOf(A.homeFt, A.awayFt);
    if (d == null) return { outcome: 'void', reason: 'missing_observable' };
    if (d === 'draw') return { outcome: 'push', observable: d };
    return { outcome: d === m.direction ? 'green' : 'red', observable: d };
  }

  if (fam === 'htft') {
    const dHT = dirOf(A.homeHt, A.awayHt);
    const dFT = dirOf(A.homeFt, A.awayFt);
    if (!dHT || !dFT) return { outcome: 'void', reason: 'missing_observable' };
    const code = (s) => s === 'home' ? '1' : s === 'draw' ? 'x' : '2';
    const obs = `${code(dHT)}_${code(dFT)}`;
    return { outcome: obs === m.direction ? 'green' : 'red', observable: obs };
  }

  if (fam === 'correct_score') {
    const h = m.period === 'HT' ? A.homeHt : A.homeFt;
    const a = m.period === 'HT' ? A.awayHt : A.awayFt;
    if (h == null || a == null) return { outcome: 'void', reason: 'missing_observable' };
    const obs = `${h}_${a}`;
    if (m.direction === 'other_home') {
      const ok = !inGrid(h, a, 4) && h > a;
      return { outcome: ok ? 'green' : 'red', observable: obs };
    }
    if (m.direction === 'other_draw') {
      const ok = !inGrid(h, a, 4) && h === a;
      return { outcome: ok ? 'green' : 'red', observable: obs };
    }
    if (m.direction === 'other_away') {
      const ok = !inGrid(h, a, 4) && h < a;
      return { outcome: ok ? 'green' : 'red', observable: obs };
    }
    if (m.direction === 'other') {
      const ok = !inGrid(h, a, 2);
      return { outcome: ok ? 'green' : 'red', observable: obs };
    }
    return { outcome: obs === m.direction ? 'green' : 'red', observable: obs };
  }

  if (fam === 'margem') {
    if (A.homeFt == null || A.awayFt == null) return { outcome: 'void', reason: 'missing_observable' };
    const diff = A.homeFt - A.awayFt;
    let cat;
    if (diff === 0) cat = 'draw';
    else if (diff > 0) cat = diff >= 4 ? 'home_4_plus' : `home_${diff}`;
    else cat = -diff >= 4 ? 'away_4_plus' : `away_${-diff}`;
    return { outcome: cat === m.direction ? 'green' : 'red', observable: cat };
  }

  if (fam === 'marca_primeiro') {
    const obs = result?.first_goal_team ?? null;
    if (obs == null) return { outcome: 'void', reason: 'missing_observable' };
    return { outcome: obs === m.direction ? 'green' : 'red', observable: obs };
  }
  if (fam === 'marca_ultimo') {
    const obs = result?.last_goal_team ?? null;
    if (obs == null) return { outcome: 'void', reason: 'missing_observable' };
    return { outcome: obs === m.direction ? 'green' : 'red', observable: obs };
  }
  if (fam === 'marca') {
    if (A.homeFt == null || A.awayFt == null) return { outcome: 'void', reason: 'missing_observable' };
    const homeMarcou = A.homeFt > 0;
    const awayMarcou = A.awayFt > 0;
    const [lado, sn] = m.direction.split('_');
    const fato = lado === 'home' ? homeMarcou : awayMarcou;
    const want = sn === 'sim';
    return { outcome: fato === want ? 'green' : 'red', observable: { home: homeMarcou, away: awayMarcou } };
  }

  if (fam === 'handicap') {
    if (A.homeFt == null || A.awayFt == null) return { outcome: 'void', reason: 'missing_observable' };
    const eff = (A.homeFt + (m.line ?? 0)) - A.awayFt;
    const obs = eff > 0 ? 'home' : eff === 0 ? 'draw' : 'away';
    const dirCat = m.direction.split('_')[0];
    return { outcome: obs === dirCat ? 'green' : 'red', observable: obs };
  }

  if (fam === 'asian_handicap') {
    if (A.homeFt == null || A.awayFt == null) return { outcome: 'void', reason: 'missing_observable' };
    const dirCat = m.direction.startsWith('home') ? 'home' : 'away';
    return settleAsianHandicap(A.homeFt, A.awayFt, m.line, dirCat);
  }

  if (fam === 'asian_total') {
    const obs = m.period === 'HT' ? A.totalHt : A.totalFt;
    return compareAsian(obs, m.line, m.direction);
  }

  if (fam === 'escanteios') {
    const obs = pickCorners(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }
  if (fam === 'escanteios_1x2') {
    const h = pickCorners({ scope: 'home', period: m.period }, result);
    const a = pickCorners({ scope: 'away', period: m.period }, result);
    if (h == null || a == null) return { outcome: 'void', reason: 'missing_observable' };
    const d = dirOf(h, a);
    return { outcome: d === m.direction ? 'green' : 'red', observable: { home: h, away: a } };
  }
  if (fam === 'escanteios_race') {
    if (result?.corners_timeline == null) return { outcome: 'void', reason: 'missing_corners_timeline' };
    const winner = raceWinner(result.corners_timeline, m.line);
    return { outcome: winner === m.direction ? 'green' : 'red', observable: winner };
  }
  if (fam === 'escanteios_exato') {
    const tot = pickCorners({ scope: 'total', period: 'FT' }, result);
    if (tot == null) return { outcome: 'void', reason: 'missing_observable' };
    if (m.direction === 'eq_15_plus') return { outcome: tot >= 15 ? 'green' : 'red', observable: tot };
    return { outcome: tot === m.line ? 'green' : 'red', observable: tot };
  }

  if (fam === 'chutes') {
    const obs = pickShots(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }
  if (fam === 'chutes_alvo') {
    const obs = pickShotsOnTarget(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }

  if (fam === 'cartoes') {
    const obs = pickCards(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }
  if (fam === 'cartoes_1x2') {
    const h = pickCards({ scope: 'home', period: 'FT' }, result);
    const a = pickCards({ scope: 'away', period: 'FT' }, result);
    if (h == null || a == null) return { outcome: 'void', reason: 'missing_observable' };
    const d = dirOf(h, a);
    return { outcome: d === m.direction ? 'green' : 'red', observable: { home: h, away: a } };
  }

  if (fam === 'faltas') {
    const obs = pickFouls(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }

  if (fam === 'impedimentos') {
    const obs = pickGeneric(m, result, 'home_offsides', 'away_offsides');
    return compareOverUnder(obs, m.line, m.direction);
  }
  if (fam === 'defesas') {
    const obs = pickGeneric(m, result, 'home_saves', 'away_saves');
    return compareOverUnder(obs, m.line, m.direction);
  }

  return { outcome: 'void', reason: 'unsupported_family:' + fam };
}

// ─────────────────────────────────────────────────────────────────────────
// Pickers
// ─────────────────────────────────────────────────────────────────────────
function pickGoals(m, A) {
  if (m.period === 'FT') {
    if (m.scope === 'total') return A.totalFt;
    if (m.scope === 'home')  return A.homeFt;
    if (m.scope === 'away')  return A.awayFt;
  }
  if (m.period === 'HT') {
    if (m.scope === 'total') return A.totalHt;
    if (m.scope === 'home')  return A.homeHt;
    if (m.scope === 'away')  return A.awayHt;
  }
  if (m.period === '2T') {
    if (m.scope === 'total') return A.total2T;
    if (m.scope === 'home')  return A.home2T;
    if (m.scope === 'away')  return A.away2T;
  }
  return null;
}

function pickCorners(m, r) {
  if (!r) return null;
  if (m.period === 'HT') {
    if (m.scope === 'total') return (r.home_corners_ht != null && r.away_corners_ht != null) ? r.home_corners_ht + r.away_corners_ht : null;
    if (m.scope === 'home')  return r.home_corners_ht;
    if (m.scope === 'away')  return r.away_corners_ht;
  }
  if (m.scope === 'total') return (r.home_corners != null && r.away_corners != null) ? r.home_corners + r.away_corners : null;
  if (m.scope === 'home')  return r.home_corners;
  if (m.scope === 'away')  return r.away_corners;
  return null;
}

function pickShots(m, r) {
  if (!r) return null;
  const hk = m.period === 'HT' ? 'home_shots_ht' : 'home_shots';
  const ak = m.period === 'HT' ? 'away_shots_ht' : 'away_shots';
  const h = r[hk], a = r[ak];
  if (m.scope === 'total') return (h != null && a != null) ? h + a : null;
  if (m.scope === 'home')  return h ?? null;
  if (m.scope === 'away')  return a ?? null;
  return null;
}

function pickShotsOnTarget(m, r) {
  if (!r) return null;
  const hk = m.period === 'HT' ? 'home_shots_on_target_ht' : 'home_shots_on_target';
  const ak = m.period === 'HT' ? 'away_shots_on_target_ht' : 'away_shots_on_target';
  const h = r[hk] ?? null;
  const a = r[ak] ?? null;
  if (m.scope === 'total') return (h != null && a != null) ? h + a : null;
  if (m.scope === 'home')  return h;
  if (m.scope === 'away')  return a;
  return null;
}

function pickCards(m, r) {
  if (!r) return null;
  const isHT = m.period === 'HT';
  const hyc = isHT ? r.home_yc_ht : r.home_yc;
  const ayc = isHT ? r.away_yc_ht : r.away_yc;
  const hrc = isHT ? r.home_rc_ht : r.home_rc;
  const arc = isHT ? r.away_rc_ht : r.away_rc;
  if (hyc == null && ayc == null) return null;
  const hp = (hyc ?? 0) + 2 * (hrc ?? 0);
  const ap = (ayc ?? 0) + 2 * (arc ?? 0);
  if (m.scope === 'total') return hp + ap;
  if (m.scope === 'home')  return hp;
  if (m.scope === 'away')  return ap;
  return null;
}

function pickFouls(m, r) {
  if (!r) return null;
  const hk = m.period === 'HT' ? 'home_fouls_ht' : 'home_fouls';
  const ak = m.period === 'HT' ? 'away_fouls_ht' : 'away_fouls';
  const h = r[hk], a = r[ak];
  if (m.scope === 'total') return (h != null && a != null) ? h + a : null;
  if (m.scope === 'home')  return h ?? null;
  if (m.scope === 'away')  return a ?? null;
  return null;
}

function pickGeneric(m, r, homeKey, awayKey) {
  if (!r) return null;
  const hk = m.period === 'HT' ? `${homeKey}_ht` : homeKey;
  const ak = m.period === 'HT' ? `${awayKey}_ht` : awayKey;
  const h = r[hk], a = r[ak];
  if (m.scope === 'total') return (h != null && a != null) ? h + a : null;
  if (m.scope === 'home')  return h ?? null;
  if (m.scope === 'away')  return a ?? null;
  return null;
}

function inGrid(h, a, max) {
  return h <= max && a <= max;
}

function raceWinner(timeline, n) {
  let home = 0, away = 0;
  for (const e of timeline) {
    if (e.team === 'home') home++;
    else if (e.team === 'away') away++;
    if (home >= n) return 'home';
    if (away >= n) return 'away';
  }
  return 'none';
}

function settleAsianHandicap(homeGoals, awayGoals, line, dirCat) {
  const sign = dirCat === 'home' ? 1 : -1;
  const effLine = dirCat === 'home' ? line : -line;
  const diff = (homeGoals - awayGoals) * sign + effLine;
  const frac = Math.abs(line - Math.trunc(line));
  const isQuarter = Math.abs(frac - 0.25) < 1e-9 || Math.abs(frac - 0.75) < 1e-9;
  if (isQuarter) {
    const lo = effLine - 0.25, hi = effLine + 0.25;
    const r1 = singleAH(homeGoals, awayGoals, lo, sign);
    const r2 = singleAH(homeGoals, awayGoals, hi, sign);
    return combineHalves(r1, r2, { home: homeGoals, away: awayGoals });
  }
  if (Math.abs(frac - 0.5) < 1e-9) {
    return { outcome: diff > 0 ? 'green' : 'red', observable: { home: homeGoals, away: awayGoals } };
  }
  if (diff > 0) return { outcome: 'green', payoutMult: 1.0, observable: { home: homeGoals, away: awayGoals } };
  if (diff === 0) return { outcome: 'push', payoutMult: 0.0, observable: { home: homeGoals, away: awayGoals } };
  return { outcome: 'red', payoutMult: 0.0, observable: { home: homeGoals, away: awayGoals } };
}

function singleAH(h, a, effLine, sign) {
  const d = (h - a) * sign + effLine;
  if (d > 0) return { outcome: 'green' };
  if (d < 0) return { outcome: 'red' };
  return { outcome: 'push' };
}
