#!/usr/bin/env node
/**
 * G7 scale-out runner: roda extractBooklineOdds sequencialmente em 13 ligas
 * para uma janela configuravel. Coleta resumo por liga e grava relatorio.
 *
 * Uso:
 *   node scripts/scaleout-bookline-odds.mjs --from=2026-05-15 --to=2026-05-25 [--limit=50]
 *   node scripts/scaleout-bookline-odds.mjs --leagues=la-liga,serie-a --from=... --to=...
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractBooklineOdds } from '../apps/jobs/src/extract-bookline-odds.mjs';

const ALL_LEAGUES = [
  'premier-league',
  'la-liga',
  'serie-a',
  'bundesliga',
  'ligue-1',
  'brasileirao',
  'brasileirao-b',
  'superliga-argentina',
  'liga-mx',
  'primeira-liga',
  'championship',
  'la-liga-2',
  'serie-b-italia',
];

function parseArgs(argv) {
  const out = { from: null, to: null, limit: null, leagues: ALL_LEAGUES, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--from=')) out.from = a.slice(7);
    else if (a.startsWith('--to=')) out.to = a.slice(5);
    else if (a.startsWith('--limit=')) out.limit = Number.parseInt(a.slice(8), 10);
    else if (a.startsWith('--leagues=')) out.leagues = a.slice(10).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry-run') out.dryRun = true;
  }
  if (!out.from || !out.to) {
    console.error('Required: --from=YYYY-MM-DD --to=YYYY-MM-DD');
    process.exit(2);
  }
  return out;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  const results = [];

  console.log(`[scaleout] start at=${startedAt} window=${args.from}..${args.to} leagues=${args.leagues.length}${args.dryRun ? ' DRY-RUN' : ''}`);

  for (const liga of args.leagues) {
    const t0 = Date.now();
    console.log(`\n[scaleout] === ${liga} ===`);
    try {
      const result = await extractBooklineOdds({
        from: args.from,
        to: args.to,
        liga,
        limit: args.limit,
        dryRun: args.dryRun,
      });
      const duration_ms = Date.now() - t0;
      const summary = result || {};
      const cert = summary.certification || {};
      const row = {
        liga,
        ok: true,
        duration_ms,
        coleta_id: summary.coleta_id || null,
        matches_checked: summary.matches_checked || 0,
        events_matched: summary.events_matched || 0,
        failed_matches: summary.failed_matches || 0,
        odds_written: summary.odds_written || 0,
        raw_market_keys: summary.raw_market_keys || 0,
        missing_signature: summary.coleta_rows_missing_signature || 0,
        certification_status: cert.status || null,
        checks_passed: cert.checks_passed || 0,
        checks_failed: cert.checks_failed || 0,
        failed_checks: cert.failed_checks || [],
      };
      results.push(row);
      console.log(`[scaleout] ${liga} ok matches=${row.matches_checked} events=${row.events_matched} odds=${row.odds_written} cert=${row.certification_status} dur=${(duration_ms/1000).toFixed(1)}s`);
    } catch (err) {
      const duration_ms = Date.now() - t0;
      const row = { liga, ok: false, duration_ms, error: String(err && err.message ? err.message : err) };
      results.push(row);
      console.error(`[scaleout] ${liga} FAIL: ${row.error}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const report = {
    started_at: startedAt,
    finished_at: finishedAt,
    window: { from: args.from, to: args.to },
    leagues_requested: args.leagues,
    dry_run: args.dryRun,
    totals: {
      leagues: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      odds_written: results.reduce((s, r) => s + (r.odds_written || 0), 0),
      matches_checked: results.reduce((s, r) => s + (r.matches_checked || 0), 0),
      events_matched: results.reduce((s, r) => s + (r.events_matched || 0), 0),
      certifications_aprovada: results.filter((r) => r.certification_status === 'aprovada').length,
      certifications_parcial: results.filter((r) => r.certification_status === 'parcial').length,
      certifications_reprovada: results.filter((r) => r.certification_status === 'reprovada').length,
    },
    results,
  };

  const dir = path.resolve('audit/extraction');
  mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `scaleout-bookline-${nowStamp()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[scaleout] report=${outPath}`);
  console.log(JSON.stringify(report.totals, null, 2));
}

main().catch((e) => {
  console.error('[scaleout] fatal', e);
  process.exit(1);
});
