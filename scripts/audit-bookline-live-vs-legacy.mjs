import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyExtractionMigrations, openExtractionDb, resolveExtractionDbPath } from './lib/extraction-db.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const out = { writeReport: false };
  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--write-report') out.writeReport = true;
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg.startsWith('--out-dir=')) out.outDir = arg.slice(10);
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/audit-bookline-live-vs-legacy.mjs [--db=data/scout_extraction.db] [--write-report] [--out-dir=audit/extraction] [--json]');
}

function writeReportFile(report, outDir = join('audit', 'extraction')) {
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(outDir, `bookline-live-vs-legacy-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

export function auditBooklineLiveVsLegacy(options = {}) {
  const dbPath = resolveExtractionDbPath(options.dbPath);
  if (!existsSync(dbPath)) throw new Error(`db_not_found:${dbPath}`);
  applyExtractionMigrations({ dbPath });
  const db = openExtractionDb(dbPath, { readonly: true, create: false });

  const sourceSummary = db.prepare(`
    SELECT source_version,
           COUNT(*) AS odds_rows,
           COUNT(DISTINCT coleta_id) AS coletas,
           COUNT(DISTINCT id_confronto) AS matches,
           MIN(criado_em) AS first_seen,
           MAX(criado_em) AS last_seen,
           SUM(CASE WHEN mercado_key LIKE 'legacy_raw_%' THEN 1 ELSE 0 END) AS raw_market_rows,
           SUM(CASE WHEN quote_signature IS NULL OR quote_signature = '' THEN 1 ELSE 0 END) AS missing_signature_rows
      FROM odds
     GROUP BY source_version
     ORDER BY odds_rows DESC
  `).all();

  const liveByLiga = db.prepare(`
    SELECT liga,
           COUNT(*) AS odds_rows,
           COUNT(DISTINCT coleta_id) AS coletas,
           COUNT(DISTINCT id_confronto) AS matches,
           MIN(criado_em) AS first_seen,
           MAX(criado_em) AS last_seen,
           SUM(CASE WHEN mercado_key LIKE 'legacy_raw_%' THEN 1 ELSE 0 END) AS raw_market_rows
      FROM odds
     WHERE source_version = 'bookline-live-v1'
     GROUP BY liga
     ORDER BY odds_rows DESC, liga
  `).all();

  const recentLiveColetas = db.prepare(`
    SELECT c.coleta_id, c.liga, c.status, c.matches_checked, c.events_matched, c.odds_written,
           c.started_at, c.finished_at,
           e.status_certificacao,
           ce.status AS certification_status,
           ce.checks_total, ce.checks_failed
      FROM odds_coletas c
      LEFT JOIN extracoes_log e
        ON json_extract(c.summary_json, '$.run_id') = e.run_id
      LEFT JOIN certificacao_extracao ce
        ON ce.run_id = e.run_id AND ce.scope = 'bookline'
     WHERE c.source_version = 'bookline-live-v1'
     ORDER BY c.started_at DESC
     LIMIT 20
  `).all();

  const rawMarketSamples = db.prepare(`
    SELECT mercado, selecao, COALESCE(linha, '') AS linha, mercado_key, COUNT(*) AS rows_count
      FROM odds
     WHERE source_version = 'bookline-live-v1'
       AND mercado_key LIKE 'legacy_raw_%'
     GROUP BY mercado, selecao, linha, mercado_key
     ORDER BY rows_count DESC, mercado, selecao, linha
     LIMIT 50
  `).all();

  const comparison = db.prepare(`
    WITH live_ranked AS (
      SELECT liga, data_jogo, home_team, away_team, mercado_key, selecao, COALESCE(linha, '') AS linha, odd,
             ROW_NUMBER() OVER (
               PARTITION BY liga, data_jogo, home_team, away_team, mercado_key, selecao, COALESCE(linha, '')
               ORDER BY criado_em DESC, coleta_id DESC
             ) AS rn
        FROM odds
       WHERE source_version = 'bookline-live-v1'
         AND mercado_key NOT LIKE 'legacy_raw_%'
    ),
    legacy_ranked AS (
      SELECT liga, data_jogo, home_team, away_team, mercado_key, selecao, COALESCE(linha, '') AS linha, odd,
             ROW_NUMBER() OVER (
               PARTITION BY liga, data_jogo, home_team, away_team, mercado_key, selecao, COALESCE(linha, '')
               ORDER BY criado_em DESC, coleta_id DESC
             ) AS rn
        FROM odds
       WHERE source_version = 'legacy-bookline-import-v1'
         AND mercado_key NOT LIKE 'legacy_raw_%'
    ),
    live AS (SELECT * FROM live_ranked WHERE rn = 1),
    legacy AS (SELECT * FROM legacy_ranked WHERE rn = 1),
    joined AS (
      SELECT l.odd AS live_odd, g.odd AS legacy_odd, ABS(l.odd - g.odd) AS abs_diff
        FROM live l
        JOIN legacy g
          ON g.liga = l.liga
         AND g.data_jogo = l.data_jogo
         AND g.home_team = l.home_team
         AND g.away_team = l.away_team
         AND g.mercado_key = l.mercado_key
         AND g.selecao = l.selecao
         AND g.linha = l.linha
    )
    SELECT COUNT(*) AS overlap_rows,
           SUM(CASE WHEN abs_diff <= 0.000001 THEN 1 ELSE 0 END) AS exact_odd_rows,
           SUM(CASE WHEN abs_diff > 0.000001 THEN 1 ELSE 0 END) AS changed_odd_rows,
           ROUND(MAX(abs_diff), 6) AS max_abs_diff,
           ROUND(AVG(abs_diff), 6) AS avg_abs_diff
      FROM joined
  `).get();

  const report = {
    generated_at: new Date().toISOString(),
    dbPath,
    sourceSummary,
    liveByLiga,
    recentLiveColetas,
    comparison,
    rawMarketSamples,
    verdict: {
      live_present: liveByLiga.some((row) => row.odds_rows > 0),
      raw_markets_zero: rawMarketSamples.length === 0,
      overlap_present: Number(comparison.overlap_rows || 0) > 0,
    },
  };

  db.close();
  if (options.writeReport) report.report_path = writeReportFile(report, options.outDir);
  return report;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  const report = auditBooklineLiveVsLegacy(args);
  if (args.json || args.writeReport) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[audit-bookline-live] db=${report.dbPath}`);
    console.log(`[audit-bookline-live] live_ligas=${report.liveByLiga.length} overlap=${report.comparison.overlap_rows} changed=${report.comparison.changed_odd_rows} raw_samples=${report.rawMarketSamples.length}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[audit-bookline-live] fatal=${err.message}`);
    process.exitCode = 1;
  });
}