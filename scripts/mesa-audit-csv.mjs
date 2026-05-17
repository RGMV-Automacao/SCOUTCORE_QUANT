#!/usr/bin/env node
// scripts/mesa-audit-csv.mjs
// Exporta uma mesa auditavel a partir de jogos + odds reais informados em JSON.

import fs from 'node:fs';
import { resolve, join } from 'node:path';

const DEFAULT_API = process.env.API_URL || 'http://127.0.0.1:4040';

function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  }
  return args;
}

function usage() {
  return `Uso: node scripts/mesa-audit-csv.mjs --input=mesa.json [--out=audit/mesa-2026-05-10] [--api=http://127.0.0.1:4040]\n\nFormato do input:\n{\n  "mesa_id": "mesa-2026-05-10",\n  "fixtures": [\n    {\n      "match": {\n        "external_id": "mesa:1",\n        "home": "Liverpool",\n        "away": "Chelsea",\n        "liga": "premier-league",\n        "date": "2026-05-10",\n        "hora": "16:00"\n      },\n      "odds_snapshot": {\n        "gols_total_ft_over_2_5": 1.85,\n        "btts_total_ft_sim": 1.75\n      },\n      "closing_odds_snapshot": {\n        "gols_total_ft_over_2_5": 1.78\n      },\n      "market_results": {\n        "gols_total_ft_over_2_5": "green"\n      }\n    }\n  ]\n}\n`;
}

function readInput(path) {
  const raw = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw);
  const fixtures = Array.isArray(parsed) ? parsed : (parsed.fixtures || (parsed.match ? [parsed] : null));
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('input precisa ser um array ou objeto com fixtures[]');
  }
  return {
    mesa_id: parsed.mesa_id || `mesa-${new Date().toISOString().slice(0, 10)}`,
    fixtures,
  };
}

function csvEscape(value) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(path, rows, headers) {
  const lines = [headers.join(';')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header])).join(';'));
  fs.writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

function asJson(value) {
  if (value == null) return '';
  return JSON.stringify(value);
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function oddFromProb(prob) {
  const value = toNumber(prob);
  if (value == null || value <= 0) return '';
  return +(1 / value).toFixed(4);
}

function formatOdd(value) {
  const numeric = toNumber(value);
  if (numeric == null || numeric <= 0) return '';
  return +numeric.toFixed(4);
}

function firstValue(...values) {
  return values.find((value) => value !== '' && value != null) ?? '';
}

function isGreenResult(result) {
  const normalized = String(result || '').toLowerCase();
  if (['green', 'win', 'won', '1', 'true'].includes(normalized)) return true;
  if (['red', 'loss', 'lost', '0', 'false'].includes(normalized)) return false;
  return null;
}

function brier(prob, result) {
  const p = toNumber(prob);
  const y = isGreenResult(result);
  if (p == null || y == null) return '';
  return +((p - (y ? 1 : 0)) ** 2).toFixed(6);
}

function isClosingOddSane(openOdd, closeOdd) {
  const open = toNumber(openOdd);
  const close = toNumber(closeOdd);
  if (open == null || close == null || open <= 1 || close <= 1) return '';
  return close >= open * 0.5 && close <= open * 2;
}

function clvPct(openOdd, closeOdd) {
  if (isClosingOddSane(openOdd, closeOdd) !== true) return '';
  return +((openOdd / closeOdd - 1) * 100).toFixed(4);
}

function getSlotRank(response, marketKey) {
  const index = (response.ev_ranked || []).indexOf(marketKey);
  return index >= 0 ? index + 1 : '';
}

function buildRequest(fixture) {
  const match = fixture.match;
  if (!match?.home || !match?.away || !match?.liga || !match?.date) {
    throw new Error(`fixture invalida: ${JSON.stringify(fixture)}`);
  }
  return {
    contract_version: fixture.contract_version || '1.0.0',
    ...(fixture.client ? { client: fixture.client } : {}),
    match: {
      external_id: match.external_id || `${match.liga}:${match.home}:${match.away}:${match.date}`,
      home: match.home,
      away: match.away,
      liga: match.liga,
      date: match.date,
      ...(match.hora || match.time || match.kickoff_time ? { hora: match.hora || match.time || match.kickoff_time } : {}),
    },
    odds_snapshot: fixture.odds_snapshot || {},
    market_alias_map: fixture.market_alias_map || {},
    ...(fixture.match_context ? { match_context: fixture.match_context } : {}),
    options: {
      include_engines: fixture.options?.include_engines || ['A', 'B'],
      scout: fixture.options?.scout ?? true,
      min_edge_pp: fixture.options?.min_edge_pp,
      suppress_markets: fixture.options?.suppress_markets || [],
      ...(fixture.options?.feature_set ? { feature_set: fixture.options.feature_set } : {}),
    },
  };
}

function auditMeta(fixture) {
  const match = fixture.match || {};
  const closingOdds = fixture.closing_odds_snapshot || fixture.closing_odds || {};
  const marketResults = fixture.market_results || fixture.results || {};
  const resultObservable = fixture.result_observable || fixture.result_observables || {};
  return {
    hora: match.hora || match.time || match.kickoff_time || '',
    closingOdds,
    marketResults,
    resultObservable,
    closingOddsCount: Object.keys(closingOdds).length,
    marketResultsCount: Object.keys(marketResults).length,
  };
}

async function predict(api, request) {
  const response = await fetch(`${api}/v1/predict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(`/v1/predict ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function slotRow({ mesaId, fixtureIndex, response, request, meta, slot }) {
  const provenance = slot.provenance || {};
  const qg = provenance.qg || {};
  const gate = qg.market_gate || {};
  const isotonic = provenance.isotonic || {};
  const calib = provenance.calib || {};
  const evidence = slot.evidence || {};
  const diagnostics = response.diagnostics || {};
  const fairProb = toNumber(slot.fair_prob);
  const marketOdd = toNumber(slot.market_odd);
  const inputOdd = request.odds_snapshot?.[slot.market_key] ?? '';
  const oddReal = firstValue(inputOdd, marketOdd);
  const closingOdd = meta.closingOdds?.[slot.market_key] ?? '';
  const settlementResult = meta.marketResults?.[slot.market_key] ?? '';
  const resultObservable = meta.resultObservable?.[slot.market_key] ?? meta.resultObservable?.default ?? '';
  const openingOdd = inputOdd || marketOdd;
  const oddFinalCuringa = firstValue(formatOdd(slot.fair_odd), oddFromProb(slot.fair_prob));
  const predOddA = firstValue(formatOdd(provenance.fair_odd_a), oddFromProb(provenance.fair_prob_a));
  const predOddB = firstValue(formatOdd(provenance.fair_odd_b), oddFromProb(provenance.fair_prob_b));
  const closingOddSane = isClosingOddSane(openingOdd, closingOdd);
  return {
    mesa_id: mesaId,
    fixture_index: fixtureIndex,
    run_id: response.run_id || '',
    external_id: request.match.external_id,
    liga: request.match.liga,
    date: request.match.date,
    hora: meta.hora,
    home: request.match.home,
    away: request.match.away,
    certified_match: response.certified,
    warnings: (response.warnings || []).join('|'),
    model_b_version: response.engine_signature?.model_b_version || '',
    signature_hash: response.engine_signature?.hash || '',
    model_b_artifacts_hash: response.engine_signature?.model_b_artifacts_hash || '',
    latency_ms: diagnostics.latency_ms ?? '',
    engine_a_ms: diagnostics.engine_a_ms ?? '',
    engine_b_ms: diagnostics.engine_b_ms ?? '',
    curinga_ms: diagnostics.curinga_ms ?? '',
    market_key: slot.market_key,
    ev_rank: getSlotRank(response, slot.market_key),
    family: slot.family,
    scope: slot.scope,
    period: slot.period,
    direction: slot.direction,
    line: slot.line ?? '',
    fair_prob_raw: slot.fair_prob_raw ?? '',
    fair_prob: slot.fair_prob ?? '',
    fair_odd: slot.fair_odd ?? '',
    fair_prob_curinga_final: slot.fair_prob ?? '',
    odd_final_curinga: oddFinalCuringa,
    market_odd: slot.market_odd ?? '',
    input_odd: inputOdd,
    odd_real: oddReal,
    implied_prob_real: oddReal !== '' ? +(1 / oddReal).toFixed(6) : '',
    odd_real_in_request: inputOdd !== '',
    closing_odd: closingOdd,
    closing_odd_real_in_request: closingOdd !== '',
    closing_odd_sane: closingOddSane,
    settlement_result: settlementResult,
    result_observable: resultObservable,
    brier_motor: brier(fairProb, settlementResult),
    brier_a: brier(provenance.fair_prob_a, settlementResult),
    brier_b: brier(provenance.fair_prob_b, settlementResult),
    clv_pct: clvPct(openingOdd, closingOdd),
    edge_pct: slot.edge_pct ?? '',
    expected_value_pct: fairProb != null && marketOdd != null ? +((fairProb * marketOdd - 1) * 100).toFixed(4) : '',
    confidence: slot.confidence ?? '',
    certified_slot: slot.certified,
    source: slot.source || '',
    engine: provenance.engine || '',
    weight_a: provenance.weight_a ?? '',
    weight_b: provenance.weight_b ?? '',
    weight_source: provenance.weight_source || '',
    fair_prob_a: provenance.fair_prob_a ?? '',
    fair_prob_b: provenance.fair_prob_b ?? '',
    pred_odd_motor_a: predOddA,
    pred_odd_motor_b: predOddB,
    fair_odd_a: predOddA,
    fair_odd_b: predOddB,
    lambda_home: provenance.lambda_home ?? '',
    lambda_away: provenance.lambda_away ?? '',
    lambda_total: provenance.lambda_for_slot ?? provenance.lambda_total ?? '',
    league_avg: provenance.leagueAvg ?? '',
    divergence_pp: provenance.divergence_pp ?? '',
    divergence_flag: provenance.divergence_flag ?? false,
    divergence_resolved_by: provenance.divergence_resolved_by || '',
    phantom_edge_flag: provenance.phantom_edge_flag ?? false,
    isotonic_applied: isotonic.applied ?? false,
    isotonic_reason: isotonic.reason || '',
    isotonic_p_before: isotonic.p_before ?? '',
    isotonic_p_after: isotonic.p_after ?? '',
    isotonic_n_samples: isotonic.n_samples ?? '',
    calib_applied: calib.applied ?? false,
    calib_reason: calib.reason || '',
    qg_confidence: qg.qg_confidence ?? '',
    qg_demote_factor: qg.demote_factor ?? '',
    qg_promote_factor: qg.promote_factor ?? '',
    market_gate_pass: gate.pass ?? '',
    rank_eligible: gate.rank_eligible ?? '',
    market_gate_reasons: (gate.reasons || []).join('|'),
    evidence_engine_b_available: evidence.engine_b_available ?? '',
    evidence_drivers: asJson(evidence.drivers || []),
    evidence_notes: (evidence.notes || []).join('|'),
  };
}

function rankedRows({ mesaId, fixtureIndex, response, request, meta }) {
  const slotByKey = new Map((response.slots || []).map((slot) => [slot.market_key, slot]));
  return (response.ev_ranked || []).map((marketKey, index) => {
    const slot = slotByKey.get(marketKey) || {};
    return {
      mesa_id: mesaId,
      fixture_index: fixtureIndex,
      rank: index + 1,
      external_id: request.match.external_id,
      liga: request.match.liga,
      date: request.match.date,
      hora: meta.hora,
      home: request.match.home,
      away: request.match.away,
      market_key: marketKey,
      family: slot.family || '',
      fair_prob: slot.fair_prob ?? '',
      odd_final_curinga: firstValue(formatOdd(slot.fair_odd), oddFromProb(slot.fair_prob)),
      market_odd: slot.market_odd ?? '',
      odd_real: firstValue(request.odds_snapshot?.[marketKey], slot.market_odd),
      closing_odd: meta.closingOdds?.[marketKey] ?? '',
      settlement_result: meta.marketResults?.[marketKey] ?? '',
      brier_motor: brier(slot.fair_prob, meta.marketResults?.[marketKey] ?? ''),
      clv_pct: clvPct(slot.market_odd, meta.closingOdds?.[marketKey] ?? ''),
      edge_pct: slot.edge_pct ?? '',
      confidence: slot.confidence ?? '',
      certified_slot: slot.certified ?? '',
      weight_a: slot.provenance?.weight_a ?? '',
      weight_b: slot.provenance?.weight_b ?? '',
      fair_prob_a: slot.provenance?.fair_prob_a ?? '',
      fair_prob_b: slot.provenance?.fair_prob_b ?? '',
      pred_odd_motor_a: firstValue(formatOdd(slot.provenance?.fair_odd_a), oddFromProb(slot.provenance?.fair_prob_a)),
      pred_odd_motor_b: firstValue(formatOdd(slot.provenance?.fair_odd_b), oddFromProb(slot.provenance?.fair_prob_b)),
      divergence_pp: slot.provenance?.divergence_pp ?? '',
      phantom_edge_flag: slot.provenance?.phantom_edge_flag ?? false,
      market_gate_reasons: (slot.provenance?.qg?.market_gate?.reasons || []).join('|'),
    };
  });
}

function summaryRow({ mesaId, fixtureIndex, response, request, meta }) {
  const slots = response.slots || [];
  const bSlots = slots.filter((slot) => (slot.provenance?.weight_b ?? 0) > 0);
  const oddsSlots = slots.filter((slot) => slot.market_odd != null);
  return {
    mesa_id: mesaId,
    fixture_index: fixtureIndex,
    run_id: response.run_id || '',
    external_id: request.match.external_id,
    liga: request.match.liga,
    date: request.match.date,
    hora: meta.hora,
    home: request.match.home,
    away: request.match.away,
    certified: response.certified,
    warnings: (response.warnings || []).join('|'),
    slots_count: slots.length,
    slots_with_odds: oddsSlots.length,
    slots_with_engine_b_weight: bSlots.length,
    closing_odds_count: meta.closingOddsCount,
    market_results_count: meta.marketResultsCount,
    ev_ranked: (response.ev_ranked || []).join('|'),
    scout_summary: response.scout?.summary || '',
    scout_notes: (response.scout?.notes || []).join('|'),
    model_b_version: response.engine_signature?.model_b_version || '',
    model_b_artifacts_hash: response.engine_signature?.model_b_artifacts_hash || '',
    signature_hash: response.engine_signature?.hash || '',
    latency_ms: response.diagnostics?.latency_ms ?? '',
    engine_b_ms: response.diagnostics?.engine_b_ms ?? '',
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    console.error(usage());
    process.exit(1);
  }

  const api = String(args.api || DEFAULT_API).replace(/\/$/, '');
  const inputPath = resolve(String(args.input));
  const { mesa_id: mesaId, fixtures } = readInput(inputPath);
  const outDir = resolve(String(args.out || join('audit', mesaId)));
  fs.mkdirSync(outDir, { recursive: true });

  const allSlots = [];
  const allRanked = [];
  const summaries = [];
  const rawDir = join(outDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });

  for (let index = 0; index < fixtures.length; index += 1) {
    const request = buildRequest(fixtures[index]);
    const meta = auditMeta(fixtures[index]);
    console.log(`[mesa] ${index + 1}/${fixtures.length} ${request.match.home} x ${request.match.away} (${request.match.liga}, ${request.match.date})`);
    const response = await predict(api, request);
    const fixtureIndex = index + 1;
    fs.writeFileSync(join(rawDir, `${String(fixtureIndex).padStart(2, '0')}-${request.match.external_id.replace(/[^a-zA-Z0-9_.-]+/g, '_')}.json`), JSON.stringify(response, null, 2), 'utf8');
    if (fixtures.length === 1) {
      fs.writeFileSync(join(outDir, 'request.json'), JSON.stringify(request, null, 2), 'utf8');
      fs.writeFileSync(join(outDir, 'response.json'), JSON.stringify(response, null, 2), 'utf8');
    }
    for (const slot of response.slots || []) allSlots.push(slotRow({ mesaId, fixtureIndex, response, request, meta, slot }));
    allRanked.push(...rankedRows({ mesaId, fixtureIndex, response, request, meta }));
    summaries.push(summaryRow({ mesaId, fixtureIndex, response, request, meta }));
  }

  const slotHeaders = [
    'mesa_id','fixture_index','run_id','external_id','liga','date','hora','home','away',
    'certified_match','warnings','model_b_version','signature_hash','model_b_artifacts_hash',
    'latency_ms','engine_a_ms','engine_b_ms','curinga_ms',
    'market_key','ev_rank','family','scope','period','direction','line',
    'fair_prob_raw','fair_prob','fair_odd','market_odd','input_odd','odd_real_in_request',
    'fair_prob_curinga_final','odd_final_curinga','odd_real','implied_prob_real',
    'closing_odd','closing_odd_real_in_request','closing_odd_sane','settlement_result','result_observable',
    'brier_motor','brier_a','brier_b','clv_pct',
    'edge_pct','expected_value_pct','confidence','certified_slot','source','engine',
    'weight_a','weight_b','weight_source','fair_prob_a','fair_prob_b','pred_odd_motor_a','pred_odd_motor_b','fair_odd_a','fair_odd_b',
    'lambda_home','lambda_away','lambda_total','league_avg',
    'divergence_pp','divergence_flag','divergence_resolved_by','phantom_edge_flag',
    'isotonic_applied','isotonic_reason','isotonic_p_before','isotonic_p_after','isotonic_n_samples',
    'calib_applied','calib_reason','qg_confidence','qg_demote_factor','qg_promote_factor',
    'market_gate_pass','rank_eligible','market_gate_reasons',
    'evidence_engine_b_available','evidence_drivers','evidence_notes',
  ];
  const rankedHeaders = [
    'mesa_id','fixture_index','rank','external_id','liga','date','hora','home','away',
    'market_key','family','fair_prob','odd_final_curinga','market_odd','odd_real','closing_odd','settlement_result','brier_motor','clv_pct','edge_pct','confidence','certified_slot',
    'weight_a','weight_b','fair_prob_a','fair_prob_b','pred_odd_motor_a','pred_odd_motor_b','divergence_pp','phantom_edge_flag','market_gate_reasons',
  ];
  const summaryHeaders = [
    'mesa_id','fixture_index','run_id','external_id','liga','date','hora','home','away',
    'certified','warnings','slots_count','slots_with_odds','slots_with_engine_b_weight',
    'closing_odds_count','market_results_count','ev_ranked','scout_summary','scout_notes',
    'model_b_version','model_b_artifacts_hash','signature_hash','latency_ms','engine_b_ms',
  ];

  writeCsv(join(outDir, 'mesa_slots.csv'), allSlots, slotHeaders);
  writeCsv(join(outDir, 'audit_unified.csv'), allSlots, slotHeaders);
  writeCsv(join(outDir, 'mesa_ranked.csv'), allRanked, rankedHeaders);
  writeCsv(join(outDir, 'mesa_summary.csv'), summaries, summaryHeaders);
  fs.writeFileSync(join(outDir, 'meta.json'), JSON.stringify({
    mesa_id: mesaId,
    input: inputPath,
    api,
    fixtures_count: fixtures.length,
    slots_count: allSlots.length,
    ranked_count: allRanked.length,
    generated_at: new Date().toISOString(),
    files: ['request.json', 'response.json', 'mesa_summary.csv', 'mesa_ranked.csv', 'mesa_slots.csv', 'audit_unified.csv', 'raw/*.json'],
  }, null, 2), 'utf8');

  console.log(`[mesa] wrote ${outDir}`);
  console.log(`[mesa] fixtures=${fixtures.length} slots=${allSlots.length} ranked=${allRanked.length}`);
}

main().catch((error) => {
  console.error('[mesa] FAIL:', error?.stack || error?.message || error);
  process.exit(1);
});