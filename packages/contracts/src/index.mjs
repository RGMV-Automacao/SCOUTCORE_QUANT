// @scoutcore/contracts — fontes Zod para validar I/O do Motor 4x4.
// Mantém compat. com SPEC §4 (Contrato de I/O). Campos opcionais nunca quebram clientes.

import { z } from 'zod';

// ────────── Domínio base ──────────
//
// FAMILIES: lista exaustiva — DEVE bater com `packages/markets/src/registry.mjs`.
// Quando um family novo for adicionado ao registry, adicionar aqui também.
// PERIODS: 'FULL' é usado por mercados acumulados como htft, que dependem do
// jogo inteiro mas não são separáveis em FT/HT/2T.
// DIRECTIONS: regex permissivo — o universo segue amplo (htft 1_1,
// asian_handicap home_minus_2..away_plus_2, escanteios_race home_3..none_7,
// etc.). Manter enum exaustivo aqui criaria drift permanente vs registry.
export const FAMILIES = [
  'gols', 'btts', '1x2', 'escanteios', 'chutes', 'cartoes', 'faltas',
  'btts_algum_tempo',
  'dupla', 'htft',
  'asian_handicap',
  'escanteios_1x2', 'escanteios_race',
  'chutes_alvo', 'cartoes_1x2', 'impedimentos', 'defesas',
  'dnb', 'correct_score', 'margem',
  'marca_primeiro', 'marca_ultimo', 'marca',
  'handicap',
];
export const SCOPES   = ['total', 'home', 'away'];
export const PERIODS  = ['FT', 'HT', '2T', 'FULL'];
export const DIRECTION_REGEX = /^[a-z0-9_]+$/;
export const ENGINES = ['A', 'B'];

export const FamilyZ    = z.enum(FAMILIES);
export const ScopeZ     = z.enum(SCOPES);
export const PeriodZ    = z.enum(PERIODS);
export const DirectionZ = z.string().regex(DIRECTION_REGEX, 'direction must be lower_snake_case');
export const EngineZ    = z.enum(ENGINES);

export const LigaCanonZ = z.string().regex(/^[a-z0-9-]+$/, 'liga must be kebab-case');

// ────────── Match ──────────

export const MatchZ = z.object({
  external_id: z.string().min(3),
  home: z.string().min(1),
  away: z.string().min(1),
  liga: LigaCanonZ,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
});

// ────────── Engine A internal context ──────────

const FiniteNumberZ = z.number().finite();

export const EngineATeamProfileZ = z.object({
  avg_gols_marcados: FiniteNumberZ,
  avg_gols_sofridos: FiniteNumberZ,
  n: z.number().int().nonnegative().optional(),
  n_events: z.number().int().nonnegative().optional(),
  avg_escanteios: FiniteNumberZ.optional(),
  avg_chutes: FiniteNumberZ.optional(),
  avg_chutes_alvo: FiniteNumberZ.optional(),
  avg_cartoes_amarelos: FiniteNumberZ.optional(),
  avg_faltas_cometidas: FiniteNumberZ.optional(),
  avg_impedimentos: FiniteNumberZ.optional(),
  avg_defesas: FiniteNumberZ.optional(),
}).passthrough();

export const EngineALeaguePriorsZ = z.object({
  avg_goals_total: z.number().finite().positive(),
  avg_escanteios_total: FiniteNumberZ.optional(),
  avg_chutes_total: FiniteNumberZ.optional(),
  avg_chutes_alvo_total: FiniteNumberZ.optional(),
  avg_cartoes_total: FiniteNumberZ.optional(),
  avg_faltas_total: FiniteNumberZ.optional(),
  avg_impedimentos_total: FiniteNumberZ.optional(),
  avg_defesas_total: FiniteNumberZ.optional(),
}).passthrough();

export const EngineACalibrationEntryZ = z.object({
  lambda_mult: z.number().finite().positive(),
}).passthrough();

export const EngineAContextZ = z.object({
  home: z.string().min(1),
  away: z.string().min(1),
  liga: z.string().min(1),
  profileHome: EngineATeamProfileZ,
  profileAway: EngineATeamProfileZ,
  priors: EngineALeaguePriorsZ,
  calibration: z.record(z.string(), EngineACalibrationEntryZ).optional(),
}).passthrough();

// ────────── Slot / Prediction ──────────

export const ProvenanceZ = z.object({
  fair_odd_a: z.number().nullable().optional(),
  fair_odd_b: z.number().nullable().optional(),
  divergence: z.number().nullable().optional(),
  divergence_resolved_by: z.string().nullable().optional(),
  weight_a: z.number().nullable().optional(),
  weight_b: z.number().nullable().optional(),
  ewma_hr_a: z.number().nullable().optional(),
  ewma_hr_b: z.number().nullable().optional(),
  ewma_brier_a: z.number().nullable().optional(),
  ewma_brier_b: z.number().nullable().optional(),
  ewma_precision_a: z.number().nullable().optional(),
  ewma_precision_b: z.number().nullable().optional(),
  clv_score_a: z.number().nullable().optional(),
  clv_score_b: z.number().nullable().optional(),
  quality_gate_multiplier: z.number().nullable().optional(),
  confidence_multiplier: z.number().nullable().optional(),
  market_reliability_multiplier: z.number().nullable().optional(),
  isotonic_applied: z.boolean().optional(),
  feature_set: z.string().optional(),
  regime_applied: z.array(z.string()).optional(),
}).passthrough();

export const SlotZ = z.object({
  market_key: z.string(),
  family: FamilyZ,
  scope: ScopeZ,
  period: PeriodZ,
  direction: DirectionZ,
  label: z.string().nullable().optional(),
  line: z.number().nullable().optional(),

  fair_prob_raw: z.number().min(0).max(1),
  fair_prob: z.number().min(0).max(1),
  // fair_odd pode ser null quando fair_prob ≈ 0 em caudas muito baixas.
  // Não invalida o slot.
  fair_odd: z.number().positive().nullable(),
  market_odd: z.number().positive().nullable().optional(),
  edge_pct: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),

  provenance: ProvenanceZ,
  evidence: z.unknown().optional(),
  certified: z.boolean(),
});

export const EngineSignatureZ = z.object({
  motor_version: z.string(),
  model_a_version: z.string(),
  model_b_version: z.string().nullable().optional(),
  isotonic_version: z.string().nullable().optional(),
  calib_snapshot_id: z.string().nullable().optional(),
  markets_catalog_version: z.string(),
  data_snapshot_hash: z.string().nullable().optional(),
  hash: z.string(),
}).passthrough();

export const PredictionResponseZ = z.object({
  contract_version: z.literal('1.0.0'),
  engine_signature: EngineSignatureZ,
  match: MatchZ,
  certified: z.boolean(),
  warnings: z.array(z.string()).default([]),
  slots: z.array(SlotZ),
  ev_ranked: z.array(z.string()).default([]),
  ev_ranked_capped_out: z.array(z.string()).default([]),
  scout: z.unknown().nullable().default(null),
  diagnostics: z.object({
    latency_ms: z.number().int().nonnegative(),
    engines_used: z.array(EngineZ),
    engine_a_ms: z.number().nullable().optional(),
    engine_b_ms: z.number().nullable().optional(),
    curinga_ms: z.number().nullable().optional(),
    isotonic_ms: z.number().nullable().optional(),
    scout_ms: z.number().nullable().optional(),
    errors: z.record(z.string(), z.string().nullable()).optional(),
  }),
});

export const PredictRequestZ = z.object({
  contract_version: z.literal('1.0.0').default('1.0.0'),
  client: z.object({ system: z.string(), version: z.string() }).optional(),
  match: MatchZ,
  match_context: z.object({
    regime_hints: z.array(z.string()).optional(),
    weather: z.string().optional(),
    referee: z.string().optional(),
    stadium: z.string().optional(),
    venue: z.string().optional(),
    venue_city: z.string().optional(),
    home_city: z.string().optional(),
    away_city: z.string().optional(),
    rodada: z.union([z.number().int(), z.string()]).optional(),
    round: z.union([z.number().int(), z.string()]).optional(),
    season: z.string().optional(),
    temporada: z.string().optional(),
  }).optional(),
  odds_snapshot: z.record(z.string(), z.number().min(1.01).max(1000)).optional(),
  market_alias_map: z.record(z.string(), z.string()).optional(),
  options: z.object({
    scout: z.boolean().default(false),
    include_engines: z.array(EngineZ).default(['A']),
    min_edge_pp: z.number().default(0),
    resolve_odds: z.boolean().default(false),
    suppress_markets: z.array(z.string()).default([]),
    feature_set: z.string().default('v3'),
  }).default({}),
});

// ────────── Settle ──────────

export const ResultZ = z.object({
  home_goals_ft: z.number().int().nonnegative(),
  away_goals_ft: z.number().int().nonnegative(),
  home_goals_ht: z.number().int().nonnegative().optional(),
  away_goals_ht: z.number().int().nonnegative().optional(),
  home_corners: z.number().int().nonnegative().optional(),
  away_corners: z.number().int().nonnegative().optional(),
  home_corners_ht: z.number().int().nonnegative().optional(),
  away_corners_ht: z.number().int().nonnegative().optional(),
  home_shots: z.number().int().nonnegative().optional(),
  away_shots: z.number().int().nonnegative().optional(),
  home_shots_on: z.number().int().nonnegative().optional(),
  away_shots_on: z.number().int().nonnegative().optional(),
  home_yc: z.number().int().nonnegative().optional(),
  away_yc: z.number().int().nonnegative().optional(),
  home_rc: z.number().int().nonnegative().optional(),
  away_rc: z.number().int().nonnegative().optional(),
  home_fouls: z.number().int().nonnegative().optional(),
  away_fouls: z.number().int().nonnegative().optional(),
});

export const VerdictZ = z.enum(['excellent', 'good', 'acceptable', 'bad', 'very_bad']);

// ────────── Helpers ──────────

export function safeParse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) return { ok: false, errors: r.error.issues };
  return { ok: true, value: r.data };
}
