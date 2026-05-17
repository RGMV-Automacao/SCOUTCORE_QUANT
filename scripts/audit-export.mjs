#!/usr/bin/env node
// scripts/audit-export.mjs
//
// Roda /v1/predict contra um confronto real e exporta CSVs auditáveis para `audit/`:
//   - predictions.csv : todos os slots (mercado, fair_prob, edge, certified, isotonic, etc)
//   - ev_ranked.csv   : ranking final
//   - ev_capped_out.csv : excluídos por family_cap
//   - scout.csv       : top_picks do scout
//   - signature.csv   : engine_signature
//   - meta.json       : metadados da run
//
// Uso (offline, sem servidor): chama predict() diretamente importando o módulo
// e construindo um repo a partir de data/scout.db.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { predict as predictA } from '@scoutcore/engine-a';
import { combine } from '@scoutcore/curinga';
import { buildEvidence } from '@scoutcore/evidence';
import * as engineB from '@scoutcore/engine-b-bridge';
import * as QG from '@scoutcore/quality-gates';
import { loadCalibrationMap, getCalib, applyCalibrationToSlot } from '@scoutcore/calibration';
import { loadIsotonicMap, getIsotonic, applyIsotonicToSlot } from '@scoutcore/isotonic';
import { buildScoutReport } from '@scoutcore/scout';
import { buildSignature } from '../apps/api/src/engine-signature.mjs';
import { SqliteMatchRepository } from '@scoutcore/data-access';
import { lookupSuperbetOdd } from './lib/superbet-mapping.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DB_PATH = process.env.SCOUT_DB || resolve(ROOT, 'data', 'scout.db');
const OUT = resolve(ROOT, 'audit');
fs.mkdirSync(OUT, { recursive: true });

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','));
  return lines.join('\n') + '\n';
}

function readOptionalJson(path) {
  if (!path) return {};
  return JSON.parse(fs.readFileSync(resolve(path), 'utf8').replace(/^\uFEFF/, ''));
}

function asJson(value) {
  if (value == null) return '';
  return JSON.stringify(value);
}

function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function evaluateMarketGate(slot, { gates, minEdgePp = 0 } = {}) {
  const reasons = [];
  if (slot.market_odd == null || slot.edge_pct == null) {
    return { pass: true, rank_eligible: false, reasons: ['no_market_odd'] };
  }
  const edgeMin = Math.max(Number(gates?.edge_min_pp ?? 0), Number(minEdgePp ?? 0));
  const evMin = Number(gates?.ev_min_pct ?? 0);
  if (gates?.leg_ev_positive === true && slot.edge_pct < 0) reasons.push('leg_ev_negative');
  if (slot.edge_pct < edgeMin) reasons.push('edge_below_min');
  if (slot.edge_pct < evMin) reasons.push('ev_below_min');
  return { pass: reasons.length === 0, rank_eligible: reasons.length === 0, edge_min_pp: edgeMin, ev_min_pct: evMin, reasons };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const runId = process.env.AUDIT_RUN_ID || `audit:${generatedAt}`;
  const closingOdds = readOptionalJson(process.env.AUDIT_CLOSING_ODDS);
  const marketResults = readOptionalJson(process.env.AUDIT_MARKET_RESULTS);
  // 1. Pega partida com (a) priors+profiles E (b) odds Superbet reais.
  //    Quando o usuário passa MATCH_HOME/MATCH_AWAY/MATCH_DATE via env, usamos.
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  let c;
  if (process.env.MATCH_HOME && process.env.MATCH_AWAY && process.env.MATCH_DATE) {
    c = db.prepare(`SELECT * FROM partidas WHERE home_team=? AND away_team=? AND data_partida LIKE ? AND modo='FT' LIMIT 1`).get(
      process.env.MATCH_HOME, process.env.MATCH_AWAY, `${process.env.MATCH_DATE}%`
    );
  }
  if (!c) {
    // tenta partida com priors+profiles+odds Superbet
    c = db.prepare(`
      SELECT p.* FROM partidas p
      INNER JOIN league_priors lp ON lp.liga = p.liga
      INNER JOIN team_profile_v2 tph ON tph.team = p.home_team AND tph.liga = p.liga
      INNER JOIN team_profile_v2 tpa ON tpa.team = p.away_team AND tpa.liga = p.liga
      INNER JOIN (SELECT DISTINCT home_team, away_team, data_jogo FROM odds WHERE fonte='superbet') o
        ON o.home_team = p.home_team AND o.away_team = p.away_team AND o.data_jogo = SUBSTR(p.data_partida, 1, 10)
      WHERE p.modo = 'FT'
      ORDER BY p.data_partida DESC
      LIMIT 1
    `).get();
  }
  if (!c) {
    // fallback: priors+profiles, sem odds Superbet (audit usará synthetic odds)
    c = db.prepare(`
      SELECT p.* FROM partidas p
      INNER JOIN league_priors lp ON lp.liga = p.liga
      INNER JOIN team_profile_v2 tph ON tph.team = p.home_team AND tph.liga = p.liga
      INNER JOIN team_profile_v2 tpa ON tpa.team = p.away_team AND tpa.liga = p.liga
      WHERE p.modo = 'FT' AND p.data_partida IS NOT NULL
      ORDER BY p.data_partida DESC LIMIT 1
    `).get();
  }
  if (!c) throw new Error('no_match_in_db');

  const match = {
    external_id: String(c.id_confronto || c.id || `${c.home_team}-${c.away_team}-${c.data_partida}`),
    liga: c.liga, home: c.home_team, away: c.away_team,
    date: (c.data_partida || '').slice(0, 10),
  };
  console.log(`[audit] match: ${match.home} × ${match.away} | ${match.liga} | ${match.date}`);

  // 1b. Snapshot de odds Superbet por (mercado, selecao, linha) deste jogo
  const superbetMap = new Map(); // key: market|selecao|linha → odd
  const superbetMarkets = new Set();
  const odateLike = match.date;
  const sbRows = db.prepare(`SELECT mercado, selecao, linha, odd FROM odds WHERE fonte='superbet' AND home_team=? AND away_team=? AND data_jogo=? ORDER BY criado_em DESC`).all(match.home, match.away, odateLike);
  for (const r of sbRows) {
    const key = `${r.mercado}|${r.selecao}|${r.linha}`;
    if (!superbetMap.has(key)) superbetMap.set(key, r.odd);
    superbetMarkets.add(r.mercado);
  }
  console.log(`[audit] Superbet snapshot: ${sbRows.length} odds, ${superbetMarkets.size} mercados distintos`);
  db.close();

  // 2. Repo
  const repo = new SqliteMatchRepository(DB_PATH);

  // 3. Pipeline (espelho de predict.mjs)
  const temporada = match.date.slice(0, 4);
  const profileHome = repo.getTeamProfile({ team: match.home, liga: match.liga, temporada, side: 'home', asOf: match.date });
  const profileAway = repo.getTeamProfile({ team: match.away, liga: match.liga, temporada, side: 'away', asOf: match.date });
  const priorsFt    = repo.getLeaguePriors({ liga: match.liga, temporada, period: 'FT', asOf: match.date });

  const warnings = [];
  if (!profileHome) warnings.push(`team_profile_home_missing:${match.home}`);
  if (!profileAway) warnings.push(`team_profile_away_missing:${match.away}`);
  if (!priorsFt)    warnings.push(`league_priors_missing:${match.liga}`);
  const certifiedInputs = !!profileHome && !!profileAway && !!priorsFt;

  const calibMap = loadCalibrationMap(repo.db, 'A');
  const COUNT_FAMILIES = ['escanteios', 'chutes', 'cartoes', 'faltas'];
  const engineCalib = {};
  for (const fam of COUNT_FAMILIES) {
    const cc = getCalib(calibMap, { family: fam, direction: 'over', liga: match.liga });
    if (cc.sample_size > 0 && cc.lambda_mult !== 1.0) {
      engineCalib[fam] = { lambda_mult: cc.lambda_mult, sample_size: cc.sample_size };
    }
  }

  const aOut = predictA({
    home: match.home, away: match.away, liga: match.liga,
    profileHome: profileHome ?? {}, profileAway: profileAway ?? {},
    priors: priorsFt ?? {},
    calibration: engineCalib,
  });

  // Engine B (best-effort)
  const bOut = await engineB.predictBatch({ liga: match.liga, home: match.home, away: match.away, data: match.date });
  if (!bOut.available) warnings.push(`engine_b_unavailable:${bOut.reason}`);

  const combined = combine({ slotsA: aOut.slots, slotsB: bOut.available ? bOut.slots : null });

  // Odds: tenta REAIS Superbet por slot; só usa sintético quando explicitamente pedido.
  const odds = {};
  const oddsProvenance = {}; // market_key → { kind, source, mercado_superbet, selecao, linha, reason }
  const dbRO = new Database(DB_PATH, { readonly: true });
  let realCount = 0, mappedNotOffered = 0, unmapped = 0;
  for (const s of combined) {
    const lk = lookupSuperbetOdd(dbRO, { market_key: s.market_key, home: match.home, away: match.away, data: match.date });
    if (lk.found) {
      odds[s.market_key] = lk.odd;
      oddsProvenance[s.market_key] = { kind: 'real', source: 'superbet', mercado_superbet: lk.mercado_superbet, selecao_superbet: lk.selecao_superbet, linha_superbet: lk.linha_superbet };
      realCount++;
    } else {
      oddsProvenance[s.market_key] = { kind: 'absent', reason: lk.reason };
      if (lk.reason === 'unmapped_in_motor_catalog') unmapped++;
      else mappedNotOffered++;
    }
  }
  dbRO.close();
  const SYNTHETIC_ODDS = process.env.AUDIT_SYNTHETIC_ODDS === '1';
  if (SYNTHETIC_ODDS) {
    for (const s of combined) {
      if (odds[s.market_key] != null) continue; // não sobrescreve real
      if (s.fair_prob > 0.02 && s.fair_prob < 0.98) {
        odds[s.market_key] = +(1 / s.fair_prob * 1.05).toFixed(3);
        oddsProvenance[s.market_key] = { kind: 'synthetic', source: 'fair_x1.05', reason: 'no_real_odd_available' };
      }
    }
  }
  console.log(`[audit] odds: real=${realCount}/${combined.length}, mapped_no_market=${mappedNotOffered}, unmapped=${unmapped}, synthetic_fill=${SYNTHETIC_ODDS}`);
  const isoMap = loadIsotonicMap(repo.db);
  const qgGates = QG.getGates();
  for (const s of combined) {
    s.certified = s.certified && certifiedInputs;
    const isoEntry = getIsotonic(isoMap, { family: s.family, period: s.period, direction: s.direction, liga: match.liga });
    applyIsotonicToSlot(s, isoEntry);
    const mo = odds[s.market_key];
    if (mo) {
      s.market_odd = mo;
      s.edge_pct = +((s.fair_prob * mo - 1) * 100).toFixed(2);
    }
    const qgEval = QG.evaluateSlot(s, { liga: match.liga });
    const baseConfidence = certifiedInputs ? 0.5 : 0.2;
    s.confidence = +(baseConfidence * qgEval.qg_confidence).toFixed(4);
    const marketGate = evaluateMarketGate(s, { gates: qgGates });
    s.provenance = { ...(s.provenance ?? {}), qg: { ...qgEval, market_gate: marketGate } };
    if (!marketGate.pass) s.certified = false;
    const calib = getCalib(calibMap, { family: s.family, direction: s.direction, liga: match.liga });
    applyCalibrationToSlot(s, calib);
    if (s.edge_pct != null && qgGates.phantom_edge_threshold_pp != null && s.edge_pct >= qgGates.phantom_edge_threshold_pp) {
      s.provenance.phantom_edge_flag = true;
      s.certified = false;
    }
    s.evidence = buildEvidence(s, { home: match.home, away: match.away, liga: match.liga });
  }

  // EV ranking + family cap
  const scored = combined
    .filter((s) =>
      s.market_odd != null &&
      s.edge_pct != null &&
      s.provenance?.qg?.market_gate?.rank_eligible === true &&
      !s.provenance?.phantom_edge_flag,
    )
    .map((s) => {
      const score = (s.edge_pct ?? 0) * (s.confidence ?? 0.5);
      return { market_key: s.market_key, family: s.family, score };
    })
    .sort((a, b) => b.score - a.score);
  const familyCounts = new Map();
  const ev_ranked = [];
  const ev_ranked_capped_out = [];
  for (const x of scored) {
    const cap = QG.getFamilyCap(x.family) ?? Infinity;
    const cur = familyCounts.get(x.family) ?? 0;
    if (cur < cap) { ev_ranked.push(x.market_key); familyCounts.set(x.family, cur + 1); }
    else { ev_ranked_capped_out.push(x.market_key); }
  }

  const scout = buildScoutReport({ match, slots: combined, evRanked: ev_ranked, evRankedCappedOut: ev_ranked_capped_out, warnings });
  const sig = buildSignature({
    db: repo.db,
    dataSnapshot: {
      match,
      temporada,
      as_of: match.date,
      inputs: { profile_home: profileHome, profile_away: profileAway, league_priors_ft: priorsFt },
    },
  });

  // 4. Export CSVs
  const bSlotKeys = new Set(bOut.available ? bOut.slots.map((x) => x.market_key) : []);
  const aSlotKeys = new Set(aOut.slots.map((x) => x.market_key));
  function coverageStatus(market_key) {
    const inA = aSlotKeys.has(market_key);
    const inB = bSlotKeys.has(market_key);
    if (inA && inB) return 'engine_a_and_b';
    if (inA) return 'engine_a_only';
    if (inB) return 'engine_b_only';
    return 'none';
  }
  const predictionsRows = combined.map((s) => {
    const op = oddsProvenance[s.market_key] ?? { kind: 'absent', reason: 'unknown' };
    return {
    market_key: s.market_key,
    family: s.family,
    direction: s.direction,
    line: s.line,
    period: s.period,
    scope: s.scope,
    fair_prob: s.fair_prob,
    fair_odd: s.fair_odd,
    market_odd: s.market_odd,
    edge_pct: s.edge_pct,
    confidence: s.confidence,
    certified: s.certified,
    source: s.source,
    coverage_status: coverageStatus(s.market_key),
    odd_kind: op.kind,
    odd_source: op.source ?? '',
    odd_reason: op.reason ?? '',
    superbet_present: op.kind === 'real',
    superbet_mercado: op.mercado_superbet ?? '',
    superbet_selecao: op.selecao_superbet ?? '',
    superbet_linha: op.linha_superbet ?? '',
    isotonic_applied: s.provenance?.isotonic?.applied ?? false,
    isotonic_p_before: s.provenance?.isotonic?.p_before ?? '',
    isotonic_p_after: s.provenance?.isotonic?.p_after ?? '',
    calib_applied: s.provenance?.calib?.applied ?? false,
    family_cap_excluded: s.provenance?.family_cap_excluded ?? false,
    phantom_edge_flag: s.provenance?.phantom_edge_flag ?? false,
    weight_a: s.provenance?.weight_a ?? '',
    weight_b: s.provenance?.weight_b ?? '',
    fair_prob_a: s.provenance?.fair_prob_a ?? '',
    fair_prob_b: s.provenance?.fair_prob_b ?? '',
    divergence_pp: s.provenance?.divergence_pp ?? '',
  };
  });

  const auditUnifiedRows = combined.map((s) => {
    const op = oddsProvenance[s.market_key] ?? { kind: 'absent', reason: 'unknown' };
    const provenance = s.provenance || {};
    const qg = provenance.qg || {};
    const gate = qg.market_gate || {};
    const isotonic = provenance.isotonic || {};
    const calib = provenance.calib || {};
    const close = closingOdds[s.market_key] ?? '';
    const settlement = marketResults[s.market_key] ?? '';
    return {
      run_id: runId,
      external_id: match.external_id,
      liga: match.liga,
      date: match.date,
      hora: match.hora || '',
      home: match.home,
      away: match.away,
      certified_match: certifiedInputs,
      warnings: warnings.join('|'),
      model_b_version: sig.model_b_version,
      signature_hash: sig.hash,
      calib_snapshot_id: sig.calib_snapshot_id,
      data_snapshot_hash: sig.data_snapshot_hash,
      model_b_artifacts_hash: sig.model_b_artifacts_hash,
      market_key: s.market_key,
      family: s.family,
      scope: s.scope,
      period: s.period,
      direction: s.direction,
      line: s.line,
      fair_prob_raw: s.fair_prob_raw,
      fair_prob: s.fair_prob,
      fair_odd: s.fair_odd,
      market_odd: s.market_odd,
      closing_odd: close,
      closing_odd_sane: isClosingOddSane(s.market_odd, close),
      settlement_result: settlement,
      brier_motor: brier(s.fair_prob, settlement),
      brier_a: brier(provenance.fair_prob_a, settlement),
      brier_b: brier(provenance.fair_prob_b, settlement),
      clv_pct: clvPct(s.market_odd, close),
      edge_pct: s.edge_pct,
      confidence: s.confidence,
      certified_slot: s.certified,
      source: s.source,
      coverage_status: coverageStatus(s.market_key),
      odd_kind: op.kind,
      odd_reason: op.reason ?? '',
      weight_a: provenance.weight_a ?? '',
      weight_b: provenance.weight_b ?? '',
      fair_prob_a: provenance.fair_prob_a ?? '',
      fair_prob_b: provenance.fair_prob_b ?? '',
      divergence_pp: provenance.divergence_pp ?? '',
      phantom_edge_flag: provenance.phantom_edge_flag ?? false,
      isotonic_applied: isotonic.applied ?? false,
      isotonic_reason: isotonic.reason || '',
      isotonic_n_samples: isotonic.n_samples ?? '',
      calib_applied: calib.applied ?? false,
      calib_reason: calib.reason || '',
      qg_confidence: qg.qg_confidence ?? '',
      market_gate_pass: gate.pass ?? '',
      rank_eligible: gate.rank_eligible ?? '',
      market_gate_reasons: (gate.reasons || []).join('|'),
      evidence_drivers: asJson(s.evidence?.drivers || []),
      evidence_notes: (s.evidence?.notes || []).join('|'),
    };
  });

  fs.writeFileSync(resolve(OUT, 'predictions.csv'), toCsv(predictionsRows, [
    'market_key','family','direction','line','period','scope',
    'fair_prob','fair_odd','market_odd','edge_pct','confidence','certified','source',
    'coverage_status','odd_kind','odd_source','odd_reason',
    'superbet_present','superbet_mercado','superbet_selecao','superbet_linha',
    'isotonic_applied','isotonic_p_before','isotonic_p_after',
    'calib_applied','family_cap_excluded','phantom_edge_flag',
    'weight_a','weight_b','fair_prob_a','fair_prob_b','divergence_pp',
  ]));

  fs.writeFileSync(resolve(OUT, 'audit_unified.csv'), toCsv(auditUnifiedRows, [
    'run_id','external_id','liga','date','hora','home','away','certified_match','warnings',
    'model_b_version','signature_hash','calib_snapshot_id','data_snapshot_hash','model_b_artifacts_hash',
    'market_key','family','scope','period','direction','line',
    'fair_prob_raw','fair_prob','fair_odd','market_odd','closing_odd','closing_odd_sane','settlement_result',
    'brier_motor','brier_a','brier_b','clv_pct','edge_pct','confidence','certified_slot','source',
    'coverage_status','odd_kind','odd_reason','weight_a','weight_b','fair_prob_a','fair_prob_b','divergence_pp',
    'phantom_edge_flag','isotonic_applied','isotonic_reason','isotonic_n_samples','calib_applied','calib_reason',
    'qg_confidence','market_gate_pass','rank_eligible','market_gate_reasons','evidence_drivers','evidence_notes',
  ]));

  // coverage_audit.csv: agregado por (família, status)
  const covAgg = new Map();
  for (const row of predictionsRows) {
    const k = `${row.family}|${row.coverage_status}|${row.odd_kind}`;
    if (!covAgg.has(k)) covAgg.set(k, { family: row.family, coverage_status: row.coverage_status, odd_kind: row.odd_kind, count: 0, examples: [] });
    const e = covAgg.get(k);
    e.count++;
    if (e.examples.length < 3) e.examples.push(row.market_key);
  }
  fs.writeFileSync(resolve(OUT, 'coverage_audit.csv'), toCsv(
    [...covAgg.values()].sort((a,b)=> a.family.localeCompare(b.family) || b.count - a.count).map(e => ({ ...e, examples: e.examples.join(';') })),
    ['family','coverage_status','odd_kind','count','examples']
  ));

  fs.writeFileSync(resolve(OUT, 'ev_ranked.csv'), toCsv(
    ev_ranked.map((k, i) => ({ rank: i + 1, market_key: k })),
    ['rank', 'market_key']
  ));
  fs.writeFileSync(resolve(OUT, 'ev_capped_out.csv'), toCsv(
    ev_ranked_capped_out.map((k) => ({ market_key: k })),
    ['market_key']
  ));
  fs.writeFileSync(resolve(OUT, 'scout.csv'), toCsv(
    scout.top_picks.map((p, i) => ({ rank: i + 1, ...p })),
    ['rank','market_key','family','direction','line','fair_prob','market_odd','edge_pct','confidence','certified','isotonic_applied','calib_applied','phantom']
  ));
  fs.writeFileSync(resolve(OUT, 'signature.csv'), toCsv(
    [{ key: 'engine_signature', value: JSON.stringify(sig) }],
    ['key', 'value']
  ));
  fs.writeFileSync(resolve(OUT, 'meta.json'), JSON.stringify({
    match, certified: certifiedInputs, warnings,
    run_id: runId,
    slots_count: combined.length,
    ev_ranked_count: ev_ranked.length,
    ev_capped_out_count: ev_ranked_capped_out.length,
    files: ['predictions.csv', 'audit_unified.csv', 'ev_ranked.csv', 'ev_capped_out.csv', 'coverage_audit.csv', 'scout.csv', 'signature.csv', 'meta.json'],
    engine_b: { available: bOut.available, reason: bOut.reason ?? null, version: bOut.version, slots_count: bOut.available ? bOut.slots.length : 0 },
    superbet: {
      odds_total: sbRows.length,
      mercados_distintos: superbetMarkets.size,
      mercados_lista: [...superbetMarkets].sort(),
      slots_with_real_odd: realCount,
      slots_mapped_but_no_market: mappedNotOffered,
      slots_unmapped_in_catalog: unmapped,
    },
    odds_policy: SYNTHETIC_ODDS
      ? 'real_superbet_when_available_else_synthetic_fair_x1.05'
      : 'real_superbet_only',
    odds_disclaimer: SYNTHETIC_ODDS
      ? 'Slots sem odd Superbet receberam fallback sintético (1/fair_prob × 1.05). Isso preenche edge_pct para teste de pipeline mas NÃO reflete preço real. Marcado em odd_kind=synthetic.'
      : 'Apenas odds REAIS Superbet usadas. Slots sem mercado ficam com market_odd=null e edge_pct=null. Use AUDIT_SYNTHETIC_ODDS=1 para preencher gaps com sintético.',
    signature: sig,
    scout_summary: scout.summary,
    scout_notes: scout.notes,
    generated_at: generatedAt,
  }, null, 2));

  console.log(`[audit] wrote ${OUT}`);
  console.log(`[audit] slots=${combined.length} ev_ranked=${ev_ranked.length} capped_out=${ev_ranked_capped_out.length}`);
  console.log(`[audit] engine_b: ${bOut.available ? `OK (${bOut.slots.length} slots)` : `unavailable: ${bOut.reason}`}`);
  repo.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
