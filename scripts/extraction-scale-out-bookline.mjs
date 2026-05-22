#!/usr/bin/env node
/**
 * Scale-out controlado do extractor bookline live (G7).
 *
 * Roda `extractBooklineOdds` liga por liga aplicando a regra default da
 * janela hoje + 3 dias (inclusivo) com cap rigido MAX_WINDOW_SPAN_DAYS=4.
 *
 * Por liga executa: extracao -> checkpoint WAL -> registra summary.
 * No fim grava relatorio agregado em `audit/extraction/scale-out-<ts>.json`.
 *
 * Uso:
 *   node scripts/extraction-scale-out-bookline.mjs [--ligas=premier-league,la-liga,...] [--limit=25] [--concurrency=6] [--dry-run] [--json]
 *
 * Sem --ligas usa a lista canonica das 13 ligas operacionais (todas com
 * partidas em alguma temporada ativa). Ligas sem partidas dentro da janela
 * serao marcadas como `empty_window` sem falhar.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractBooklineOdds } from '../apps/jobs/src/extract-bookline-odds.mjs';
import { checkpointExtractionDb, openExtractionDb, resolveExtractionDbPath } from './lib/extraction-db.mjs';

const DEFAULT_LIGAS = [
  'premier-league',
  'la-liga',
  'la-liga-2',
  'serie-a',
  'serie-b-italia',
  'bundesliga',
  'ligue-1',
  'primeira-liga',
  'championship',
  'brasileirao',
  'brasileirao-b',
  'liga-mx',
  'superliga-argentina',
];

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--ligas=')) out.ligas = arg.slice(8).split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith('--limit=')) out.limit = Number.parseInt(arg.slice(8), 10);
    else if (arg.startsWith('--concurrency=')) out.concurrency = Number.parseInt(arg.slice(14), 10);
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
  }
  if (!out.ligas || out.ligas.length === 0) out.ligas = DEFAULT_LIGAS;
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = 25;
  if (!Number.isFinite(out.concurrency) || out.concurrency <= 0) out.concurrency = 6;
  return out;
}

async function runOne({ liga, limit, concurrency, dbPath, dryRun }) {
  const startedAt = new Date().toISOString();
  try {
    const summary = await extractBooklineOdds({
      liga,
      limit,
      concurrency,
      dbPath,
      dryRun,
      json: true,
    });
    const status = summary.matches_checked === 0
      ? 'empty_window'
      : (summary.status ?? (summary.failed_matches > 0 ? 'partial' : 'ok'));
    return {
      liga,
      startedAt,
      finishedAt: new Date().toISOString(),
      status,
      summary,
    };
  } catch (err) {
    return {
      liga,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      error: err?.message || String(err),
    };
  }
}

export async function main() {
  const args = parseArgs();
  const dbPath = resolveExtractionDbPath(args.dbPath);
  const runId = `scale-out-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const report = {
    run_id: runId,
    started_at: new Date().toISOString(),
    db_path: dbPath,
    ligas_requested: args.ligas,
    limit_per_liga: args.limit,
    concurrency_per_liga: args.concurrency,
    dry_run: args.dryRun,
    window_rule: 'hoje + 3 dias inclusivos (default); cap MAX_WINDOW_SPAN_DAYS=4',
    results: [],
  };

  for (const liga of args.ligas) {
    process.stderr.write(`[scale-out] iniciando liga=${liga}\n`);
    const result = await runOne({ liga, limit: args.limit, concurrency: args.concurrency, dbPath, dryRun: args.dryRun });
    report.results.push(result);
    process.stderr.write(
      `[scale-out] liga=${liga} status=${result.status} matches=${result.summary?.matches_checked ?? 0} written=${result.summary?.odds_written ?? 0}\n`,
    );
  }

  // Checkpoint WAL ao fim para visibilidade externa.
  if (!args.dryRun) {
    let db;
    try {
      db = openExtractionDb(dbPath, { create: false });
      const cp = checkpointExtractionDb(db, 'TRUNCATE');
      report.checkpoint = cp;
    } catch (err) {
      report.checkpoint_error = err?.message || String(err);
    } finally {
      db?.close();
    }
  }

  report.finished_at = new Date().toISOString();
  report.totals = {
    ligas: report.results.length,
    ok: report.results.filter((r) => r.status === 'ok').length,
    partial: report.results.filter((r) => r.status === 'partial').length,
    empty_window: report.results.filter((r) => r.status === 'empty_window').length,
    failed: report.results.filter((r) => r.status === 'failed').length,
    odds_written: report.results.reduce((s, r) => s + (r.summary?.odds_written ?? 0), 0),
    history_rows_written: report.results.reduce((s, r) => s + (r.summary?.history_rows_written ?? 0), 0),
    matches_checked: report.results.reduce((s, r) => s + (r.summary?.matches_checked ?? 0), 0),
  };

  const outDir = path.resolve('audit/extraction');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `scale-out-${runId}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  report.report_path = path.relative(process.cwd(), outFile);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Scale-out concluido ===`);
    console.log(`run_id: ${runId}`);
    console.log(`ligas: ${report.totals.ligas} (ok=${report.totals.ok} empty=${report.totals.empty_window} failed=${report.totals.failed})`);
    console.log(`odds_written total: ${report.totals.odds_written}`);
    console.log(`history_rows total: ${report.totals.history_rows_written}`);
    console.log(`matches_checked total: ${report.totals.matches_checked}`);
    console.log(`relatorio: ${report.report_path}`);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('extraction-scale-out-bookline.mjs')) {
  main().catch((err) => {
    console.error('[scale-out] erro fatal:', err);
    process.exit(1);
  });
}
