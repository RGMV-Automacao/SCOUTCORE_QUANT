import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import {
  applyExtractionMigrations,
  checkpointExtractionDb,
  openExtractionDb,
  resolveExtractionDbPath,
} from './lib/extraction-db.mjs';
import {
  buildQuoteSignature,
  inferMarketKey,
  normalizeLegacyLiga,
} from './migrate-legacy-bookline-odds.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/backfill-bookline-live-metadata.mjs [--db=data/scout_extraction.db] [--dry-run] [--json]');
}

function parsePayload(payloadRaw) {
  try {
    return JSON.parse(payloadRaw || '{}');
  } catch {
    return {};
  }
}

function rowToMapperInput(row) {
  const payload = parsePayload(row.payload_raw);
  return {
    id_confronto: row.id_confronto,
    fixture_id: row.source_event_id,
    coleta_id: row.coleta_id,
    liga: row.liga,
    home_team: row.home_team,
    away_team: row.away_team,
    data_jogo: row.data_jogo,
    mercado: row.mercado,
    selecao: row.selecao,
    linha: row.linha,
    team_tab: payload.team_tab ?? payload.record?.team_tab ?? null,
  };
}

export function backfillBooklineLiveMetadata(options = {}) {
  const dbPath = resolveExtractionDbPath(options.dbPath);
  applyExtractionMigrations({ dbPath });
  const db = openExtractionDb(dbPath);

  const rows = db.prepare(`
    SELECT quote_key, snapshot_id, quote_signature, id_confronto, source_event_id, liga,
           home_team, away_team, data_jogo, mercado_key, mercado, selecao, linha, odd,
           coleta_id, payload_raw, criado_em
      FROM odds
     WHERE source_version = 'bookline-live-v1'
     ORDER BY criado_em ASC, coleta_id ASC, quote_key ASC
  `).all();

  const summary = {
    dbPath,
    dry_run: options.dryRun === true,
    scanned_rows: rows.length,
    metadata_updates: 0,
    raw_before: 0,
    raw_after: 0,
    signature_missing_before: 0,
    history_rows_written: 0,
    history_changed_rows: 0,
    checkpoint: null,
  };

  const prepared = rows.map((row) => {
    const mapperInput = rowToMapperInput(row);
    const liga = normalizeLegacyLiga(row.liga) || row.liga || 'unknown';
    const mercadoKey = inferMarketKey(mapperInput);
    const quoteSignature = buildQuoteSignature(mapperInput, liga);
    if (row.mercado_key.startsWith('legacy_raw_')) summary.raw_before++;
    if (!row.quote_signature) summary.signature_missing_before++;
    if (mercadoKey.startsWith('legacy_raw_')) summary.raw_after++;
    const needsUpdate = row.snapshot_id !== row.quote_key
      || row.quote_signature !== quoteSignature
      || row.mercado_key !== mercadoKey;
    if (needsUpdate) summary.metadata_updates++;
    return { ...row, snapshot_id: row.quote_key, quote_signature: quoteSignature, mercado_key: mercadoKey, needsUpdate };
  });

  if (options.dryRun === true) {
    db.close();
    return summary;
  }

  const updateOdd = db.prepare(`
    UPDATE odds
       SET snapshot_id = @snapshot_id,
           quote_signature = @quote_signature,
           mercado_key = @mercado_key,
           atualizado_em = datetime('now')
     WHERE quote_key = @quote_key
  `);
  const upsertHistory = db.prepare(`
    INSERT INTO odds_historico(
      quote_key, snapshot_id, quote_signature, coleta_id, old_odd, new_odd, delta, source_system, payload_raw, criado_em
    ) VALUES (
      @quote_key, @snapshot_id, @quote_signature, @coleta_id, @old_odd, @new_odd, @delta, 'bookline', @payload_raw, @criado_em
    )
    ON CONFLICT(quote_key, coleta_id) DO UPDATE SET
      snapshot_id = excluded.snapshot_id,
      quote_signature = excluded.quote_signature,
      old_odd = excluded.old_odd,
      new_odd = excluded.new_odd,
      delta = excluded.delta,
      payload_raw = excluded.payload_raw,
      criado_em = excluded.criado_em
  `);

  const tx = db.transaction(() => {
    for (const row of prepared) {
      if (row.needsUpdate) updateOdd.run(row);
    }
    const previousBySignature = new Map();
    for (const row of prepared) {
      const previous = previousBySignature.get(row.quote_signature) || null;
      const oldOdd = previous ? Number(previous.odd) : null;
      const delta = oldOdd == null ? null : Number((row.odd - oldOdd).toFixed(6));
      upsertHistory.run({
        quote_key: row.quote_key,
        snapshot_id: row.snapshot_id,
        quote_signature: row.quote_signature,
        coleta_id: row.coleta_id,
        old_odd: oldOdd,
        new_odd: row.odd,
        delta,
        payload_raw: JSON.stringify({
          previous_quote_key: previous?.quote_key ?? null,
          previous_coleta_id: previous?.coleta_id ?? null,
          previous_criado_em: previous?.criado_em ?? null,
          backfill: 'bookline-live-metadata-v1',
        }),
        criado_em: row.criado_em,
      });
      summary.history_rows_written++;
      if (oldOdd != null && delta !== 0) summary.history_changed_rows++;
      previousBySignature.set(row.quote_signature, row);
    }
  });
  tx();
  summary.checkpoint = checkpointExtractionDb(db);
  db.close();
  return summary;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  const summary = backfillBooklineLiveMetadata(args);
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`[backfill-bookline-live] scanned=${summary.scanned_rows} updates=${summary.metadata_updates} raw_before=${summary.raw_before} raw_after=${summary.raw_after} history=${summary.history_rows_written} changed=${summary.history_changed_rows}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[backfill-bookline-live] fatal=${err.message}`);
    process.exitCode = 1;
  });
}