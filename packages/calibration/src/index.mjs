// @scoutcore/calibration
//
// EWMA-based calibration adapter portado do legacy `model-a-calibration.js`.
// Persiste em calib_state (migration 003) por (engine, family, direction, liga).
//
// API pública:
//   loadCalibrationMap(db, engine='A')
//   getCalib(map, family, direction, liga)
//   saveCalibrationBatch(db, updates)
//   updateEwma(old, obs, alpha)
//   computeSuggestions(db, opts)
//   applyCalibrationToSlot(slot, calib)
//
// REGRA HONESTA: quando não há entrada, retorna defaults neutros
// (lambda_mult=1, confidence_factor=1, line_shift=0, ewma_hr=0.5).
// O caller pode detectar `n_samples==0` para saber se houve calibração real.

export const CALIBRATION_VERSION = '0.1.0';

const DEFAULT_CALIB = Object.freeze({
  lambda_mult: 1.0,
  confidence_factor: 1.0,
  line_shift: 0.0,
  ewma_hr: 0.5,
  ewma_brier: null,
  sample_size: 0,
});

/**
 * Carrega TODAS as entradas de calib_state em um Map por chave canônica.
 * Chaves:
 *   "${family}::${direction}::${liga}"   (específica)
 *   "${family}::${direction}::*"         (global — fallback agregado quando existe)
 *
 * @param {import('better-sqlite3').Database} db
 * @param {'A'|'B'} engine
 */
export function loadCalibrationMap(db, engine = 'A') {
  const rows = db.prepare(`
    SELECT family, direction, liga,
           lambda_mult, confidence_factor, line_shift,
           ewma_hr, ewma_brier, sample_size, updated_at
    FROM calib_state
    WHERE engine = ?
  `).all(engine);

  const map = new Map();
  for (const r of rows) {
    map.set(`${r.family}::${r.direction}::${r.liga}`, {
      lambda_mult:       r.lambda_mult,
      confidence_factor: r.confidence_factor,
      line_shift:        r.line_shift,
      ewma_hr:           r.ewma_hr,
      ewma_brier:        r.ewma_brier,
      sample_size:       r.sample_size,
      updated_at:        r.updated_at,
    });
  }
  return map;
}

/** Lookup com fallback global. Sempre retorna um objeto (defaults se vazio). */
export function getCalib(map, { family, direction, liga }) {
  const specific = map.get(`${family}::${direction}::${liga}`);
  if (specific) return specific;
  const global = map.get(`${family}::${direction}::*`);
  if (global) return global;
  return { ...DEFAULT_CALIB };
}

/**
 * EWMA: ewma_new = α·obs + (1-α)·ewma_old
 * Quando ewma_old==null OU ainda é o seed 0.5 sem amostras, retorna obs direto.
 */
export function updateEwma(oldEwma, obs, alpha = 0.15) {
  if (oldEwma == null) return obs;
  if (oldEwma === 0.5 && Number.isFinite(obs)) return obs;
  return alpha * obs + (1 - alpha) * oldEwma;
}

/**
 * UPSERT em calib_state.
 * @param {import('better-sqlite3').Database} db
 * @param {Array<object>} updates
 */
export function saveCalibrationBatch(db, updates, { engine = 'A' } = {}) {
  if (!updates || updates.length === 0) return 0;

  const upsert = db.prepare(`
    INSERT INTO calib_state
      (engine, family, direction, liga,
       lambda_mult, confidence_factor, line_shift,
       ewma_hr, ewma_brier, sample_size, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(engine, family, direction, liga) DO UPDATE SET
      lambda_mult       = excluded.lambda_mult,
      confidence_factor = excluded.confidence_factor,
      line_shift        = excluded.line_shift,
      ewma_hr           = excluded.ewma_hr,
      ewma_brier        = excluded.ewma_brier,
      sample_size       = excluded.sample_size,
      updated_at        = datetime('now')
  `);

  const tx = db.transaction((rows) => {
    for (const u of rows) {
      upsert.run(
        engine,
        u.family, u.direction, u.liga,
        u.lambda_mult       ?? 1.0,
        u.confidence_factor ?? 1.0,
        u.line_shift        ?? 0.0,
        u.ewma_hr           ?? 0.5,
        u.ewma_brier        ?? null,
        u.sample_size       ?? 0,
      );
    }
  });
  tx(updates);
  return updates.length;
}

/**
 * Aplica calib em um slot já gerado pela engine.
 * Modifica `s.confidence` (multiplicado por confidence_factor) e
 * insere `provenance.calib`. NÃO recalcula prob (lambda_mult deve ser
 * aplicado na engine antes do predict — exposto via map; ver predict.mjs).
 */
export function applyCalibrationToSlot(slot, calib) {
  if (!calib || calib.sample_size === 0) {
    slot.provenance = { ...(slot.provenance ?? {}), calib: { applied: false, reason: 'no_samples' } };
    return slot;
  }
  const cf = calib.confidence_factor ?? 1.0;
  slot.confidence = +(slot.confidence * cf).toFixed(4);
  slot.provenance = {
    ...(slot.provenance ?? {}),
    calib: {
      applied: true,
      confidence_factor: cf,
      lambda_mult: calib.lambda_mult ?? 1.0,
      ewma_hr: calib.ewma_hr,
      n: calib.sample_size,
    },
  };
  return slot;
}

/**
 * Computa sugestões a partir de prediction resolvida.
 * Retorna lista ordenada por urgência (maior desvio do calibration_ratio).
 */
export function computeSuggestions(db, { minSamples = 10 } = {}) {
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT family, liga, direction,
             COUNT(*) AS n_total,
             SUM(CASE WHEN result = 'green' THEN 1 ELSE 0 END) AS n_green,
             AVG(fair_prob) AS avg_expected,
             AVG(CASE WHEN result = 'green' THEN 1.0 ELSE 0.0 END) AS actual_hr
      FROM prediction
      WHERE result IN ('green','red') AND fair_prob IS NOT NULL
      GROUP BY family, liga, direction
      HAVING COUNT(*) >= ?
    `).all(minSamples);
  } catch {
    return [];
  }

  const out = [];
  for (const r of rows) {
    const actual   = Number(r.actual_hr);
    const expected = Number(r.avg_expected) || 0.5;
    const n        = Number(r.n_total);
    const ratio    = expected > 0 ? actual / expected : 1;
    const bias =
      ratio < 0.85 ? 'overconfident'  :
      ratio > 1.15 ? 'underconfident' :
      'calibrated';

    const dir = String(r.direction).toLowerCase();
    const isOver  = dir === 'over';
    const isUnder = dir === 'under';
    let lambdaAction = 'ok';
    let suggestedLambda = 1.0;
    if (isOver  && actual > expected + 0.08) { suggestedLambda = Math.min(1.60, 1 + (actual - expected) * 1.2); lambdaAction = 'raise_lambda'; }
    else if (isOver  && actual < expected - 0.08) { suggestedLambda = Math.max(0.65, 1 - (expected - actual) * 1.2); lambdaAction = 'lower_lambda'; }
    else if (isUnder && actual < expected - 0.08) { suggestedLambda = Math.min(1.60, 1 + (expected - actual) * 1.2); lambdaAction = 'raise_lambda'; }
    else if (isUnder && actual > expected + 0.08) { suggestedLambda = Math.max(0.65, 1 - (actual - expected) * 1.2); lambdaAction = 'lower_lambda'; }

    const suggestedConf = Math.max(0.40, Math.min(1.20, ratio));

    out.push({
      family: r.family, liga: r.liga, direction: r.direction,
      n_samples: n,
      actual_hit_rate:   +actual.toFixed(4),
      expected_hit_rate: +expected.toFixed(4),
      calibration_ratio: +ratio.toFixed(4),
      suggested_lambda_mult:       +suggestedLambda.toFixed(3),
      suggested_confidence_factor: +suggestedConf.toFixed(3),
      bias, lambda_action: lambdaAction,
    });
  }
  return out.sort((a, b) => Math.abs(b.calibration_ratio - 1) - Math.abs(a.calibration_ratio - 1));
}
