// /v1/predict — handler honesto.
// Fluxo: validate request → repo lookups → engine A → curinga → evidence → response.

import { randomUUID } from 'node:crypto';
import { PredictRequestZ, PredictionResponseZ, safeParse } from '@scoutcore/contracts';
import { predict as predictA, coveredFamilies } from '@scoutcore/engine-a';
import { combine, A_ONLY_CONFIDENCE_FACTOR } from '@scoutcore/curinga';
import { buildEvidence, buildMatchEvidenceContext } from '@scoutcore/evidence';
import * as engineB from '@scoutcore/engine-b-bridge';
import { normalizeMarketSnapshot } from '@scoutcore/markets';
import * as QG from '@scoutcore/quality-gates';
import { loadCalibrationMap, getCalib, applyCalibrationToSlot } from '@scoutcore/calibration';
import { loadIsotonicMap, getIsotonic, applyIsotonicToSlot } from '@scoutcore/isotonic';
import { runScout, applyScoutOverlay } from '@scoutcore/scout';
import { buildDbOddsResolver } from './odds-resolver.mjs';
import { buildSignature } from './engine-signature.mjs';

// Ligas com calendário europeu (temporada Y/Y+1, começa em agosto).
const EURO_LIGAS = new Set([
  'premier-league', 'la-liga', 'bundesliga', 'ligue-1', 'serie-a',
  'championship', 'la-liga-2', 'serie-b-italia', 'primeira-liga',
]);

function inferTemporada(dateIso, liga) {
  const y = Number(dateIso.slice(0, 4));
  const mo = Number(dateIso.slice(5, 7));
  if (EURO_LIGAS.has(liga)) {
    // Ago-Dez → y/y+1 (nova temporada); Jan-Jul → (y-1)/y (temporada em curso)
    return mo >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
  }
  return String(y);
}

export function registerPredict(app, { repo }) {
  app.post('/v1/predict', async (req, reply) => {
    const out = await runPredict({ repo, body: req.body, log: app.log });
    if (out.__error) return reply.code(out.__status).send(out.__body);
    return reply.send(out);
  });
}

/**
 * Núcleo do predict, isolado para reuso (batch, jobs, replay).
 * Retorna o response normal OU `{ __error: true, __status, __body }` em erro.
 */
export async function runPredict({ repo, body, log = console, persist = true, run_id: callerRunId, onSubPhase, oddsResolver = null }) {
    const t0 = Date.now();
    const emit = (phase) => { try { onSubPhase?.(phase); } catch { /* observador opcional, nunca quebra */ } };
    const parsed = safeParse(PredictRequestZ, body);
    if (!parsed.ok) {
      return { __error: true, __status: 400, __body: { error: 'invalid_request', issues: parsed.errors } };
    }
    const r = parsed.value;
    const m = r.match;
    const temporada = inferTemporada(m.date, m.liga);
    const asOf = m.date;
    const warnings = [];
    let odds = normalizeMarketSnapshot(r.odds_snapshot ?? {}, r.market_alias_map ?? {}, warnings);
    const effectiveOddsResolver = typeof oddsResolver === 'function'
      ? oddsResolver
      : (r.options.resolve_odds === true && repo?.db ? buildDbOddsResolver(repo.db) : null);
    const oddsProvenance = Object.fromEntries(
      Object.keys(odds).map((marketKey) => [marketKey, { source: 'request', found: true }]),
    );
    const oddsDiagnostics = {
      request_count: Object.keys(odds).length,
      resolver_used: false,
      resolver_found: 0,
      resolver_absent: 0,
      absent_reasons: {},
      slots_with_odds: 0,
    };
    const suppressedMarkets = new Set(r.options.suppress_markets ?? []);

    // 1. Lookups (sem inventar fallback silencioso).
    emit('lookups');
    const profileHome = repo.getTeamProfile({ team: m.home, liga: m.liga, temporada, side: 'home', asOf });
    const profileAway = repo.getTeamProfile({ team: m.away, liga: m.liga, temporada, side: 'away', asOf });
    const priorsFt    = repo.getLeaguePriors({ liga: m.liga, temporada, period: 'FT', asOf });

    if (!profileHome) warnings.push(`team_profile_home_missing:${m.home}`);
    if (!profileAway) warnings.push(`team_profile_away_missing:${m.away}`);
    if (!priorsFt)    warnings.push(`league_priors_missing:${m.liga}/${temporada}/FT`);
    if (profileHome?.source === 'legacy') warnings.push(`team_profile_home_legacy_non_pit:${m.home}`);
    if (profileAway?.source === 'legacy') warnings.push(`team_profile_away_legacy_non_pit:${m.away}`);

    const certifiedInputs = !!profileHome && !!profileAway && !!priorsFt
      && profileHome.source !== 'legacy' && profileAway.source !== 'legacy';

    // Carrega calib EWMA ANTES da engine para extrair lambda_mult por count family.
    const calibMap = loadCalibrationMap(repo.db, 'A');
    const COUNT_FAMILIES = ['escanteios', 'chutes', 'cartoes', 'faltas'];
    const engineCalib = {};
    for (const fam of COUNT_FAMILIES) {
      // Usa direction='over' como key canônica (lambda_mult é simétrico).
      const c = getCalib(calibMap, { family: fam, direction: 'over', liga: m.liga });
      if (c.sample_size > 0 && c.lambda_mult !== 1.0) {
        engineCalib[fam] = { lambda_mult: c.lambda_mult, sample_size: c.sample_size };
      }
    }

    // 2. Engine A — só roda se inputs certificados. Sem inputs, sem números.
    emit('engine_a');
    const tA = Date.now();
    let aOut = { slots: [] };
    if (certifiedInputs) {
      try {
        aOut = predictA({
          home: m.home, away: m.away, liga: m.liga,
          profileHome,
          profileAway,
          priors: priorsFt,
          calibration: engineCalib,
        });
      } catch (e) {
        const reason = e?.message ?? 'unknown_error';
        warnings.push(reason.startsWith('engine_a_invalid_context') ? reason : `engine_a_aborted:${reason}`);
        aOut = { slots: [] };
      }
    } else {
      warnings.push('engine_a_skipped:uncertified_inputs');
    }
    const tAms = Date.now() - tA;

    // 3. Engine B (sidecar Python; falha → degrada para A puro)
    let slotsB = null, tBms = null;
    if (r.options.include_engines.includes('B')) {
      emit('engine_b');
      const tB = Date.now();
      const bOut = await engineB.predictBatch({
        liga: m.liga, home: m.home, away: m.away, data: m.date,
      });
      tBms = Date.now() - tB;
      if (bOut.available) slotsB = bOut.slots;
      else warnings.push(`engine_b_unavailable:${bOut.reason}`);
    }

    // 4. Curinga combine — pesos dinâmicos por (family, liga) via ewma_brier
    emit('curinga');
    const tC = Date.now();
    const calibMapB = loadCalibrationMap(repo.db, 'B');
    const curingaCalibMap = buildCuringaCalibMap(calibMap, calibMapB, m.liga);
    const combined = combine({
      slotsA: aOut.slots,
      slotsB,
      calibMap: curingaCalibMap,
      liga: m.liga,
    });
    const tCms = Date.now() - tC;

    if (typeof effectiveOddsResolver === 'function') {
      emit('odds');
      try {
        const resolved = await effectiveOddsResolver({ repo, match: m, slots: combined, existingOdds: odds, log });
        oddsDiagnostics.resolver_used = true;
        for (const warning of resolved?.warnings ?? []) warnings.push(warning);
        for (const [marketKey, odd] of Object.entries(resolved?.odds ?? {})) {
          if (odds[marketKey] == null || resolved?.override === true) odds[marketKey] = odd;
          oddsProvenance[marketKey] = { ...(resolved?.provenance?.[marketKey] ?? {}), source: resolved?.source ?? 'resolver', found: true };
        }
        for (const [marketKey, reason] of Object.entries(resolved?.absent ?? {})) {
          if (oddsProvenance[marketKey]) continue;
          const normalizedReason = String(reason || 'missing');
          oddsProvenance[marketKey] = { source: resolved?.source ?? 'resolver', found: false, reason: normalizedReason };
          oddsDiagnostics.absent_reasons[normalizedReason] = (oddsDiagnostics.absent_reasons[normalizedReason] ?? 0) + 1;
        }
        oddsDiagnostics.resolver_found = Object.keys(resolved?.odds ?? {}).length;
        oddsDiagnostics.resolver_absent = Object.keys(resolved?.absent ?? {}).length;
      } catch (error) {
        warnings.push(`odds_resolver_failed:${error.message ?? String(error)}`);
      }
    }

    // 5. Evidence + odds annotation + Quality-Gates + Isotonic + Calibration EWMA
    emit('evidence_gates');
    const qgGates = QG.getGates();
    const isoMap = loadIsotonicMap(repo.db);
    // Contexto de evidência por confronto (1 vez): h2h, splits, league_priors.
    const matchEvidence = buildMatchEvidenceContext({
      repo,
      match: { home: m.home, away: m.away, liga: m.liga, temporada, data_partida: m.date },
      asOf: m.date,
      period: 'FT',
    });
    const baseConfidence = computeBaseConfidence({ certifiedInputs, profileHome, profileAway, priorsFt });
    const tIso0 = Date.now();
    for (const s of combined) {
      // certify = engine certified AND inputs OK
      s.certified = s.certified && certifiedInputs;
      s.provenance = { ...(s.provenance ?? {}) };
      if (suppressedMarkets.has(s.market_key)) {
        s.certified = false;
        s.provenance.suppressed_by_request = true;
      }

      // Isotonic: aplicado ANTES de market_odd → edge usa fair_prob calibrado.
      // Se modelo não existe ou n<MIN_SAMPLES → no-op com provenance.applied=false.
      const isoEntry = getIsotonic(isoMap, { family: s.family, period: s.period, direction: s.direction, liga: m.liga });
      applyIsotonicToSlot(s, isoEntry);

      const mo = odds[s.market_key];
      const oddMeta = oddsProvenance[s.market_key];
      if (oddMeta) s.provenance.odd = oddMeta;
      if (mo) {
        s.market_odd = mo;
        s.edge_pct = +((s.fair_prob * mo - 1) * 100).toFixed(2);
        oddsDiagnostics.slots_with_odds++;
      }
      // Confidence: base por cobertura de dados × QG (multiplicadores walk-forward)
      const qgEval = QG.evaluateSlot(s, { liga: m.liga });
      s.confidence = +(baseConfidence * qgEval.qg_confidence).toFixed(4);
      const brierConfidence = computeBrierConfidence(s, { calibMapA: calibMap, calibMapB, liga: m.liga });
      if (brierConfidence.applied) s.confidence = +(s.confidence * brierConfidence.multiplier).toFixed(4);
      const marketGate = evaluateMarketGate(s, { gates: qgGates, minEdgePp: r.options.min_edge_pp });
      s.provenance = { ...(s.provenance ?? {}), qg: { ...qgEval, market_gate: marketGate }, brier_confidence: brierConfidence };
      applyAOnlyConfidencePenalty(s);
      if (!marketGate.pass) s.certified = false;
      if (s.provenance.divergence_flag) s.certified = false;

      // Calibração EWMA (do settler, se houver amostras suficientes).
      const calib = getCalib(calibMap, { family: s.family, direction: s.direction, liga: m.liga });
      applyCalibrationToSlot(s, calib);

      // Phantom edge flag (gate do QG): edge muito alto = sinal de erro.
      if (s.edge_pct != null && qgGates.phantom_edge_threshold_pp != null) {
        if (s.edge_pct >= qgGates.phantom_edge_threshold_pp) {
          s.provenance.phantom_edge_flag = true;
          s.certified = false;
        }
      }
      s.evidence = buildEvidence(s, { home: m.home, away: m.away, liga: m.liga, matchEvidence });
    }
    const tIsoMs = Date.now() - tIso0;

    // 6. EV ranking — score = edge_pct ajustado por confidence.
    //    Aplica family_cap (qg.json) limitando top-N por família para
    //    diversificar o ranking final (evita um único mercado dominante).
    emit('ev_rank');
    const { ev_ranked, ev_ranked_capped_out } = buildEvRanking(combined);

    // Scout opt-in: SCOUT IA via LLM provider chain (options.scout=true).
    let scout = null;
    let scoutMs = null;
    if (r.options.scout === true) {
      const tS = Date.now();
      const requestMatchContext = r.match_context ?? {};
      const scoutSlotForm = buildScoutSlotForm({
        repo,
        match: m,
        slots: combined,
        evRanked: ev_ranked,
      });
      scout = await runScout({
        slots: combined,
        evidence: { profileHome, profileAway, matchEvidence, slotForm: scoutSlotForm },
        matchContext: {
          ...requestMatchContext,
          home: m.home,
          away: m.away,
          liga: m.liga,
          date: m.date,
          hora: m.hora,
          temporada,
          regime_hints: requestMatchContext.regime_hints ?? [],
        },
        evRanked: ev_ranked,
        options: r.options,
      });
      scoutMs = Date.now() - tS;
      // Aplica confidence_delta nos slots antes da resposta final.
      if (scout) applyScoutOverlay(combined, scout);
    }

    const sig = buildSignature({
      db: repo.db,
      dataSnapshot: {
        match: { external_id: m.external_id, home: m.home, away: m.away, liga: m.liga, date: m.date },
        temporada,
        as_of: asOf,
        inputs: { profile_home: profileHome, profile_away: profileAway, league_priors_ft: priorsFt },
      },
    });
    const run_id = callerRunId ?? randomUUID();
    const response = {
      contract_version: '1.0.0',
      engine_signature: sig,
      match: m,
      run_id,
      certified: certifiedInputs,
      warnings,
      slots: combined,
      ev_ranked,
      ev_ranked_capped_out,
      scout,
      diagnostics: {
        latency_ms: Date.now() - t0,
        engines_used: r.options.include_engines,
        engine_a_ms: tAms,
        engine_b_ms: tBms,
        curinga_ms: tCms,
        isotonic_ms: tIsoMs,
        scout_ms: scoutMs,
        scout_provider: scout?.model ?? null,
        scout_tokens: scout?.tokens_used ?? 0,
        scout_web_context: scout?.web_context_used ?? false,
        odds: oddsDiagnostics,
        errors: {},
      },
    };

    // 7. Persist motor_run + predictions (best-effort)
    if (persist) {
      try {
        repo.saveMotorRun({
          run_id,
          match_id: m.external_id,
          engine_signature: sig,
          request_payload: r,
          response_payload: response,
        });
      } catch (e) {
        log.warn?.({ err: e.message }, 'saveMotorRun_failed');
      }
      try {
        if (typeof repo.savePredictions === 'function') {
          repo.savePredictions({
            run_id,
            match_id: m.external_id,
            match_date: m.date,
            liga: m.liga,
            slots: combined,
          });
        }
      } catch (e) {
        log.warn?.({ err: e.message }, 'savePredictions_failed');
      }
    }

    // 8. Validação saída (defensiva — caro mas catch dev errors)
    const outValid = PredictionResponseZ.safeParse(response);
    if (!outValid.success) {
      log.error?.({ issues: outValid.error.issues }, 'predict_response_invalid');
      return { __error: true, __status: 500, __body: { error: 'response_validation_failed', issues: outValid.error.issues } };
    }
    return response;
}

export async function buildHealthPayload({ repo = null } = {}) {
  const checks = {
    db: 'unknown',
    team_profiles_v2: { count: null, max_as_of: null, stale: null },
    league_priors: { count: null, max_as_of: null, stale: null },
    isotonic_blob: { count: null, max_fit_at: null, stale: null },
    last_settled_prediction: { date: null, days_ago: null },
    engine_b_url: process.env.ENGINE_B_URL ?? null,
    sidecar: { reachable: null, models_loaded: null, version: null, latency_ms: null, error: null },
  };
  const STALE_PROFILE_DAYS = 14;
  const STALE_PRIORS_DAYS = 14;
  const STALE_ISOTONIC_DAYS = 45;
  const STALE_SETTLE_DAYS = 7;

  if (repo?.db) {
    try {
      const tp = repo.db.prepare('SELECT COUNT(*) AS n, MAX(as_of) AS mx FROM team_profile_v2').get();
      checks.team_profiles_v2.count = tp.n;
      checks.team_profiles_v2.max_as_of = tp.mx;
      if (tp.mx) {
        const ageDays = (Date.now() - new Date(tp.mx).getTime()) / 86400000;
        checks.team_profiles_v2.stale = ageDays > STALE_PROFILE_DAYS;
      }
      const lp = repo.db.prepare('SELECT COUNT(*) AS n, MAX(as_of) AS mx FROM league_priors').get();
      checks.league_priors.count = lp.n;
      checks.league_priors.max_as_of = lp.mx;
      if (lp.mx) {
        const ageDays = (Date.now() - new Date(lp.mx).getTime()) / 86400000;
        checks.league_priors.stale = ageDays > STALE_PRIORS_DAYS;
      }
      const iso = repo.db.prepare('SELECT COUNT(*) AS n, MAX(fit_at) AS mx FROM isotonic_blob').get();
      checks.isotonic_blob.count = iso.n;
      checks.isotonic_blob.max_fit_at = iso.mx;
      if (iso.mx) {
        const ageDays = (Date.now() - new Date(iso.mx).getTime()) / 86400000;
        checks.isotonic_blob.stale = ageDays > STALE_ISOTONIC_DAYS;
      }
      try {
        const ls = repo.db.prepare(`
            SELECT MAX(settled_at) AS d FROM prediction
            WHERE result IS NOT NULL
        `).get();
        checks.last_settled_prediction.date = ls?.d ?? null;
        if (ls?.d) {
          const ageDays = (Date.now() - new Date(ls.d).getTime()) / 86400000;
          checks.last_settled_prediction.days_ago = Math.max(0, Math.floor(ageDays));
        }
        } catch { /* schema pode não expor settle no formato esperado */ }
      checks.db = 'ok';
    } catch (err) {
      checks.db = `error:${err.message}`;
    }
  }

  // Sidecar ML — ping curto, nao-bloqueante (timeout 1.5s).
  if (checks.engine_b_url) {
    const tPing = Date.now();
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(`${checks.engine_b_url.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
      clearTimeout(to);
      checks.sidecar.latency_ms = Date.now() - tPing;
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        checks.sidecar.reachable = true;
        checks.sidecar.models_loaded = body.models_loaded ?? body.models ?? null;
        checks.sidecar.version = body.version ?? null;
      } else {
        checks.sidecar.reachable = false;
        checks.sidecar.error = `http_${r.status}`;
      }
    } catch (e) {
      checks.sidecar.reachable = false;
      checks.sidecar.error = e.name === 'AbortError' ? 'timeout' : (e.message ?? String(e));
      checks.sidecar.latency_ms = Date.now() - tPing;
    }
  }

  const degraded =
    checks.db !== 'ok' ||
    !checks.team_profiles_v2.count ||
    !checks.league_priors.count ||
    !checks.isotonic_blob.count ||
    checks.team_profiles_v2.stale === true ||
    checks.league_priors.stale === true ||
    checks.isotonic_blob.stale === true ||
    (checks.last_settled_prediction.days_ago != null && checks.last_settled_prediction.days_ago > STALE_SETTLE_DAYS) ||
    (checks.engine_b_url != null && checks.sidecar.reachable === false);

  return {
    status: degraded ? 'degraded' : 'ok',
    engine_signature: buildSignature({ db: repo?.db ?? null }),
    covered_engine_a: coveredFamilies(),
    checks,
  };
}

/**
 * Agrega ewma_brier por (family, liga) de A e B em um Map para o Curinga.
 * Como calib_state armazena por (family, direction, liga), tiramos média
 * sobre direções dentro da família (peso uniforme — direções costumam ter
 * volumes parecidos).
 */
function buildCuringaCalibMap(calibA, calibB, liga) {
  const out = new Map();
  function aggregate(map, suffix) {
    const fam = new Map(); // family → {sum, n, sum_other, n_other}
    for (const [k, v] of map.entries()) {
      const [family, , entryLiga] = k.split('::');
      const isThisLiga = entryLiga === liga;
      if (v?.ewma_brier == null) continue;
      const f = fam.get(family) ?? { sum: 0, n: 0, sumOther: 0, nOther: 0 };
      if (isThisLiga) { f.sum += v.ewma_brier; f.n += 1; }
      else            { f.sumOther += v.ewma_brier; f.nOther += 1; }
      fam.set(family, f);
    }
    for (const [family, f] of fam.entries()) {
      const liganBrier = f.n > 0 ? f.sum / f.n
                        : f.nOther > 0 ? f.sumOther / f.nOther
                        : null;
      const key = `${family}::${liga}`;
      const cur = out.get(key) ?? {};
      cur[suffix] = liganBrier;
      out.set(key, cur);
    }
  }
  aggregate(calibA, 'ewma_brier_a');
  aggregate(calibB, 'ewma_brier_b');
  return out;
}

function isHtBand(faixa) {
  const start = Number(String(faixa ?? '').split('-')[0]);
  return Number.isFinite(start) && start < 46;
}

function rowsForPeriod(rows, period) {
  if (!Array.isArray(rows)) return [];
  if (period === 'HT') return rows.filter((row) => isHtBand(row.faixa));
  return rows;
}

function sumRows(rows, field) {
  return rows.reduce((acc, row) => acc + Number(row?.[field] ?? 0), 0);
}

function teamEventRows(bands, matchRow, team) {
  const sideLabel = matchRow.home_team === team ? 'Casa' : 'Visitante';
  return bands?.byTeam?.[team] ?? bands?.byTeam?.[sideLabel] ?? [];
}

function totalEventRows(bands) {
  const values = Object.values(bands?.byTeam ?? {});
  return values.flat();
}

function metricForSlot(slot) {
  if (slot.family === 'escanteios') return 'escanteios';
  if (slot.family === 'chutes') return 'chutes';
  if (slot.family === 'cartoes') return 'cartoes';
  if (slot.family === 'faltas') return 'faltas';
  if (slot.family === 'btts') return 'btts';
  if (slot.family === '1x2') return 'resultado_gf_ga';
  return 'gols';
}

function numericSummary(values) {
  const numeric = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (numeric.length === 0) return null;
  const sum = numeric.reduce((acc, value) => acc + value, 0);
  return {
    values: numeric.slice(0, 7),
    min: Math.min(...numeric),
    max: Math.max(...numeric),
    avg: +(sum / numeric.length).toFixed(2),
    n: numeric.length,
  };
}

function valueForSlotSample(slot, sample, team) {
  const matchRow = sample.match;
  const isTeamHome = matchRow.home_team === team;
  const teamGoals = isTeamHome ? matchRow.home_goals : matchRow.away_goals;
  const opponentGoals = isTeamHome ? matchRow.away_goals : matchRow.home_goals;
  const totalGoals = Number(matchRow.home_goals ?? 0) + Number(matchRow.away_goals ?? 0);
  if (slot.family === 'btts') return Number(matchRow.home_goals > 0 && matchRow.away_goals > 0);
  if (slot.family === '1x2') return teamGoals > opponentGoals ? 1 : teamGoals === opponentGoals ? 0 : -1;
  if (slot.family === 'gols') {
    if (slot.scope === 'total') return totalGoals;
    return teamGoals;
  }

  const periodRows = rowsForPeriod(
    slot.scope === 'total' ? totalEventRows(sample.bands) : teamEventRows(sample.bands, matchRow, team),
    slot.period,
  );
  if (slot.family === 'cartoes') return sumRows(periodRows, 'cartoes_amarelos') + sumRows(periodRows, 'cartoes_vermelhos');
  if (slot.family === 'escanteios') return sumRows(periodRows, 'escanteios');
  if (slot.family === 'chutes') return sumRows(periodRows, 'chutes');
  if (slot.family === 'faltas') return sumRows(periodRows, 'faltas');
  return null;
}

function loadRecentSamples(repo, team, liga, asOf, limit = 7) {
  const rows = repo.getRecentMatches?.(team, liga, asOf, limit) ?? [];
  return rows.map((matchRow) => ({
    match: matchRow,
    bands: repo.getEventBands?.(matchRow.id_confronto) ?? null,
  }));
}

function buildScoutSlotForm({ repo, match, slots, evRanked, limit = 7 }) {
  if (!repo || !match || !Array.isArray(evRanked) || evRanked.length === 0) return [];
  const slotByKey = new Map(slots.map((slot) => [slot.market_key, slot]));
  const topSlots = evRanked.slice(0, 3).map((marketKey) => slotByKey.get(marketKey)).filter(Boolean);
  if (topSlots.length === 0) return [];
  try {
    const homeSamples = loadRecentSamples(repo, match.home, match.liga, match.date, limit);
    const awaySamples = loadRecentSamples(repo, match.away, match.liga, match.date, limit);
    return topSlots.map((slot) => {
      const homeValues = homeSamples.map((sample) => valueForSlotSample(slot, sample, match.home)).filter((value) => value != null);
      const awayValues = awaySamples.map((sample) => valueForSlotSample(slot, sample, match.away)).filter((value) => value != null);
      return {
        market_key: slot.market_key,
        metric: metricForSlot(slot),
        home: numericSummary(homeValues),
        away: numericSummary(awayValues),
      };
    });
  } catch {
    return [];
  }
}

function sampleScore(n, target = 20) {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.min(1, value / target));
}

export function buildEvRanking(slots, { getFamilyCap = QG.getFamilyCap } = {}) {
  const slotByKey = new Map((slots ?? []).map((s) => [s.market_key, s]));
  const scored = (slots ?? [])
    .filter((s) =>
      s.certified === true &&
      s.market_odd != null &&
      s.edge_pct != null &&
      Number.isFinite(s.confidence) &&
      s.provenance?.qg?.market_gate?.rank_eligible === true &&
      !s.provenance?.phantom_edge_flag,
    )
    .map((s) => {
      const score = s.edge_pct * s.confidence;
      return { market_key: s.market_key, family: s.family, score };
    })
    .sort((a, b) => b.score - a.score);

  const familyCounts = new Map();
  const ev_ranked = [];
  const ev_ranked_capped_out = [];
  for (const x of scored) {
    const cap = getFamilyCap(x.family) ?? Infinity;
    const cur = familyCounts.get(x.family) ?? 0;
    if (cur < cap) {
      ev_ranked.push(x.market_key);
      familyCounts.set(x.family, cur + 1);
    } else {
      ev_ranked_capped_out.push(x.market_key);
      const slot = slotByKey.get(x.market_key);
      if (slot) {
        slot.provenance = { ...(slot.provenance ?? {}), family_cap_excluded: true, family_cap_limit: cap };
      }
    }
  }
  return { ev_ranked, ev_ranked_capped_out };
}

export function applyAOnlyConfidencePenalty(slot, factor = A_ONLY_CONFIDENCE_FACTOR) {
  const reason = slot?.provenance?.divergence_resolved_by;
  if (reason !== 'engine_b_unavailable' && reason !== 'engine_b_no_slot') return slot;
  if (!Number.isFinite(slot?.confidence)) return slot;
  slot.confidence = +(slot.confidence * factor).toFixed(4);
  slot.provenance = {
    ...(slot.provenance ?? {}),
    a_only_confidence_factor: factor,
    a_only_confidence_penalty_applied: true,
  };
  return slot;
}

function computeBaseConfidence({ certifiedInputs, profileHome, profileAway, priorsFt }) {
  if (!certifiedInputs) return 0.15;
  const profileScore = (sampleScore(profileHome?.n, 20) + sampleScore(profileAway?.n, 20)) / 2;
  const priorScore = priorsFt ? 0.85 : 0;
  return +(0.20 + 0.35 * profileScore + 0.20 * priorScore).toFixed(4);
}

function computeBrierConfidence(slot, { calibMapA, calibMapB, liga, minSamples = 20 }) {
  const items = [];
  const calibA = getCalib(calibMapA, { family: slot.family, direction: slot.direction, liga });
  const calibB = getCalib(calibMapB, { family: slot.family, direction: slot.direction, liga });
  const weightA = Number(slot.provenance?.weight_a ?? 1);
  const weightB = Number(slot.provenance?.weight_b ?? 0);
  if (Number.isFinite(calibA.ewma_brier) && (calibA.sample_size ?? 0) >= minSamples) {
    items.push({ engine: 'A', weight: Math.max(0, weightA), ewma_brier: calibA.ewma_brier, sample_size: calibA.sample_size });
  }
  if (Number.isFinite(calibB.ewma_brier) && (calibB.sample_size ?? 0) >= minSamples) {
    items.push({ engine: 'B', weight: Math.max(0, weightB), ewma_brier: calibB.ewma_brier, sample_size: calibB.sample_size });
  }
  const weightTotal = items.reduce((sum, item) => sum + item.weight, 0);
  if (items.length === 0 || weightTotal <= 0) {
    return { applied: false, reason: 'insufficient_brier_samples', min_samples: minSamples };
  }
  const multiplier = items.reduce((sum, item) => sum + item.weight * Math.max(0, Math.min(1, 1 - item.ewma_brier)), 0) / weightTotal;
  return {
    applied: true,
    multiplier: +Math.max(0.5, Math.min(1.05, multiplier)).toFixed(4),
    min_samples: minSamples,
    engines: items,
  };
}

function evaluateMarketGate(slot, { gates, minEdgePp = 0 } = {}) {
  const reasons = [];
  if (slot.provenance?.suppressed_by_request) reasons.push('suppressed_by_request');
  if (slot.market_odd == null || slot.edge_pct == null) {
    return {
      pass: false,
      rank_eligible: false,
      reasons: reasons.length > 0 ? reasons : ['no_market_odd'],
    };
  }

  const edgeMin = Math.max(Number(gates?.edge_min_pp ?? 0), Number(minEdgePp ?? 0));
  const evMin = Number(gates?.ev_min_pct ?? 0);
  if (gates?.leg_ev_positive === true && slot.edge_pct < 0) reasons.push('leg_ev_negative');
  if (slot.edge_pct < edgeMin) reasons.push('edge_below_min');
  if (slot.edge_pct < evMin) reasons.push('ev_below_min');

  return {
    pass: reasons.length === 0,
    rank_eligible: reasons.length === 0,
    edge_min_pp: edgeMin,
    ev_min_pct: evMin,
    reasons,
  };
}
