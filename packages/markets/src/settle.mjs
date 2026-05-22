// @scoutcore/markets/settle — função única que decide se um slot foi GREEN/RED/PUSH/VOID
// dado o resultado real. Sem ambiguidade: cada family×scope×period mapeia para
// um observable derivado de Result; cada direction+line vira inequação fixa.
//
// v2.0.0 (Refactor Superbet) — só famílias do WHITELIST_FAMILIES são settladas.
// Famílias removidas: dnb, htft, correct_score, margem, marca_*, handicap (gols),
// asian_handicap, asian_total, btts_algum_tempo, btts_ambos_tempos, escanteios_race,
// escanteios_exato. Slots dessas famílias devolvem outcome:'void' por design.

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

  if (fam === 'gols_oddeven') {
    const obs = m.period === 'HT' ? A.totalHt : A.totalFt;
    if (obs == null) return { outcome: 'void', reason: 'missing_observable' };
    const parity = obs % 2 === 0 ? 'par' : 'impar';
    return { outcome: parity === m.direction ? 'green' : 'red', observable: obs };
  }

  if (fam === 'btts') {
    const obs = m.period === 'HT' ? btts(A.homeHt, A.awayHt) : btts(A.homeFt, A.awayFt);
    if (obs == null) return { outcome: 'void', reason: 'missing_observable' };
    const want = m.direction === 'sim' ? 1 : 0;
    return { outcome: obs === want ? 'green' : 'red', observable: obs };
  }

  if (fam === '1x2') {
    const d = m.period === 'HT' ? dirOf(A.homeHt, A.awayHt) : dirOf(A.homeFt, A.awayFt);
    if (d == null) return { outcome: 'void', reason: 'missing_observable' };
    return { outcome: d === m.direction ? 'green' : 'red', observable: d };
  }

  if (fam === 'dupla') {
    const d = m.period === 'HT' ? dirOf(A.homeHt, A.awayHt) : dirOf(A.homeFt, A.awayFt);
    if (d == null) return { outcome: 'void', reason: 'missing_observable' };
    const wins = m.direction === '1x' ? ['home','draw']
               : m.direction === '12' ? ['home','away']
               : ['draw','away'];
    return { outcome: wins.includes(d) ? 'green' : 'red', observable: d };
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
  if (fam === 'escanteios_oddeven') {
    const tot = pickCorners({ scope: 'total', period: m.period }, result);
    if (tot == null) return { outcome: 'void', reason: 'missing_observable' };
    const parity = tot % 2 === 0 ? 'par' : 'impar';
    return { outcome: parity === m.direction ? 'green' : 'red', observable: tot };
  }
  if (fam === 'escanteios_handicap') {
    const h = pickCorners({ scope: 'home', period: m.period || 'FT' }, result);
    const a = pickCorners({ scope: 'away', period: m.period || 'FT' }, result);
    if (h == null || a == null) return { outcome: 'void', reason: 'missing_observable' };
    if (m.line == null) return { outcome: 'void', reason: 'missing_line' };
    // direction esperado: 'home' ou 'away'. Linha é assinada para o lado escolhido.
    const dirCat = String(m.direction || '').split('_')[0];
    const eff = (dirCat === 'home') ? (h + m.line) - a : (a + m.line) - h;
    if (eff > 0) return { outcome: 'green', observable: { home: h, away: a } };
    if (eff < 0) return { outcome: 'red',   observable: { home: h, away: a } };
    return { outcome: 'push', observable: { home: h, away: a } };
  }

  if (fam === 'chutes') {
    const obs = pickShots(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }
  if (fam === 'chutes_1x2') {
    const h = pickShots({ scope: 'home', period: m.period || 'FT' }, result);
    const a = pickShots({ scope: 'away', period: m.period || 'FT' }, result);
    if (h == null || a == null) return { outcome: 'void', reason: 'missing_observable' };
    const d = dirOf(h, a);
    return { outcome: d === m.direction ? 'green' : 'red', observable: { home: h, away: a } };
  }
  if (fam === 'chutes_alvo') {
    const obs = pickShotsOnTarget(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }
  if (fam === 'chutes_alvo_1x2') {
    const h = pickShotsOnTarget({ scope: 'home', period: m.period || 'FT' }, result);
    const a = pickShotsOnTarget({ scope: 'away', period: m.period || 'FT' }, result);
    if (h == null || a == null) return { outcome: 'void', reason: 'missing_observable' };
    const d = dirOf(h, a);
    return { outcome: d === m.direction ? 'green' : 'red', observable: { home: h, away: a } };
  }

  if (fam === 'cartoes') {
    const obs = pickCards(m, result);
    return compareOverUnder(obs, m.line, m.direction);
  }
  if (fam === 'cartoes_1x2') {
    const h = pickCards({ scope: 'home', period: m.period || 'FT' }, result);
    const a = pickCards({ scope: 'away', period: m.period || 'FT' }, result);
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
  if (fam === 'desarmes') {
    const obs = pickGeneric(m, result, 'home_tackles', 'away_tackles');
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
