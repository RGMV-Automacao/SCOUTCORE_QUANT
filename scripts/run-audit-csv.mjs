#!/usr/bin/env node
// Exporta auditoria a partir de um /v1/run real já persistido.

import fs from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

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
  return `Uso: node scripts/run-audit-csv.mjs --run-id=<batch_run_id> [--match-id=<id_confronto>] [--out=audit/run] [--db=data/scout_extraction.db]\n`;
}

function parseJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
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

function asJson(value) {
  if (value == null) return '';
  return JSON.stringify(value);
}

function safeName(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function prepareOutDir(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of ['request.json', 'response.json', 'mesa_summary.csv', 'mesa_ranked.csv', 'mesa_slots.csv', 'audit_unified.csv', 'meta.json']) {
    fs.rmSync(join(outDir, file), { force: true });
  }
  fs.rmSync(join(outDir, 'raw'), { recursive: true, force: true });
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function loadResponses(db, { batchRunId, predictionRunId, matchId }) {
  if (predictionRunId) {
    const row = db.prepare(`SELECT * FROM motor_run WHERE run_id = ?`).get(predictionRunId);
    return row ? [row] : [];
  }

  const slotRows = db.prepare(`SELECT payload FROM run_slots WHERE run_id = ? ORDER BY idx ASC`).all(batchRunId);
  const runIds = [...new Set(slotRows
    .map((row) => parseJson(row.payload, {}))
    .filter((slot) => !matchId || slot.match_id === matchId)
    .map((slot) => slot.prediction_run_id || slot.run_id)
    .filter(Boolean))];

  if (runIds.length === 0) return [];
  return db.prepare(`SELECT * FROM motor_run WHERE run_id IN (${placeholders(runIds)}) ORDER BY created_at ASC`).all(...runIds)
    .filter((row) => !matchId || row.match_id === matchId);
}

function slotRank(response, marketKey) {
  const index = (response.ev_ranked || []).indexOf(marketKey);
  return index >= 0 ? index + 1 : '';
}

function slotRow({ batchRunId, response, request, slot }) {
  const provenance = slot.provenance || {};
  const odd = provenance.odd || {};
  const qg = provenance.qg || {};
  const gate = qg.market_gate || {};
  const isotonic = provenance.isotonic || {};
  const calib = provenance.calib || {};
  const diagnostics = response.diagnostics || {};
  const fairProb = toNumber(slot.fair_prob);
  const marketOdd = toNumber(slot.market_odd);
  const oddFinalCuringa = firstValue(formatOdd(slot.fair_odd), oddFromProb(slot.fair_prob));
  const predOddA = firstValue(formatOdd(provenance.fair_odd_a), oddFromProb(provenance.fair_prob_a));
  const predOddB = firstValue(formatOdd(provenance.fair_odd_b), oddFromProb(provenance.fair_prob_b));
  return {
    batch_run_id: batchRunId,
    prediction_run_id: response.run_id || '',
    external_id: response.match?.external_id || request.match?.external_id || '',
    liga: response.match?.liga || request.match?.liga || '',
    date: response.match?.date || request.match?.date || '',
    hora: response.match?.hora || request.match?.hora || '',
    home: response.match?.home || request.match?.home || '',
    away: response.match?.away || request.match?.away || '',
    certified_match: response.certified,
    warnings: (response.warnings || []).join('|'),
    model_b_version: response.engine_signature?.model_b_version || '',
    signature_hash: response.engine_signature?.hash || '',
    model_b_artifacts_hash: response.engine_signature?.model_b_artifacts_hash || '',
    latency_ms: diagnostics.latency_ms ?? '',
    engine_a_ms: diagnostics.engine_a_ms ?? '',
    engine_b_ms: diagnostics.engine_b_ms ?? '',
    curinga_ms: diagnostics.curinga_ms ?? '',
    scout_ms: diagnostics.scout_ms ?? '',
    scout_provider: diagnostics.scout_provider ?? '',
    scout_web_context: diagnostics.scout_web_context ?? '',
    market_key: slot.market_key,
    ev_rank: slotRank(response, slot.market_key),
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
    odd_real: slot.market_odd ?? '',
    implied_prob_real: marketOdd != null ? +(1 / marketOdd).toFixed(6) : '',
    odd_source: odd.source || '',
    odd_found: odd.found ?? '',
    odd_reason: odd.reason || '',
    odd_mercado: odd.mercado || '',
    odd_selecao: odd.selecao || '',
    odd_linha: odd.linha ?? '',
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
    divergence_pp: provenance.divergence_pp ?? '',
    divergence_flag: provenance.divergence_flag ?? false,
    phantom_edge_flag: provenance.phantom_edge_flag ?? false,
    isotonic_applied: isotonic.applied ?? false,
    isotonic_reason: isotonic.reason || '',
    isotonic_p_before: isotonic.p_before ?? '',
    isotonic_p_after: isotonic.p_after ?? '',
    isotonic_n_samples: isotonic.n_samples ?? '',
    calib_applied: calib.applied ?? false,
    calib_reason: calib.reason || '',
    qg_confidence: qg.qg_confidence ?? '',
    market_gate_pass: gate.pass ?? '',
    rank_eligible: gate.rank_eligible ?? '',
    market_gate_reasons: (gate.reasons || []).join('|'),
    evidence_engine_b_available: slot.evidence?.engine_b_available ?? '',
    evidence_drivers: asJson(slot.evidence?.drivers || []),
    evidence_notes: (slot.evidence?.notes || []).join('|'),
  };
}

function rankedRows({ response }) {
  const slotByKey = new Map((response.slots || []).map((slot) => [slot.market_key, slot]));
  return (response.ev_ranked || []).map((marketKey, index) => {
    const slot = slotByKey.get(marketKey) || {};
    return {
      prediction_run_id: response.run_id || '',
      rank: index + 1,
      external_id: response.match?.external_id || '',
      liga: response.match?.liga || '',
      date: response.match?.date || '',
      hora: response.match?.hora || '',
      home: response.match?.home || '',
      away: response.match?.away || '',
      market_key: marketKey,
      family: slot.family || '',
      fair_prob: slot.fair_prob ?? '',
      odd_final_curinga: firstValue(formatOdd(slot.fair_odd), oddFromProb(slot.fair_prob)),
      market_odd: slot.market_odd ?? '',
      odd_real: slot.market_odd ?? '',
      edge_pct: slot.edge_pct ?? '',
      confidence: slot.confidence ?? '',
      certified_slot: slot.certified ?? '',
      weight_a: slot.provenance?.weight_a ?? '',
      weight_b: slot.provenance?.weight_b ?? '',
      fair_prob_a: slot.provenance?.fair_prob_a ?? '',
      fair_prob_b: slot.provenance?.fair_prob_b ?? '',
      pred_odd_motor_a: firstValue(formatOdd(slot.provenance?.fair_odd_a), oddFromProb(slot.provenance?.fair_prob_a)),
      pred_odd_motor_b: firstValue(formatOdd(slot.provenance?.fair_odd_b), oddFromProb(slot.provenance?.fair_prob_b)),
      odd_source: slot.provenance?.odd?.source || '',
      odd_mercado: slot.provenance?.odd?.mercado || '',
      odd_selecao: slot.provenance?.odd?.selecao || '',
      phantom_edge_flag: slot.provenance?.phantom_edge_flag ?? false,
      market_gate_reasons: (slot.provenance?.qg?.market_gate?.reasons || []).join('|'),
    };
  });
}

function summaryRow({ batchRunId, response }) {
  const slots = response.slots || [];
  const oddsSlots = slots.filter((slot) => slot.market_odd != null);
  const bSlots = slots.filter((slot) => (slot.provenance?.weight_b ?? 0) > 0);
  return {
    batch_run_id: batchRunId,
    prediction_run_id: response.run_id || '',
    external_id: response.match?.external_id || '',
    liga: response.match?.liga || '',
    date: response.match?.date || '',
    hora: response.match?.hora || '',
    home: response.match?.home || '',
    away: response.match?.away || '',
    certified: response.certified,
    warnings: (response.warnings || []).join('|'),
    slots_count: slots.length,
    slots_with_odds: oddsSlots.length,
    slots_with_engine_b_weight: bSlots.length,
    ev_ranked_count: (response.ev_ranked || []).length,
    scout_summary: response.scout?.summary || '',
    scout_notes: (response.scout?.notes || []).join('|'),
    engine_b_ms: response.diagnostics?.engine_b_ms ?? '',
    scout_ms: response.diagnostics?.scout_ms ?? '',
    scout_web_context: response.diagnostics?.scout_web_context ?? '',
    odds_diagnostics: asJson(response.diagnostics?.odds || {}),
    signature_hash: response.engine_signature?.hash || '',
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args['run-id'] && !args['prediction-run-id']) {
    console.error(usage());
    process.exit(1);
  }

  const batchRunId = String(args['run-id'] || '');
  const predictionRunId = args['prediction-run-id'] ? String(args['prediction-run-id']) : '';
  const matchId = args['match-id'] ? String(args['match-id']) : '';
  const dbPath = resolve(String(args.db || process.env.SCOUT_DB || 'data/scout_extraction.db'));
  const outDir = resolve(String(args.out || join('audit', `run-audit-${safeName(batchRunId || predictionRunId)}`)));
  prepareOutDir(outDir);
  const rawDir = join(outDir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });

  const db = new Database(dbPath, { readonly: true });
  const rows = loadResponses(db, { batchRunId, predictionRunId, matchId });
  if (rows.length === 0) throw new Error(`nenhum_motor_run_encontrado run=${batchRunId || predictionRunId} match=${matchId || '*'}`);

  const allSlots = [];
  const allRanked = [];
  const summaries = [];
  const responses = [];
  for (const row of rows) {
    const request = parseJson(row.request_payload, {});
    const response = parseJson(row.response_payload, {});
    responses.push(response);
    fs.writeFileSync(join(rawDir, `${safeName(row.run_id)}.json`), JSON.stringify({ motor_run: row, request, response }, null, 2), 'utf8');
    for (const slot of response.slots || []) allSlots.push(slotRow({ batchRunId, response, request, slot }));
    allRanked.push(...rankedRows({ response }));
    summaries.push(summaryRow({ batchRunId, response }));
  }

  if (rows.length === 1) {
    fs.writeFileSync(join(outDir, 'request.json'), rows[0].request_payload, 'utf8');
    fs.writeFileSync(join(outDir, 'response.json'), rows[0].response_payload, 'utf8');
  }

  const slotHeaders = [
    'batch_run_id','prediction_run_id','external_id','liga','date','hora','home','away',
    'certified_match','warnings','model_b_version','signature_hash','model_b_artifacts_hash',
    'latency_ms','engine_a_ms','engine_b_ms','curinga_ms','scout_ms','scout_provider','scout_web_context',
    'market_key','ev_rank','family','scope','period','direction','line',
    'fair_prob_raw','fair_prob','fair_odd','fair_prob_curinga_final','odd_final_curinga',
    'market_odd','odd_real','implied_prob_real','odd_source','odd_found','odd_reason','odd_mercado','odd_selecao','odd_linha',
    'edge_pct','expected_value_pct','confidence','certified_slot','source','engine',
    'weight_a','weight_b','weight_source','fair_prob_a','fair_prob_b','pred_odd_motor_a','pred_odd_motor_b','fair_odd_a','fair_odd_b',
    'lambda_home','lambda_away','lambda_total','divergence_pp','divergence_flag','phantom_edge_flag',
    'isotonic_applied','isotonic_reason','isotonic_p_before','isotonic_p_after','isotonic_n_samples',
    'calib_applied','calib_reason','qg_confidence','market_gate_pass','rank_eligible','market_gate_reasons',
    'evidence_engine_b_available','evidence_drivers','evidence_notes',
  ];
  const rankedHeaders = [
    'prediction_run_id','rank','external_id','liga','date','hora','home','away','market_key','family',
    'fair_prob','odd_final_curinga','market_odd','odd_real','edge_pct','confidence','certified_slot',
    'weight_a','weight_b','fair_prob_a','fair_prob_b','pred_odd_motor_a','pred_odd_motor_b',
    'odd_source','odd_mercado','odd_selecao','phantom_edge_flag','market_gate_reasons',
  ];
  const summaryHeaders = [
    'batch_run_id','prediction_run_id','external_id','liga','date','hora','home','away','certified','warnings',
    'slots_count','slots_with_odds','slots_with_engine_b_weight','ev_ranked_count','scout_summary','scout_notes',
    'engine_b_ms','scout_ms','scout_web_context','odds_diagnostics','signature_hash',
  ];

  writeCsv(join(outDir, 'audit_unified.csv'), allSlots, slotHeaders);
  writeCsv(join(outDir, 'mesa_slots.csv'), allSlots, slotHeaders);
  writeCsv(join(outDir, 'mesa_ranked.csv'), allRanked, rankedHeaders);
  writeCsv(join(outDir, 'mesa_summary.csv'), summaries, summaryHeaders);
  fs.writeFileSync(join(outDir, 'meta.json'), JSON.stringify({
    source: 'motor_run.response_payload',
    batch_run_id: batchRunId || null,
    prediction_run_id: predictionRunId || null,
    match_id: matchId || null,
    db: dbPath,
    responses_count: rows.length,
    slots_count: allSlots.length,
    ranked_count: allRanked.length,
    prediction_run_ids: responses.map((response) => response.run_id).filter(Boolean),
    files: ['request.json', 'response.json', 'mesa_summary.csv', 'mesa_ranked.csv', 'mesa_slots.csv', 'audit_unified.csv', 'raw/*.json'],
    generated_at: new Date().toISOString(),
  }, null, 2), 'utf8');
  db.close();

  console.log(`[run-audit] wrote ${outDir}`);
  console.log(`[run-audit] responses=${rows.length} slots=${allSlots.length} ranked=${allRanked.length}`);
}

main().catch((error) => {
  console.error('[run-audit] FAIL:', error?.stack || error?.message || error);
  process.exit(1);
});