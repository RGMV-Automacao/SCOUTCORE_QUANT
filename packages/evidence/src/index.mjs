// @scoutcore/evidence — gera bloco evidence (SPEC §4.3).
//
// API:
//   buildMatchEvidenceContext({ repo, match, asOf, period }) // 1x por confronto
//     → { h2h, home_split, away_split, league_priors, engine_b_available }
//   buildEvidence(slot, ctx)                                  // 1x por slot
//     → { drivers[], top_k, notes[], context, engine_b_available }
//
// Engine B disponibilidade: probe síncrono via env ENGINE_B_AVAILABLE=true|false
// (preenchido pelo orquestrador conforme health check do sidecar @4055).

const TOP_K = 6;

export const EVIDENCE_VERSION = '0.2.0';

function safeParseDate(d) {
  if (!d) return null;
  return typeof d === 'string' ? d : new Date(d).toISOString().slice(0, 10);
}

function summarizeRecent(rows, focusTeam) {
  if (!rows || rows.length === 0) return null;
  let n = 0, wins = 0, draws = 0, losses = 0;
  let goalsFor = 0, goalsAgainst = 0, btts = 0, over25 = 0;
  for (const r of rows) {
    if (r.home_goals == null || r.away_goals == null) continue;
    const isHome = r.home_team === focusTeam;
    const gf = isHome ? r.home_goals : r.away_goals;
    const ga = isHome ? r.away_goals : r.home_goals;
    n += 1;
    goalsFor += gf; goalsAgainst += ga;
    if (gf > ga) wins += 1;
    else if (gf === ga) draws += 1;
    else losses += 1;
    if (r.home_goals > 0 && r.away_goals > 0) btts += 1;
    if (r.home_goals + r.away_goals > 2) over25 += 1;
  }
  if (n === 0) return null;
  return {
    n,
    wins, draws, losses,
    avg_gf: +(goalsFor / n).toFixed(2),
    avg_ga: +(goalsAgainst / n).toFixed(2),
    btts_pct: +(btts / n).toFixed(3),
    over25_pct: +(over25 / n).toFixed(3),
  };
}

function summarizeH2H(rows, home, away, limit = 5) {
  if (!rows || rows.length === 0) return null;
  const direct = rows.filter((r) => (
    (r.home_team === home && r.away_team === away) ||
    (r.home_team === away && r.away_team === home)
  )).slice(0, limit);
  if (direct.length === 0) return null;
  let homeWins = 0, draws = 0, awayWins = 0;
  let totalGoals = 0, btts = 0, over25 = 0;
  for (const r of direct) {
    if (r.home_goals == null || r.away_goals == null) continue;
    const homeIsHome = r.home_team === home;
    const homeG = homeIsHome ? r.home_goals : r.away_goals;
    const awayG = homeIsHome ? r.away_goals : r.home_goals;
    if (homeG > awayG) homeWins += 1;
    else if (homeG === awayG) draws += 1;
    else awayWins += 1;
    totalGoals += homeG + awayG;
    if (r.home_goals > 0 && r.away_goals > 0) btts += 1;
    if (r.home_goals + r.away_goals > 2) over25 += 1;
  }
  return {
    n: direct.length,
    home_wins: homeWins,
    draws,
    away_wins: awayWins,
    avg_total_goals: +(totalGoals / direct.length).toFixed(2),
    btts_pct: +(btts / direct.length).toFixed(3),
    over25_pct: +(over25 / direct.length).toFixed(3),
  };
}

export function engineBAvailable() {
  const v = process.env.ENGINE_B_AVAILABLE;
  if (v == null) return false;
  return /^(1|true|yes)$/i.test(v.trim());
}

/**
 * Constrói contexto de evidência uma vez por confronto.
 */
export function buildMatchEvidenceContext({ repo, match, asOf, period = 'FT' } = {}) {
  if (!repo || !match) {
    return {
      h2h: null,
      home_split: null,
      away_split: null,
      league_priors: null,
      engine_b_available: engineBAvailable(),
    };
  }
  const date = safeParseDate(asOf ?? match.data_partida ?? match.date);
  const liga = match.liga;
  const temporada = match.temporada ?? match.season ?? null;

  let h2h = null, homeSplit = null, awaySplit = null, leaguePriors = null;
  try {
    const homeRecent = repo.getRecentMatches?.(match.home, liga, date, 10) ?? [];
    homeSplit = summarizeRecent(homeRecent, match.home);
    h2h = summarizeH2H(homeRecent, match.home, match.away, 5);
  } catch (e) {
    homeSplit = { error: String(e.message || e) };
  }
  try {
    const awayRecent = repo.getRecentMatches?.(match.away, liga, date, 10) ?? [];
    awaySplit = summarizeRecent(awayRecent, match.away);
    if (!h2h) h2h = summarizeH2H(awayRecent, match.home, match.away, 5);
  } catch (e) {
    awaySplit = { error: String(e.message || e) };
  }
  try {
    if (temporada != null) {
      leaguePriors = repo.getLeaguePriors?.({ liga, temporada, period, asOf: date }) ?? null;
    }
  } catch (e) {
    leaguePriors = { error: String(e.message || e) };
  }
  return {
    h2h,
    home_split: homeSplit,
    away_split: awaySplit,
    league_priors: leaguePriors,
    engine_b_available: engineBAvailable(),
  };
}

export function buildEvidence(slot, ctx = {}) {
  const prov = slot.provenance ?? {};
  const drivers = [];
  const notes = [];

  if (prov.lambda_home != null && prov.lambda_away != null) {
    drivers.push({ label: 'lambda_total_ft', value: +(prov.lambda_home + prov.lambda_away).toFixed(3), kind: 'engine_a_input' });
    drivers.push({ label: 'lambda_home', value: +prov.lambda_home.toFixed(3), kind: 'engine_a_input' });
    drivers.push({ label: 'lambda_away', value: +prov.lambda_away.toFixed(3), kind: 'engine_a_input' });
  }
  if (prov.attH != null && prov.defA != null) {
    drivers.push({
      label: 'home_attack_x_away_defense',
      value: +(prov.attH * prov.defA).toFixed(3),
      kind: 'engine_a_strength',
    });
  }

  const me = ctx.matchEvidence;
  if (me) {
    if (me.h2h && me.h2h.n) {
      drivers.push({ label: 'h2h_avg_total_goals', value: me.h2h.avg_total_goals, kind: 'h2h', n: me.h2h.n });
      drivers.push({ label: 'h2h_btts_pct', value: me.h2h.btts_pct, kind: 'h2h', n: me.h2h.n });
    }
    if (me.home_split && me.home_split.n) {
      drivers.push({ label: 'home_recent_avg_gf', value: me.home_split.avg_gf, kind: 'split', n: me.home_split.n });
      drivers.push({ label: 'home_recent_btts_pct', value: me.home_split.btts_pct, kind: 'split', n: me.home_split.n });
    }
    if (me.away_split && me.away_split.n) {
      drivers.push({ label: 'away_recent_avg_gf', value: me.away_split.avg_gf, kind: 'split', n: me.away_split.n });
      drivers.push({ label: 'away_recent_btts_pct', value: me.away_split.btts_pct, kind: 'split', n: me.away_split.n });
    }
    if (me.league_priors) {
      const lp = me.league_priors;
      if (lp.lambda_total != null) drivers.push({ label: 'liga_prior_lambda_total', value: +Number(lp.lambda_total).toFixed(3), kind: 'league_prior' });
      if (lp.btts_rate != null) drivers.push({ label: 'liga_prior_btts_rate', value: +Number(lp.btts_rate).toFixed(3), kind: 'league_prior' });
    }
    if (me.h2h && me.h2h.n < 3) notes.push(`h2h_low_sample n=${me.h2h.n}`);
  }

  return {
    drivers: drivers.slice(0, TOP_K),
    top_k: TOP_K,
    notes,
    context: { home: ctx.home, away: ctx.away, liga: ctx.liga },
    engine_b_available: me?.engine_b_available ?? engineBAvailable(),
  };
}
