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
  console.log('Uso: node scripts/audit-extraction-coverage.mjs [--db=data/scout_extraction.db] [--write-report] [--out-dir=audit/extraction] [--json]');
}

function keyOf(row) {
  return `${row.liga}|${row.temporada}`;
}

function indexRows(rows) {
  return new Map(rows.map((row) => [keyOf(row), row]));
}

function writeReportFile(report, outDir = join('audit', 'extraction')) {
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(outDir, `coverage-${stamp}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return path;
}

export function auditExtractionCoverage(options = {}) {
  const dbPath = resolveExtractionDbPath(options.dbPath);
  if (!existsSync(dbPath)) throw new Error(`db_not_found:${dbPath}`);
  applyExtractionMigrations({ dbPath });
  const db = openExtractionDb(dbPath, { readonly: true, create: false });

  const partidas = db.prepare(`
    SELECT liga, temporada,
           COUNT(*) AS partidas,
           SUM(CASE WHEN status = 'Played' THEN 1 ELSE 0 END) AS played,
           SUM(processado_stats) AS processado_stats,
           SUM(processado_odds) AS processado_odds,
           MIN(data_partida) AS first_match,
           MAX(data_partida) AS last_match
      FROM partidas
     GROUP BY liga, temporada
  `).all();
  const times = indexRows(db.prepare('SELECT liga, temporada, COUNT(*) AS times_rows FROM times GROUP BY liga, temporada').all());
  const confronto = indexRows(db.prepare('SELECT liga, temporada, COUNT(*) AS confronto_rows FROM confronto GROUP BY liga, temporada').all());
  const eventos = indexRows(db.prepare('SELECT liga, temporada, COUNT(*) AS eventos_faixa_rows FROM eventos_faixa GROUP BY liga, temporada').all());
  const jogadores = indexRows(db.prepare('SELECT liga, temporada, COUNT(*) AS jogadores_rows FROM jogadores GROUP BY liga, temporada').all());
  const odds = indexRows(db.prepare(`
    SELECT p.liga, p.temporada,
           COUNT(o.quote_key) AS odds_rows,
           COUNT(DISTINCT o.coleta_id) AS odds_coletas,
           COUNT(DISTINCT o.id_confronto) AS odds_matches,
           SUM(CASE WHEN o.source_version = 'bookline-live-v1' THEN 1 ELSE 0 END) AS odds_live_rows,
           SUM(CASE WHEN o.mercado_key LIKE 'legacy_raw_%' THEN 1 ELSE 0 END) AS raw_market_rows
      FROM partidas p
      LEFT JOIN odds o ON o.id_confronto = p.id_confronto
     GROUP BY p.liga, p.temporada
  `).all());
  const certs = indexRows(db.prepare(`
    SELECT liga, temporada, status AS liga_status, statsline_status, bookline_status, last_certification_id, updated_at AS certification_updated_at
      FROM certificacao_liga
  `).all());

  const coverage = partidas.map((row) => {
    const key = keyOf(row);
    const merged = {
      ...row,
      times_rows: times.get(key)?.times_rows ?? 0,
      confronto_rows: confronto.get(key)?.confronto_rows ?? 0,
      eventos_faixa_rows: eventos.get(key)?.eventos_faixa_rows ?? 0,
      jogadores_rows: jogadores.get(key)?.jogadores_rows ?? 0,
      odds_rows: odds.get(key)?.odds_rows ?? 0,
      odds_coletas: odds.get(key)?.odds_coletas ?? 0,
      odds_matches: odds.get(key)?.odds_matches ?? 0,
      odds_live_rows: odds.get(key)?.odds_live_rows ?? 0,
      raw_market_rows: odds.get(key)?.raw_market_rows ?? 0,
      liga_status: certs.get(key)?.liga_status ?? 'nao_iniciada',
      statsline_status: certs.get(key)?.statsline_status ?? 'nao_avaliada',
      bookline_status: certs.get(key)?.bookline_status ?? 'nao_avaliada',
      last_certification_id: certs.get(key)?.last_certification_id ?? null,
      certification_updated_at: certs.get(key)?.certification_updated_at ?? null,
    };
    merged.stats_coverage_pct = merged.played > 0 ? Number(((merged.processado_stats / merged.played) * 100).toFixed(2)) : null;
    merged.odds_coverage_pct = merged.partidas > 0 ? Number(((merged.processado_odds / merged.partidas) * 100).toFixed(2)) : null;
    return merged;
  }).sort((a, b) => a.liga.localeCompare(b.liga) || String(a.temporada).localeCompare(String(b.temporada)));

  const totals = coverage.reduce((acc, row) => {
    for (const field of ['partidas', 'played', 'processado_stats', 'processado_odds', 'times_rows', 'confronto_rows', 'eventos_faixa_rows', 'jogadores_rows', 'odds_rows', 'odds_live_rows', 'raw_market_rows']) {
      acc[field] = (acc[field] || 0) + Number(row[field] || 0);
    }
    return acc;
  }, {});

  const report = {
    generated_at: new Date().toISOString(),
    dbPath,
    totals,
    coverage,
    verdict: {
      ligas_temporadas: coverage.length,
      all_played_stats_processed: coverage.every((row) => row.played === 0 || row.processado_stats === row.played),
      all_odds_certified: coverage.every((row) => row.bookline_status === 'aprovada' || row.odds_rows === 0),
      raw_market_rows: totals.raw_market_rows || 0,
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
  const report = auditExtractionCoverage(args);
  if (args.json || args.writeReport) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`[audit-coverage] db=${report.dbPath}`);
    console.log(`[audit-coverage] ligas_temporadas=${report.coverage.length} partidas=${report.totals.partidas} stats=${report.totals.processado_stats}/${report.totals.played} odds_live=${report.totals.odds_live_rows} raw_market_rows=${report.totals.raw_market_rows}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[audit-coverage] fatal=${err.message}`);
    process.exitCode = 1;
  });
}