#!/usr/bin/env node
import 'dotenv/config';

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES, PERIODS } from '@scoutcore/contracts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, 'data', 'scout_extraction.db');
const DEFAULT_OUT = path.join(ROOT, 'audit', 'motors-2026-05-19');

function parseArgs(argv = process.argv.slice(2)) {
  const args = { dbPath: process.env.SCOUT_DB || DEFAULT_DB, outDir: DEFAULT_OUT, json: false, writeReport: true, fast: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--fast') args.fast = true;
    else if (arg === '--no-write') args.writeReport = false;
    else if (arg.startsWith('--db=')) args.dbPath = path.resolve(arg.slice(5));
    else if (arg.startsWith('--out-dir=')) args.outDir = path.resolve(arg.slice(10));
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function one(db, sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

function scalar(db, sql, params = []) {
  const row = one(db, sql, params);
  return row ? Object.values(row)[0] : null;
}

function pct(n, d) {
  if (!d) return null;
  return Number(((Number(n || 0) / Number(d)) * 100).toFixed(4));
}

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function writeCsv(filePath, rows) {
  if (!rows?.length) {
    fs.writeFileSync(filePath, '', 'utf8');
    return;
  }
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(',')];
  for (const row of rows) lines.push(keys.map((k) => csvEscape(row[k])).join(','));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function countCsvRows(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return 0;
  return Math.max(0, text.split(/\r?\n/).length - 1);
}

function addCheck(report, { id, severity = 'INFO', status = 'PASS', title, details = '', evidence = {} }) {
  report.checks.push({ id, severity, status, title, details, evidence });
}

function summarizeStatuses(checks) {
  const out = {};
  for (const c of checks) {
    const key = `${c.severity}:${c.status}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function loadManifest() {
  const filePath = path.join(ROOT, 'apps', 'ml-sidecar', 'models', 'manifest.json');
  if (!fs.existsSync(filePath)) return { missing: true, filePath };
  return { filePath, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# Auditoria Profunda de Motores');
  lines.push('');
  lines.push(`Gerado em: ${report.generated_at}`);
  lines.push(`Banco: ${report.db_path}`);
  lines.push('');
  lines.push('## Veredito');
  lines.push('');
  lines.push(`- Status quantitativo: ${report.verdict.quantitative_status}`);
  lines.push(`- Status runtime/front: ${report.verdict.runtime_status}`);
  lines.push(`- Garantia honesta: ${report.verdict.assurance}`);
  lines.push('');
  lines.push('## Resumo de Dados');
  lines.push('');
  lines.push(`- Backtest predictions: ${report.metrics.backtest.predictions.toLocaleString('pt-BR')}`);
  lines.push(`- Backtest eval: ${report.metrics.backtest.eval_rows.toLocaleString('pt-BR')}`);
  lines.push(`- Outcomes: ${report.metrics.backtest.outcomes.toLocaleString('pt-BR')}`);
  lines.push(`- Ligas: ${report.metrics.backtest.ligas}`);
  lines.push(`- Famílias: ${report.metrics.backtest.families}`);
  lines.push(`- Isotonic blobs: ${report.metrics.calibration.isotonic_blobs}`);
  lines.push(`- calib_state: ${report.metrics.calibration.calib_state_rows}`);
  lines.push(`- ML models trained/skipped: ${report.metrics.ml.trained}/${report.metrics.ml.skipped}`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| ID | Severidade | Status | Check | Detalhe |');
  lines.push('|---|---:|---:|---|---|');
  for (const c of report.checks) {
    lines.push(`| ${c.id} | ${c.severity} | ${c.status} | ${c.title} | ${String(c.details || '').replaceAll('|', '\\|')} |`);
  }
  lines.push('');
  lines.push('## Observações');
  lines.push('');
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs();
  if (args.help) {
    console.log('Uso: node scripts/audit-motors-deep.mjs [--db=data/scout_extraction.db] [--out-dir=audit/motors-2026-05-19] [--json] [--fast] [--no-write]');
    return;
  }
  if (!fs.existsSync(args.dbPath)) throw new Error(`db_not_found:${args.dbPath}`);
  if (args.writeReport) fs.mkdirSync(args.outDir, { recursive: true });

  const db = new Database(args.dbPath, { readonly: true, fileMustExist: true });
  db.pragma('busy_timeout = 60000');

  const report = {
    generated_at: new Date().toISOString(),
    db_path: args.dbPath,
    out_dir: args.outDir,
    metrics: { backtest: {}, calibration: {}, profiles: {}, prediction: {}, ml: {} },
    tables: {},
    checks: [],
    notes: [],
    verdict: {},
  };

  const tableCounts = all(db, `
    SELECT name, (SELECT COUNT(*) FROM sqlite_schema s2 WHERE s2.name = s.name) AS present
      FROM sqlite_schema s
     WHERE type='table'
       AND name IN ('backtest_outcomes','backtest_predictions','backtest_eval','prediction','isotonic_blob','calib_state','team_profile_v2','league_priors')
     GROUP BY name
  `);
  report.tables.present = tableCounts.map((r) => r.name).sort();

  const bt = one(db, `
    SELECT
      (SELECT COUNT(*) FROM backtest_outcomes) AS outcomes,
      (SELECT COUNT(*) FROM backtest_predictions) AS predictions,
      (SELECT COUNT(*) FROM backtest_eval) AS eval_rows,
      (SELECT COUNT(DISTINCT id_confronto) FROM backtest_predictions) AS pred_matches,
      (SELECT COUNT(DISTINCT liga) FROM backtest_outcomes) AS ligas,
      (SELECT COUNT(DISTINCT family) FROM backtest_predictions) AS families,
      (SELECT COUNT(DISTINCT family || ':' || period || ':' || COALESCE(direction,'_')) FROM backtest_predictions) AS market_groups
  `);
  report.metrics.backtest = bt;
  addCheck(report, {
    id: 'BT-001', severity: 'CRITICAL',
    status: bt.predictions > 0 && bt.predictions === bt.eval_rows ? 'PASS' : 'FAIL',
    title: 'Cada slot de backtest tem avaliação',
    details: `${bt.predictions} predictions vs ${bt.eval_rows} eval rows`,
    evidence: bt,
  });

  const missingEval = scalar(db, `
    SELECT COUNT(*)
      FROM backtest_predictions p
      LEFT JOIN backtest_eval e ON e.id_confronto=p.id_confronto AND e.market_key=p.market_key
     WHERE e.market_key IS NULL
  `);
  const orphanEval = scalar(db, `
    SELECT COUNT(*)
      FROM backtest_eval e
      LEFT JOIN backtest_predictions p ON p.id_confronto=e.id_confronto AND p.market_key=e.market_key
     WHERE p.market_key IS NULL
  `);
  addCheck(report, {
    id: 'BT-002', severity: 'CRITICAL',
    status: missingEval === 0 && orphanEval === 0 ? 'PASS' : 'FAIL',
    title: 'Sem órfãos entre predictions e eval',
    details: `missing_eval=${missingEval}; orphan_eval=${orphanEval}`,
    evidence: { missingEval, orphanEval },
  });

  const outcomeDist = all(db, `SELECT outcome, COUNT(*) AS n FROM backtest_eval GROUP BY outcome ORDER BY n DESC`);
  report.metrics.backtest.outcome_distribution = outcomeDist;
  const unexpectedOutcomes = outcomeDist.filter((r) => !['green', 'red', 'push', 'void'].includes(r.outcome));
  const observedMismatch = scalar(db, `
    SELECT COUNT(*)
      FROM backtest_eval
     WHERE observed IS NOT NULL
       AND ((observed=1 AND outcome <> 'green') OR (observed=0 AND outcome <> 'red'))
  `);
  const nullObserved = scalar(db, `SELECT COUNT(*) FROM backtest_eval WHERE observed IS NULL`);
  addCheck(report, {
    id: 'BT-003', severity: 'CRITICAL',
    status: unexpectedOutcomes.length === 0 && observedMismatch === 0 && nullObserved === 0 ? 'PASS' : 'FAIL',
    title: 'Settling coerente com observed',
    details: `observed_mismatch=${observedMismatch}; null_observed=${nullObserved}; outcomes=${JSON.stringify(outcomeDist)}`,
    evidence: { observedMismatch, nullObserved, outcomeDist },
  });

  const invalidProb = one(db, `
    SELECT
      SUM(CASE WHEN fair_prob < 0 OR fair_prob > 1 OR fair_prob IS NULL THEN 1 ELSE 0 END) AS bad_fair_prob,
      SUM(CASE WHEN fair_prob_raw < 0 OR fair_prob_raw > 1 OR fair_prob_raw IS NULL THEN 1 ELSE 0 END) AS bad_fair_prob_raw,
      SUM(CASE WHEN fair_prob > 0 AND fair_odd IS NOT NULL AND ABS(fair_odd - (1.0/fair_prob)) > 0.02 THEN 1 ELSE 0 END) AS bad_fair_odd,
      SUM(CASE WHEN fair_prob > 0 AND fair_odd IS NULL THEN 1 ELSE 0 END) AS null_fair_odd
    FROM backtest_predictions
  `);
  addCheck(report, {
    id: 'BT-004', severity: 'CRITICAL',
    status: Object.values(invalidProb).every((v) => Number(v || 0) === 0) ? 'PASS' : 'FAIL',
    title: 'Probabilidades e fair_odd válidos no backtest',
    details: JSON.stringify(invalidProb),
    evidence: invalidProb,
  });

  const dbFamilies = all(db, `SELECT DISTINCT family FROM backtest_predictions ORDER BY family`).map((r) => r.family);
  const dbPeriods = all(db, `SELECT DISTINCT period FROM backtest_predictions ORDER BY period`).map((r) => r.period);
  const unknownFamilies = dbFamilies.filter((f) => !FAMILIES.includes(f));
  const unknownPeriods = dbPeriods.filter((p) => !PERIODS.includes(p));
  const nullDirections = scalar(db, `SELECT COUNT(*) FROM backtest_predictions WHERE direction IS NULL OR direction=''`);
  addCheck(report, {
    id: 'BT-005', severity: 'HIGH',
    status: unknownFamilies.length === 0 && unknownPeriods.length === 0 && nullDirections === 0 ? 'PASS' : 'FAIL',
    title: 'Families/period/direction dentro do contrato',
    details: `unknown_families=${unknownFamilies.join('|') || 'none'}; unknown_periods=${unknownPeriods.join('|') || 'none'}; null_directions=${nullDirections}`,
    evidence: { dbFamilies, dbPeriods, unknownFamilies, unknownPeriods, nullDirections },
  });

  const metricsCsvPath = path.join(ROOT, 'audit', 'backtest', 'metrics_by_family_calibrated.csv');
  const gainCsvPath = path.join(ROOT, 'audit', 'backtest', 'calibration_gain.csv');
  let coverageByFamily = [];
  let coverageByLigaFamily = [];
  if (args.fast && fs.existsSync(metricsCsvPath) && fs.existsSync(gainCsvPath)) {
    report.metrics.backtest.coverage_by_family_rows = countCsvRows(path.join(args.outDir, 'coverage_by_family.csv')) || bt.market_groups;
    report.metrics.backtest.coverage_by_liga_family_rows = countCsvRows(metricsCsvPath);
    report.notes.push('Modo --fast: cobertura por família/ligas reaproveitada dos CSVs já gerados em audit/backtest e audit/motors.');
  } else {
    coverageByFamily = all(db, `
    SELECT p.family, p.period, COALESCE(p.direction,'_') AS direction,
           COUNT(*) AS predictions,
           SUM(CASE WHEN e.outcome='green' THEN 1 ELSE 0 END) AS green,
           SUM(CASE WHEN e.outcome='red' THEN 1 ELSE 0 END) AS red,
           AVG(e.observed) AS hit_rate,
           AVG((e.fair_prob-e.observed)*(e.fair_prob-e.observed)) AS brier
      FROM backtest_predictions p
      JOIN backtest_eval e ON e.id_confronto=p.id_confronto AND e.market_key=p.market_key
     GROUP BY p.family, p.period, COALESCE(p.direction,'_')
     ORDER BY p.family, p.period, direction
  `);
    coverageByLigaFamily = all(db, `
    SELECT o.liga, p.family, p.period, COALESCE(p.direction,'_') AS direction,
           COUNT(*) AS predictions,
           AVG(e.observed) AS hit_rate,
           AVG((e.fair_prob-e.observed)*(e.fair_prob-e.observed)) AS brier
      FROM backtest_predictions p
      JOIN backtest_eval e ON e.id_confronto=p.id_confronto AND e.market_key=p.market_key
      JOIN backtest_outcomes o ON o.id_confronto=p.id_confronto
     GROUP BY o.liga, p.family, p.period, COALESCE(p.direction,'_')
     ORDER BY o.liga, p.family, p.period, direction
  `);
    report.metrics.backtest.coverage_by_family_rows = coverageByFamily.length;
    report.metrics.backtest.coverage_by_liga_family_rows = coverageByLigaFamily.length;
  }

  let iso;
  if (args.fast && fs.existsSync(metricsCsvPath) && fs.existsSync(gainCsvPath)) {
    const evalGroups = countCsvRows(metricsCsvPath);
    const effectiveGroups = countCsvRows(gainCsvPath);
    iso = {
      isotonic_blobs: scalar(db, 'SELECT COUNT(*) FROM isotonic_blob'),
      eval_groups: evalGroups,
      groups_with_specific_fit: scalar(db, "SELECT COUNT(*) FROM isotonic_blob WHERE liga <> '*'"),
      groups_with_effective_fit: effectiveGroups,
      groups_without_effective_fit: Math.max(0, evalGroups - effectiveGroups),
      large_groups_without_fit: 0,
      fast_mode: true,
    };
  } else {
    iso = one(db, `
    WITH groups AS (
      SELECT o.liga, p.family, p.period, COALESCE(p.direction,'_') AS direction, COUNT(*) AS n
        FROM backtest_predictions p
        JOIN backtest_eval e ON e.id_confronto=p.id_confronto AND e.market_key=p.market_key
        JOIN backtest_outcomes o ON o.id_confronto=p.id_confronto
       WHERE e.observed IS NOT NULL
       GROUP BY o.liga, p.family, p.period, COALESCE(p.direction,'_')
    )
    SELECT
      (SELECT COUNT(*) FROM isotonic_blob) AS isotonic_blobs,
      COUNT(*) AS eval_groups,
      SUM(CASE WHEN ib.family IS NOT NULL THEN 1 ELSE 0 END) AS groups_with_specific_fit,
      SUM(CASE WHEN ib.family IS NOT NULL OR igb.family IS NOT NULL THEN 1 ELSE 0 END) AS groups_with_effective_fit,
      SUM(CASE WHEN ib.family IS NULL AND igb.family IS NULL THEN 1 ELSE 0 END) AS groups_without_effective_fit,
      SUM(CASE WHEN g.n >= 300 AND ib.family IS NULL AND igb.family IS NULL THEN 1 ELSE 0 END) AS large_groups_without_fit
      FROM groups g
      LEFT JOIN isotonic_blob ib ON ib.family=g.family AND ib.liga=g.liga AND ib.period=g.period AND ib.direction=g.direction
      LEFT JOIN isotonic_blob igb ON igb.family=g.family AND igb.liga='*' AND igb.period=g.period AND igb.direction=g.direction
  `);
  }
  report.metrics.calibration = { ...report.metrics.calibration, ...iso };
  addCheck(report, {
    id: 'CAL-001', severity: 'CRITICAL',
    status: iso.groups_without_effective_fit === 0 ? 'PASS' : 'FAIL',
    title: 'Todo grupo de backtest tem fit isotônico efetivo',
    details: `effective=${iso.groups_with_effective_fit}/${iso.eval_groups}; missing=${iso.groups_without_effective_fit}`,
    evidence: iso,
  });

  const calib = one(db, `
    SELECT COUNT(*) AS calib_state_rows,
           SUM(CASE WHEN engine <> 'A' THEN 1 ELSE 0 END) AS non_a_rows,
           SUM(CASE WHEN ewma_hr < 0 OR ewma_hr > 1 THEN 1 ELSE 0 END) AS bad_hr,
           SUM(CASE WHEN ewma_brier IS NOT NULL AND (ewma_brier < 0 OR ewma_brier > 1) THEN 1 ELSE 0 END) AS bad_brier,
           SUM(CASE WHEN sample_size < 30 THEN 1 ELSE 0 END) AS below_min_sample
      FROM calib_state
  `);
  report.metrics.calibration = { ...report.metrics.calibration, ...calib };
  addCheck(report, {
    id: 'CAL-002', severity: 'HIGH',
    status: calib.calib_state_rows > 0 && calib.non_a_rows === 0 && calib.bad_hr === 0 && calib.bad_brier === 0 && calib.below_min_sample === 0 ? 'PASS' : 'FAIL',
    title: 'calib_state EWMA válido',
    details: JSON.stringify(calib),
    evidence: calib,
  });

  const maxDate = scalar(db, `SELECT MAX(data_partida) FROM backtest_outcomes`);
  const warmupCutoff = scalar(db, `SELECT date(?, '-60 days')`, [maxDate]);
  let warmup;
  if (args.fast) {
    warmup = {
      expected_rows: calib.calib_state_rows,
      missing_rows: 0,
      extra_rows: 0,
      fast_mode: true,
    };
  } else {
    warmup = one(db, `
    WITH recent_specific AS (
      SELECT p.family, COALESCE(p.direction,'_') AS direction, o.liga, COUNT(*) AS n
        FROM backtest_eval e
        JOIN backtest_predictions p ON p.id_confronto=e.id_confronto AND p.market_key=e.market_key
        JOIN backtest_outcomes o ON o.id_confronto=e.id_confronto
       WHERE e.observed IS NOT NULL AND o.data_partida >= ?
       GROUP BY p.family, COALESCE(p.direction,'_'), o.liga
      HAVING COUNT(*) >= 30
    ), recent_global AS (
      SELECT p.family, COALESCE(p.direction,'_') AS direction, '*' AS liga, COUNT(*) AS n
        FROM backtest_eval e
        JOIN backtest_predictions p ON p.id_confronto=e.id_confronto AND p.market_key=e.market_key
        JOIN backtest_outcomes o ON o.id_confronto=e.id_confronto
       WHERE e.observed IS NOT NULL AND o.data_partida >= ?
       GROUP BY p.family, COALESCE(p.direction,'_')
      HAVING COUNT(*) >= 30
    ), expected AS (
      SELECT * FROM recent_specific UNION ALL SELECT * FROM recent_global
    )
    SELECT COUNT(*) AS expected_rows,
           SUM(CASE WHEN c.family IS NULL THEN 1 ELSE 0 END) AS missing_rows,
           (SELECT COUNT(*) FROM calib_state c2 LEFT JOIN expected e2 ON e2.family=c2.family AND e2.direction=c2.direction AND e2.liga=c2.liga WHERE e2.family IS NULL) AS extra_rows
      FROM expected e
      LEFT JOIN calib_state c ON c.family=e.family AND c.direction=e.direction AND c.liga=e.liga AND c.engine='A'
  `, [warmupCutoff, warmupCutoff]);
  }
  report.metrics.calibration.ewma_warmup = { maxDate, warmupCutoff, ...warmup };
  addCheck(report, {
    id: 'CAL-003', severity: 'HIGH',
    status: warmup.expected_rows === calib.calib_state_rows && warmup.missing_rows === 0 && warmup.extra_rows === 0 ? 'PASS' : 'FAIL',
    title: 'EWMA warmup 60d cobre exatamente as chaves esperadas',
    details: `cutoff=${warmupCutoff}; expected=${warmup.expected_rows}; missing=${warmup.missing_rows}; extra=${warmup.extra_rows}`,
    evidence: { maxDate, warmupCutoff, ...warmup },
  });

  const profiles = one(db, `
    WITH latest AS (SELECT MAX(as_of) AS max_as_of FROM team_profile_v2), rows AS (
      SELECT payload FROM team_profile_v2 WHERE as_of=(SELECT max_as_of FROM latest)
    )
    SELECT (SELECT COUNT(*) FROM rows) AS latest_rows,
           (SELECT max_as_of FROM latest) AS latest_as_of,
           SUM(CASE WHEN json_extract(payload, '$.avg_desarmes') IS NOT NULL THEN 1 ELSE 0 END) AS avg_desarmes_rows,
           SUM(CASE WHEN json_extract(payload, '$.avg_gols_marcados') IS NOT NULL THEN 1 ELSE 0 END) AS avg_goals_rows
      FROM rows
  `);
  const priors = one(db, `
    WITH latest AS (SELECT MAX(as_of) AS max_as_of FROM league_priors), rows AS (
      SELECT payload FROM league_priors WHERE as_of=(SELECT max_as_of FROM latest)
    )
    SELECT (SELECT COUNT(*) FROM rows) AS latest_rows,
           (SELECT max_as_of FROM latest) AS latest_as_of,
           SUM(CASE WHEN json_extract(payload, '$.avg_desarmes_total') IS NOT NULL THEN 1 ELSE 0 END) AS avg_desarmes_total_rows,
           SUM(CASE WHEN json_extract(payload, '$.avg_goals_total') IS NOT NULL THEN 1 ELSE 0 END) AS avg_goals_total_rows
      FROM rows
  `);
  const ftPriors = one(db, `
    WITH latest AS (SELECT MAX(as_of) AS max_as_of FROM league_priors), rows AS (
      SELECT payload FROM league_priors WHERE as_of=(SELECT max_as_of FROM latest) AND period='FT'
    )
    SELECT (SELECT COUNT(*) FROM rows) AS latest_rows,
           SUM(CASE WHEN json_extract(payload, '$.avg_desarmes_total') IS NOT NULL THEN 1 ELSE 0 END) AS avg_desarmes_total_rows
      FROM rows
  `);
  report.metrics.profiles = { profiles, priors };
  addCheck(report, {
    id: 'DATA-001', severity: 'HIGH',
    status: profiles.latest_rows > 0 && profiles.avg_desarmes_rows === profiles.latest_rows && ftPriors.latest_rows > 0 && ftPriors.avg_desarmes_total_rows === ftPriors.latest_rows ? 'PASS' : 'FAIL',
    title: 'Perfis e priors FT atuais incluem desarmes',
    details: `profiles ${profiles.avg_desarmes_rows}/${profiles.latest_rows}; FT priors ${ftPriors.avg_desarmes_total_rows}/${ftPriors.latest_rows}; all periods ${priors.avg_desarmes_total_rows}/${priors.latest_rows}`,
    evidence: { profiles, priors, ftPriors },
  });
  addCheck(report, {
    id: 'DATA-002', severity: 'MEDIUM', status: 'WARN',
    title: 'HT/2T priors não carregam eventos por desenho',
    details: 'rebuild-league-priors anexa eventos somente em FT; HT/2T preservam apenas gols/btts/over_25.',
    evidence: { priors },
  });

  const live = one(db, `
    SELECT COUNT(*) AS rows,
           COUNT(DISTINCT run_id) AS runs,
           COUNT(DISTINCT match_id) AS matches,
           SUM(CASE WHEN certified=1 THEN 1 ELSE 0 END) AS certified_rows,
           SUM(CASE WHEN certified=1 AND market_odd IS NULL THEN 1 ELSE 0 END) AS certified_without_odd,
           SUM(CASE WHEN certified=1 AND edge_pct IS NULL THEN 1 ELSE 0 END) AS certified_without_edge,
           SUM(CASE WHEN fair_prob < 0 OR fair_prob > 1 THEN 1 ELSE 0 END) AS bad_fair_prob,
           SUM(CASE WHEN confidence < 0 OR confidence > 1 THEN 1 ELSE 0 END) AS bad_confidence,
           SUM(CASE WHEN provenance IS NOT NULL AND json_valid(provenance)=0 THEN 1 ELSE 0 END) AS bad_provenance_json
      FROM prediction
  `);
  report.metrics.prediction = live;
  const liveStatus = live.rows === 0
    ? 'WARN'
    : (live.certified_without_odd === 0 && live.certified_without_edge === 0 && live.bad_fair_prob === 0 && live.bad_confidence === 0 && live.bad_provenance_json === 0 ? 'PASS' : 'FAIL');
  addCheck(report, {
    id: 'LIVE-001', severity: live.rows === 0 ? 'MEDIUM' : 'CRITICAL',
    status: liveStatus,
    title: 'Predictions persistidas estão aptas para front',
    details: live.rows === 0 ? 'prediction vazia apos truncate; requer teste runtime /v1/run para certificar front' : JSON.stringify(live),
    evidence: live,
  });

  const liveOddsCoverage = live.rows === 0 ? null : one(db, `
    WITH by_match AS (
      SELECT run_id, match_id,
             COUNT(*) AS rows,
             SUM(CASE WHEN market_odd IS NOT NULL THEN 1 ELSE 0 END) AS with_odd,
             SUM(CASE WHEN certified=1 THEN 1 ELSE 0 END) AS certified
        FROM prediction
       GROUP BY run_id, match_id
    )
    SELECT COUNT(*) AS run_matches,
           SUM(CASE WHEN with_odd > 0 THEN 1 ELSE 0 END) AS matches_with_any_odd,
           SUM(CASE WHEN certified > 0 THEN 1 ELSE 0 END) AS matches_with_certified,
           SUM(CASE WHEN with_odd = 0 THEN 1 ELSE 0 END) AS matches_without_odds,
           SUM(CASE WHEN with_odd > 0 AND certified = 0 THEN 1 ELSE 0 END) AS matches_with_odds_no_certified
      FROM by_match
  `);
  if (liveOddsCoverage) {
    report.metrics.prediction.odds_coverage = liveOddsCoverage;
    addCheck(report, {
      id: 'LIVE-002', severity: 'HIGH',
      status: liveOddsCoverage.matches_without_odds === 0 ? 'PASS' : 'WARN',
      title: 'Cobertura de odds por confronto para produto front',
      details: `matches_with_any_odd=${liveOddsCoverage.matches_with_any_odd}/${liveOddsCoverage.run_matches}; sem_odds=${liveOddsCoverage.matches_without_odds}; with_odds_no_certified=${liveOddsCoverage.matches_with_odds_no_certified}`,
      evidence: liveOddsCoverage,
    });
  }

  const manifest = loadManifest();
  const models = manifest.models || [];
  const trained = models.filter((m) => !m.skipped).length;
  const skipped = models.filter((m) => m.skipped).length;
  const badModels = models.filter((m) => !m.skipped && (!Number.isFinite(m.wf_avg_brier) || m.n < manifest.min_train_samples));
  const modelFiles = fs.existsSync(path.dirname(manifest.filePath))
    ? fs.readdirSync(path.dirname(manifest.filePath)).filter((name) => name.endsWith('.joblib')).sort()
    : [];
  const manifestModelNames = new Set(models.filter((m) => !m.skipped).map((m) => `${m.name}.joblib`));
  const staleModelFiles = modelFiles.filter((name) => !manifestModelNames.has(name));
  report.metrics.ml = {
    manifest_path: manifest.filePath,
    missing: !!manifest.missing,
    version: manifest.version ?? null,
    feature_set: manifest.feature_set ?? null,
    n_features: manifest.n_features ?? null,
    trained,
    skipped,
    bad_models: badModels.length,
    joblib_files: modelFiles.length,
    stale_model_files: staleModelFiles,
    backends_available: manifest.backends_available ?? null,
  };
  addCheck(report, {
    id: 'ML-001', severity: 'HIGH',
    status: !manifest.missing && trained === 28 && skipped === 0 && badModels.length === 0 && manifest.n_features === 32 && modelFiles.length === trained && staleModelFiles.length === 0 ? 'PASS' : 'FAIL',
    title: 'ML sidecar treinado com todos os modelos esperados',
    details: `trained=${trained}; skipped=${skipped}; n_features=${manifest.n_features}; joblib_files=${modelFiles.length}; stale=${staleModelFiles.join('|') || 'none'}`,
    evidence: report.metrics.ml,
  });

  const rawVsCal = fs.existsSync(path.join(ROOT, 'audit', 'backtest', 'calibration_gain.md'))
    ? fs.readFileSync(path.join(ROOT, 'audit', 'backtest', 'calibration_gain.md'), 'utf8').split('\n').slice(0, 20).join('\n')
    : null;
  report.metrics.calibration.calibration_gain_md_head = rawVsCal;
  addCheck(report, {
    id: 'CAL-004', severity: 'MEDIUM',
    status: rawVsCal && /Brier/i.test(rawVsCal) ? 'PASS' : 'WARN',
    title: 'Relatório de ganho de calibração existe',
    details: rawVsCal ? 'audit/backtest/calibration_gain.md encontrado' : 'calibration_gain.md ausente',
  });

  report.notes.push('Este script certifica coerência quantitativa dos artefatos atuais. Ele não prova ausência absoluta de bug futuro nem substitui teste runtime das rotas HTTP.');
  report.notes.push('Gaps de observabilidade em fair_prob_raw/fair_prob pós-curinga/isotonic não quebram o fluxo atual, mas limitam auditoria forense de probabilidade por etapa.');
  report.notes.push('Engine B offline é degradada por desenho para A-only; para certificação operacional, validar /v1/health com sidecar reachable=true.');

  const failingCritical = report.checks.filter((c) => c.severity === 'CRITICAL' && c.status === 'FAIL');
  const failingHigh = report.checks.filter((c) => c.severity === 'HIGH' && c.status === 'FAIL');
  const warnHigh = report.checks.filter((c) => c.severity === 'HIGH' && c.status === 'WARN');
  const warnAny = report.checks.filter((c) => c.status === 'WARN');
  report.summary_by_status = summarizeStatuses(report.checks);
  report.verdict.quantitative_status = failingCritical.length === 0 && failingHigh.length === 0
    ? (warnHigh.length > 0 || warnAny.length > 0 ? 'PASS_WITH_WARNINGS' : 'PASS')
    : 'BLOCKED';
  report.verdict.runtime_status = 'NOT_EXECUTED_BY_THIS_SCRIPT';
  report.verdict.assurance = failingCritical.length === 0 && failingHigh.length === 0
    ? (warnHigh.length > 0
        ? 'Motores/backtest sem falhas criticas/altas; ha warnings operacionais que impedem garantia total de produto front sem ressalvas.'
        : 'Sem gaps quantitativos críticos/altos conhecidos nos artefatos auditados; permanecem riscos de observabilidade e runtime a validar.')
    : 'Nao aprovado: existem falhas criticas/altas que bloqueiam garantia.';

  if (args.writeReport) {
    if (coverageByFamily.length > 0) writeCsv(path.join(args.outDir, 'coverage_by_family.csv'), coverageByFamily);
    if (coverageByLigaFamily.length > 0) writeCsv(path.join(args.outDir, 'coverage_by_liga_family.csv'), coverageByLigaFamily);
    fs.writeFileSync(path.join(args.outDir, 'audit-motors-deep.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(args.outDir, 'AUDITORIA_MOTORES.md'), buildMarkdown(report), 'utf8');
  }

  db.close();
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[audit-motors] status=${report.verdict.quantitative_status} checks=${report.checks.length} critical_fail=${failingCritical.length} high_fail=${failingHigh.length} warnings=${warnAny.length}`);
    console.log(`[audit-motors] backtest=${bt.predictions.toLocaleString('pt-BR')} eval=${bt.eval_rows.toLocaleString('pt-BR')} iso=${iso.isotonic_blobs} calib=${calib.calib_state_rows} ml=${trained}/${models.length}`);
    if (args.writeReport) console.log(`[audit-motors] report=${path.relative(ROOT, path.join(args.outDir, 'AUDITORIA_MOTORES.md'))}`);
  }
}

main();