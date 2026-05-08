// @scoutcore/evidence — gera bloco evidence (SPEC §4.3) para cada slot.
//
// Versão inicial: drivers heurísticos a partir do provenance do Engine A
// (lambdas e strengths). Fica explícito que NÃO há SHAP por enquanto;
// quando Engine B existir, integraremos importance via XGB feature_importances.

const TOP_K = 4;

export function buildEvidence(slot, ctx = {}) {
  const prov = slot.provenance ?? {};
  const drivers = [];

  if (prov.lambda_home != null && prov.lambda_away != null) {
    drivers.push({
      label: 'lambda_total_ft',
      value: +(prov.lambda_home + prov.lambda_away).toFixed(3),
      kind: 'engine_a_input',
    });
    drivers.push({
      label: 'lambda_home',
      value: +prov.lambda_home.toFixed(3),
      kind: 'engine_a_input',
    });
    drivers.push({
      label: 'lambda_away',
      value: +prov.lambda_away.toFixed(3),
      kind: 'engine_a_input',
    });
  }
  if (prov.attH != null && prov.defA != null) {
    drivers.push({
      label: 'home_attack_x_away_defense',
      value: +(prov.attH * prov.defA).toFixed(3),
      kind: 'engine_a_strength',
    });
  }

  return {
    drivers: drivers.slice(0, TOP_K),
    top_k: TOP_K,
    notes: [],
    context: ctx,
    engine_b_available: false,
  };
}

export const EVIDENCE_VERSION = '0.1.0';
