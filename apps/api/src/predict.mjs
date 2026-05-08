// /v1/predict — handler honesto.
// Fluxo: validate request → repo lookups → engine A → curinga → evidence → response.

import { randomUUID } from 'node:crypto';
import { PredictRequestZ, PredictionResponseZ, safeParse } from '@scoutcore/contracts';
import { predict as predictA, coveredFamilies } from '@scoutcore/engine-a';
import { combine } from '@scoutcore/curinga';
import { buildEvidence } from '@scoutcore/evidence';
import * as engineB from '@scoutcore/engine-b-bridge';
import * as QG from '@scoutcore/quality-gates';
import { loadCalibrationMap, getCalib, applyCalibrationToSlot, CALIBRATION_VERSION } from '@scoutcore/calibration';
import { buildSignature } from './engine-signature.mjs';

function inferTemporada(dateIso) {
  const y = Number(dateIso.slice(0, 4));
  return String(y);
}

export function registerPredict(app, { repo }) {
  app.post('/v1/predict', async (req, reply) => {
    const t0 = Date.now();
    const parsed = safeParse(PredictRequestZ, req.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.errors });
    }
    const r = parsed.value;
    const m = r.match;
    const temporada = inferTemporada(m.date);
    const asOf = m.date;

    // 1. Lookups (sem inventar fallback silencioso).
    const profileHome = repo.getTeamProfile({ team: m.home, liga: m.liga, temporada, side: 'home', asOf });
    const profileAway = repo.getTeamProfile({ team: m.away, liga: m.liga, temporada, side: 'away', asOf });
    const priorsFt    = repo.getLeaguePriors({ liga: m.liga, temporada, period: 'FT', asOf });

    const warnings = [];
    if (!profileHome) warnings.push(`team_profile_home_missing:${m.home}`);
    if (!profileAway) warnings.push(`team_profile_away_missing:${m.away}`);
    if (!priorsFt)    warnings.push(`league_priors_missing:${m.liga}/${temporada}/FT`);

    const certifiedInputs = !!profileHome && !!profileAway && !!priorsFt;

    // 2. Engine A
    const tA = Date.now();
    const aOut = predictA({
      home: m.home, away: m.away, liga: m.liga,
      profileHome: profileHome ?? {},
      profileAway: profileAway ?? {},
      priors: priorsFt ?? {},
    });
    const tAms = Date.now() - tA;

    // 3. Engine B (stub indisponível por enquanto)
    let slotsB = null, tBms = null;
    if (r.options.include_engines.includes('B')) {
      const tB = Date.now();
      const bOut = await engineB.predictBatch({});
      tBms = Date.now() - tB;
      if (bOut.available) slotsB = bOut.slots;
      else warnings.push(`engine_b_unavailable:${bOut.reason}`);
    }

    // 4. Curinga combine
    const tC = Date.now();
    const combined = combine({ slotsA: aOut.slots, slotsB });
    const tCms = Date.now() - tC;

    // 5. Evidence + odds annotation + Quality-Gates + Calibration EWMA
    const odds = r.odds_snapshot ?? {};
    const qgGates = QG.getGates();
    const calibMap = loadCalibrationMap(repo.db, 'A');
    for (const s of combined) {
      // certify = engine certified AND inputs OK
      s.certified = s.certified && certifiedInputs;
      const mo = odds[s.market_key];
      if (mo) {
        s.market_odd = mo;
        s.edge_pct = +((s.fair_prob * mo - 1) * 100).toFixed(2);
      }
      // Confidence: base 0.5 (placeholder) × QG (multiplicadores walk-forward)
      const qgEval = QG.evaluateSlot(s, { liga: m.liga });
      const baseConfidence = certifiedInputs ? 0.5 : 0.2;
      s.confidence = +(baseConfidence * qgEval.qg_confidence).toFixed(4);
      s.provenance = { ...(s.provenance ?? {}), qg: qgEval };

      // Calibração EWMA (do settler, se houver amostras suficientes).
      const calib = getCalib(calibMap, { family: s.family, direction: s.direction, liga: m.liga });
      applyCalibrationToSlot(s, calib);

      // Phantom edge flag (gate do QG): edge muito alto = sinal de erro.
      if (s.edge_pct != null && qgGates.phantom_edge_threshold_pp != null) {
        if (s.edge_pct >= qgGates.phantom_edge_threshold_pp) {
          s.provenance.phantom_edge_flag = true;
        }
      }
      s.evidence = buildEvidence(s, { home: m.home, away: m.away, liga: m.liga });
    }

    // 6. EV ranking
    const ev_ranked = combined
      .filter((s) => s.market_odd != null && s.edge_pct != null)
      .sort((a, b) => (b.edge_pct ?? 0) - (a.edge_pct ?? 0))
      .map((s) => s.market_key);

    const sig = buildSignature();
    const response = {
      contract_version: '1.0.0',
      engine_signature: sig,
      match: m,
      certified: certifiedInputs,
      warnings,
      slots: combined,
      ev_ranked,
      scout: null,
      diagnostics: {
        latency_ms: Date.now() - t0,
        engines_used: r.options.include_engines,
        engine_a_ms: tAms,
        engine_b_ms: tBms,
        curinga_ms: tCms,
        isotonic_ms: 0,
        scout_ms: null,
        errors: {},
      },
    };

    // 7. Persist motor_run + predictions (best-effort)
    const run_id = randomUUID();
    try {
      repo.saveMotorRun({
        run_id,
        match_id: m.external_id,
        engine_signature: sig,
        request_payload: r,
        response_payload: { slots_count: combined.length, certified: certifiedInputs, warnings },
      });
    } catch (e) {
      app.log.warn({ err: e.message }, 'saveMotorRun_failed');
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
      app.log.warn({ err: e.message }, 'savePredictions_failed');
    }
    response.run_id = run_id;

    // 8. Validação saída (defensiva — caro mas catch dev errors)
    const outValid = PredictionResponseZ.safeParse(response);
    if (!outValid.success) {
      app.log.error({ issues: outValid.error.issues }, 'predict_response_invalid');
      return reply.code(500).send({ error: 'response_validation_failed', issues: outValid.error.issues });
    }
    return reply.send(response);
  });
}

export function buildHealthPayload() {
  return {
    status: 'ok',
    engine_signature: buildSignature(),
    covered_engine_a: coveredFamilies(),
  };
}
