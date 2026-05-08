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

async function main() {
  // 1. Pega último confronto (tabela `partidas`) com priors disponíveis
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const c = db.prepare(`
    SELECT p.* FROM partidas p
    INNER JOIN league_priors lp ON lp.liga = p.liga
    INNER JOIN team_profile_v2 tph ON tph.team = p.home_team AND tph.liga = p.liga
    INNER JOIN team_profile_v2 tpa ON tpa.team = p.away_team AND tpa.liga = p.liga
    WHERE p.modo = 'FT' AND p.data_partida IS NOT NULL
    ORDER BY p.data_partida DESC
    LIMIT 1
  `).get() || db.prepare(`SELECT * FROM partidas WHERE modo='FT' ORDER BY data_partida DESC LIMIT 1`).get();
  if (!c) throw new Error('no_match_in_db');
  db.close();

  const match = {
    external_id: String(c.id_confronto || c.id || `${c.home_team}-${c.away_team}-${c.data_partida}`),
    liga: c.liga, home: c.home_team, away: c.away_team,
    date: (c.data_partida || '').slice(0, 10),
  };
  console.log(`[audit] match: ${match.home} × ${match.away} | ${match.liga} | ${match.date}`);

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

  const odds = {};
  // odds sintéticas para auditoria visualizar edge_pct: fair_odd * 1.05 (margem 5%)
  // Marcamos isso explicitamente em meta.json. NÃO são odds reais de mercado.
  const SYNTHETIC_ODDS = process.env.AUDIT_SYNTHETIC_ODDS !== '0';
  if (SYNTHETIC_ODDS) {
    for (const s of combined) {
      if (s.fair_prob > 0.02 && s.fair_prob < 0.98) {
        odds[s.market_key] = +(1 / s.fair_prob * 1.05).toFixed(3);
      }
    }
  }
  const isoMap = loadIsotonicMap(repo.db);
  const qgGates = QG.getGates();
  for (const s of combined) {
    s.certified = s.certified && certifiedInputs;
    const isoEntry = getIsotonic(isoMap, { family: s.family, direction: s.direction, liga: match.liga });
    applyIsotonicToSlot(s, isoEntry);
    const mo = odds[s.market_key];
    if (mo) {
      s.market_odd = mo;
      s.edge_pct = +((s.fair_prob * mo - 1) * 100).toFixed(2);
    }
    const qgEval = QG.evaluateSlot(s, { liga: match.liga });
    const baseConfidence = certifiedInputs ? 0.5 : 0.2;
    s.confidence = +(baseConfidence * qgEval.qg_confidence).toFixed(4);
    s.provenance = { ...(s.provenance ?? {}), qg: qgEval };
    const calib = getCalib(calibMap, { family: s.family, direction: s.direction, liga: match.liga });
    applyCalibrationToSlot(s, calib);
    if (s.edge_pct != null && qgGates.phantom_edge_threshold_pp != null && s.edge_pct >= qgGates.phantom_edge_threshold_pp) {
      s.provenance.phantom_edge_flag = true;
    }
    s.evidence = buildEvidence(s, { home: match.home, away: match.away, liga: match.liga });
  }

  // EV ranking + family cap
  const slotByKey = new Map(combined.map((s) => [s.market_key, s]));
  const scored = combined
    .filter((s) => s.market_odd != null && s.edge_pct != null)
    .map((s) => {
      const phantomPenalty = s.provenance?.phantom_edge_flag ? 0.3 : 1.0;
      const score = (s.edge_pct ?? 0) * (s.confidence ?? 0.5) * phantomPenalty;
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
  const sig = buildSignature();

  // 4. Export CSVs
  const predictionsRows = combined.map((s) => ({
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
  }));

  fs.writeFileSync(resolve(OUT, 'predictions.csv'), toCsv(predictionsRows, [
    'market_key','family','direction','line','period','scope',
    'fair_prob','fair_odd','market_odd','edge_pct','confidence','certified','source',
    'isotonic_applied','isotonic_p_before','isotonic_p_after',
    'calib_applied','family_cap_excluded','phantom_edge_flag',
    'weight_a','weight_b','fair_prob_a','fair_prob_b','divergence_pp',
  ]));

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
    slots_count: combined.length,
    ev_ranked_count: ev_ranked.length,
    ev_capped_out_count: ev_ranked_capped_out.length,
    engine_b: { available: bOut.available, reason: bOut.reason ?? null, version: bOut.version },
    odds_source: SYNTHETIC_ODDS ? 'synthetic_fair_x1.05_margin_5pct' : 'none',
    odds_disclaimer: SYNTHETIC_ODDS ? 'Odds são sintéticas (1/fair_prob × 1.05). NÃO refletem mercado real. edge_pct será sempre ~-4.76% por construção. Use AUDIT_SYNTHETIC_ODDS=0 para desabilitar.' : null,
    signature: sig,
    scout_summary: scout.summary,
    scout_notes: scout.notes,
    generated_at: new Date().toISOString(),
  }, null, 2));

  console.log(`[audit] wrote ${OUT}`);
  console.log(`[audit] slots=${combined.length} ev_ranked=${ev_ranked.length} capped_out=${ev_ranked_capped_out.length}`);
  console.log(`[audit] engine_b: ${bOut.available ? `OK (${bOut.slots.length} slots)` : `unavailable: ${bOut.reason}`}`);
  repo.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
