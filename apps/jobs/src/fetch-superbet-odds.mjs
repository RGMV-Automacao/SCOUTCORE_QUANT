// fetch-superbet-odds — busca odds ao vivo da Superbet API e popula tabela `odds`
// de scout.db. Self-contained (usa @scoutcore/superbet-scraper, sem amarração externa).
//
// Fluxo:
//   1. SELECT partidas WHERE date(data_partida) BETWEEN ? AND ? AND processado=0
//   2. Para cada (liga, home_team, away_team, data_partida):
//      - fetchOddsRecords(home, away, liga, date) → records[]
//      - recordToPortugueseRow(rec) → { mercado, selecao, linha }
//      - INSERT OR REPLACE em `odds` (UNIQUE: fonte+home+away+mercado+selecao+linha)
//   3. Loga sumário por jogo + agregado.
//
// CLI:
//   node apps/jobs/src/fetch-superbet-odds.mjs --date=2026-05-13           (1 dia)
//   node apps/jobs/src/fetch-superbet-odds.mjs --from=2026-05-13 --to=2026-05-14
//   node apps/jobs/src/fetch-superbet-odds.mjs --liga=brasileirao --date=...
//   node apps/jobs/src/fetch-superbet-odds.mjs --dry-run                   (não escreve)
//   node apps/jobs/src/fetch-superbet-odds.mjs --limit=5                   (debug)

import 'dotenv/config';
import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import {
  fetchOddsRecords,
  recordToPortugueseRow,
  getTournamentIdsForLiga,
} from '@scoutcore/superbet-scraper';

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--date='))  out.date  = arg.slice(7);
    else if (arg.startsWith('--from='))  out.from  = arg.slice(7);
    else if (arg.startsWith('--to='))    out.to    = arg.slice(5);
    else if (arg.startsWith('--liga='))  out.liga  = arg.slice(7);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8));
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function resolveDb(envVal, name) {
  if (!envVal) throw new Error(`${name} não definido em .env`);
  const abs = isAbsolute(envVal) ? envVal : resolve(process.cwd(), envVal);
  if (!existsSync(abs)) throw new Error(`${name} não encontrado: ${abs}`);
  return abs;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Uso: node apps/jobs/src/fetch-superbet-odds.mjs [--date=YYYY-MM-DD | --from=... --to=...] [--liga=...] [--limit=N] [--dry-run]');
    return;
  }

  const dateFrom = args.from || args.date || todayISO();
  const dateTo   = args.to   || args.date || dateFrom;

  const dbPath = resolveDb(process.env.SCOUT_DB, 'SCOUT_DB');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Seleciona partidas no intervalo.
  const params = [dateFrom, dateTo];
  let sql = `
    SELECT id, liga, home_team, away_team, data_partida
    FROM partidas
    WHERE date(data_partida) BETWEEN date(?) AND date(?)
      AND home_team IS NOT NULL AND away_team IS NOT NULL
      AND home_team != '' AND away_team != ''
  `;
  if (args.liga) { sql += ' AND liga = ?'; params.push(args.liga); }
  sql += ' ORDER BY data_partida ASC';
  if (args.limit && Number.isFinite(args.limit)) sql += ` LIMIT ${Number(args.limit)}`;

  const matches = db.prepare(sql).all(...params);
  console.log(`[fetch-odds] ${matches.length} partida(s) entre ${dateFrom} e ${dateTo}${args.liga ? ` (liga=${args.liga})` : ''}`);

  if (!matches.length) { db.close(); return; }

  const insertStmt = db.prepare(`
    INSERT INTO odds (fonte, home_team, away_team, liga, data_jogo, mercado, selecao, linha, odd, criado_em)
    VALUES ('superbet', ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(fonte, home_team, away_team, mercado, selecao, linha) DO UPDATE SET
      odd = excluded.odd,
      data_jogo = excluded.data_jogo,
      liga = excluded.liga,
      criado_em = excluded.criado_em
  `);

  let totalRecords = 0;
  let totalWritten = 0;
  let totalSkipped = 0;
  let totalEvents = 0;
  let totalWarnings = 0;
  const matchSummary = [];

  for (const m of matches) {
    const date = String(m.data_partida || '').slice(0, 10);
    const tournamentIds = getTournamentIdsForLiga(m.liga);
    if (!tournamentIds.length) {
      matchSummary.push({ id: m.id, status: 'liga_sem_tournament', liga: m.liga });
      continue;
    }

    let res;
    try {
      res = await fetchOddsRecords({ home: m.home_team, away: m.away_team, liga: m.liga, date });
    } catch (err) {
      matchSummary.push({ id: m.id, status: 'fetch_falhou', err: err.message });
      continue;
    }

    totalWarnings += res.warnings.length;
    if (!res.event_id) {
      matchSummary.push({ id: m.id, status: 'evento_nao_encontrado', home: m.home_team, away: m.away_team, warnings: res.warnings });
      continue;
    }
    totalEvents += 1;

    // Denormaliza records → linhas PT e escreve.
    let written = 0;
    let skipped = 0;
    const tx = db.transaction((records) => {
      for (const rec of records) {
        totalRecords += 1;
        const row = recordToPortugueseRow(rec);
        if (!row) { skipped += 1; continue; }
        if (args.dryRun) { written += 1; continue; }
        try {
          insertStmt.run(m.home_team, m.away_team, m.liga, date, row.mercado, row.selecao, row.linha, rec.odd);
          written += 1;
        } catch (err) {
          skipped += 1;
          // Apenas loga o primeiro erro por jogo — evita ruído.
          if (skipped === 1) console.warn(`[fetch-odds] insert_falhou jogo=${m.id} ${row.mercado}/${row.selecao}: ${err.message}`);
        }
      }
    });
    tx(res.records);

    totalWritten += written;
    totalSkipped += skipped;
    matchSummary.push({
      id: m.id, status: 'ok', event_id: res.event_id, records: res.records.length,
      written, skipped, warnings: res.warnings.length,
    });
    console.log(`[fetch-odds] ${m.home_team} × ${m.away_team} (${date}) event=${res.event_id} records=${res.records.length} written=${written} skipped=${skipped}`);
  }

  db.close();

  const okMatches = matchSummary.filter((s) => s.status === 'ok').length;
  console.log(`[fetch-odds] resumo: matches=${matches.length} encontrados=${totalEvents} records=${totalRecords} escritos=${totalWritten} ignorados=${totalSkipped} warnings=${totalWarnings} dry_run=${args.dryRun}`);
  if (okMatches === 0 && matches.length > 0) {
    console.log('[fetch-odds] nenhum jogo retornou odds — verifique se os times batem com Superbet (team-aliases.json) e tournamentId.');
    for (const s of matchSummary.slice(0, 5)) console.log(JSON.stringify(s));
  }
}

run().catch((err) => {
  console.error('[fetch-odds] fatal:', err.message);
  process.exit(1);
});
