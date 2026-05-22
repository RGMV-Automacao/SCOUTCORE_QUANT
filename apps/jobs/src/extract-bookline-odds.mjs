import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  fetchOddsRecords,
  fetchOddsRecordsByEventId,
  recordToPortugueseRow,
} from '@scoutcore/superbet-scraper';
import { getMarket } from '@scoutcore/markets';
import {
  applyExtractionMigrations,
  checkpointExtractionDb,
  openExtractionDb,
  resolveExtractionDbPath,
} from '../../../scripts/lib/extraction-db.mjs';
import {
  buildQuoteKey,
  buildQuoteSignature,
  inferMarketKey,
  normalizeLegacyLiga,
} from '../../../scripts/migrate-legacy-bookline-odds.mjs';

const SOURCE_VERSION = 'bookline-live-v1';

// Regra de janela bookline live (P9): nunca extrair odds de partidas alem de hoje + 3 dias.
// Espelha o comportamento do legado e evita gravar mercados para partidas distantes que ainda nao tem cotacao.
const DEFAULT_WINDOW_FORWARD_DAYS = 3; // hoje + 3 dias => 4 dias inclusivos
const MAX_WINDOW_SPAN_DAYS = 4; // [from, to] no maximo 4 dias
const DEFAULT_FETCH_CONCURRENCY = 6;
const MAX_FETCH_CONCURRENCY = 12;

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--date=')) out.date = arg.slice(7);
    else if (arg.startsWith('--from=')) out.from = arg.slice(7);
    else if (arg.startsWith('--to=')) out.to = arg.slice(5);
    else if (arg.startsWith('--liga=')) out.liga = arg.slice(7);
    else if (arg.startsWith('--match-id=')) out.matchId = arg.slice(11);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8));
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg.startsWith('--coleta-id=')) out.coletaId = arg.slice(12);
    else if (arg.startsWith('--concurrency=')) out.concurrency = Number.parseInt(arg.slice(14), 10);
    else if (arg === '--resolve-missing-events') out.resolveMissingEvents = true;
    else if (arg === '--no-resolve-missing-events') out.resolveMissingEvents = false;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node apps/jobs/src/extract-bookline-odds.mjs [--date=YYYY-MM-DD | --from=... --to=...] [--liga=...] [--match-id=...] [--limit=N] [--concurrency=N] [--db=data/scout_extraction.db] [--coleta-id=id] [--resolve-missing-events] [--dry-run] [--json]');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toSqlDateTime(value = new Date()) {
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

function insertRunLog(db, { runId, liga, params }) {
  db.prepare(`
    INSERT INTO extracoes_log(run_id, job_name, source_system, source_version, liga, status, params_json)
    VALUES (?, 'extract-bookline-odds', 'bookline', ?, ?, 'running', ?)
  `).run(runId, SOURCE_VERSION, liga ?? null, JSON.stringify(params ?? {}));
}

function finishRunLog(db, { runId, status, rowsRead, rowsWritten, rowsSkipped, warningsCount = 0, errorMessage = null, summary = {} }) {
  db.prepare(`
    UPDATE extracoes_log
       SET status = ?,
           finished_at = datetime('now'),
           rows_read = ?,
           rows_written = ?,
           rows_skipped = ?,
           warnings_count = ?,
           error_message = ?,
           summary_json = ?,
           status_certificacao = ?
     WHERE run_id = ?
  `).run(
    status,
    rowsRead,
    rowsWritten,
    rowsSkipped,
    warningsCount,
    errorMessage,
    JSON.stringify(summary),
    status === 'ok' ? 'aprovada' : status === 'partial' ? 'parcial' : 'reprovada',
    runId,
  );
}

function insertColetaStart(db, { coletaId, liga, startedAt, params }) {
  db.prepare(`
    INSERT INTO odds_coletas(
      coleta_id, source_system, source_version, liga, janela_inicio, status,
      started_at, params_json, summary_json
    ) VALUES (
      ?, 'bookline', ?, ?, ?, 'running', ?, ?, '{}'
    )
  `).run(coletaId, SOURCE_VERSION, liga ?? null, startedAt, startedAt, JSON.stringify(params ?? {}));
}

function finishColeta(db, { coletaId, liga, startedAt, finishedAt, status, matchesChecked, eventsMatched, oddsWritten, warningsCount = 0, errorMessage = null, params = {}, summary = {} }) {
  db.prepare(`
    UPDATE odds_coletas
       SET source_version = ?,
           liga = ?,
           janela_inicio = ?,
           janela_fim = ?,
           status = ?,
           finished_at = ?,
           matches_checked = ?,
           events_matched = ?,
           odds_written = ?,
           warnings_count = ?,
           error_message = ?,
           params_json = ?,
           summary_json = ?
     WHERE coleta_id = ?
  `).run(
    SOURCE_VERSION,
    liga ?? null,
    startedAt,
    finishedAt,
    status,
    finishedAt,
    matchesChecked,
    eventsMatched,
    oddsWritten,
    warningsCount,
    errorMessage,
    JSON.stringify(params),
    JSON.stringify(summary),
    coletaId,
  );
}

function certificationStatusFromSummary(summary) {
  if (summary.matches_checked <= 0 || summary.events_matched <= 0 || summary.odds_written <= 0) return 'reprovada';
  if (summary.coleta_rows_count !== summary.odds_written || summary.coleta_rows_missing_signature > 0) return 'reprovada';
  if (summary.failed_matches > 0 || summary.raw_market_keys > 0) return 'parcial';
  return 'aprovada';
}

function leagueStatusFromCertification(status) {
  if (status === 'aprovada') return 'certificada';
  if (status === 'parcial') return 'em_teste';
  return 'bloqueada';
}

function addCertificationCheck(checks, name, ok, detail = {}) {
  checks.push({ name, ok: Boolean(ok), detail });
}

function distinctLeagueSeasons(matches) {
  const out = new Map();
  for (const match of matches) {
    const liga = normalizeLegacyLiga(match.liga) || match.liga || 'unknown';
    const temporada = match.temporada || 'unknown';
    out.set(`${liga}|${temporada}`, { liga, temporada });
  }
  return [...out.values()];
}

function insertBooklineCertification(db, { runId, matches, summary }) {
  const checks = [];
  addCertificationCheck(checks, 'matches_checked_gt_zero', summary.matches_checked > 0, { matches_checked: summary.matches_checked });
  addCertificationCheck(checks, 'events_matched_gt_zero', summary.events_matched > 0, { events_matched: summary.events_matched });
  addCertificationCheck(checks, 'no_failed_matches', summary.failed_matches === 0, { failed_matches: summary.failed_matches });
  addCertificationCheck(checks, 'odds_written_gt_zero', summary.odds_written > 0, { odds_written: summary.odds_written });
  addCertificationCheck(checks, 'coleta_rows_match_summary', summary.coleta_rows_count === summary.odds_written, { coleta_rows_count: summary.coleta_rows_count, odds_written: summary.odds_written });
  addCertificationCheck(checks, 'all_rows_have_quote_signature', summary.coleta_rows_missing_signature === 0, { missing_signature: summary.coleta_rows_missing_signature });
  addCertificationCheck(checks, 'no_raw_market_keys', summary.raw_market_keys === 0, { raw_market_keys: summary.raw_market_keys });

  const checksFailed = checks.filter((check) => !check.ok).length;
  const status = certificationStatusFromSummary(summary);
  const certificationId = `cert-bookline-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const leagueSeasons = distinctLeagueSeasons(matches);
  const singleLiga = leagueSeasons.length === 1 ? leagueSeasons[0].liga : null;
  const singleTemporada = leagueSeasons.length === 1 ? leagueSeasons[0].temporada : null;
  const payload = { coleta_id: summary.coleta_id, source_version: SOURCE_VERSION, checks, summary };

  db.prepare(`
    INSERT INTO certificacao_extracao(
      certification_id, run_id, scope, liga, temporada, status,
      checks_total, checks_passed, checks_failed, payload_json
    ) VALUES (?, ?, 'bookline', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    certificationId,
    runId,
    singleLiga,
    singleTemporada,
    status,
    checks.length,
    checks.length - checksFailed,
    checksFailed,
    JSON.stringify(payload),
  );

  const upsertLeague = db.prepare(`
    INSERT INTO certificacao_liga(liga, temporada, status, statsline_status, bookline_status, last_certification_id, updated_at)
    VALUES (@liga, @temporada, @status, 'nao_avaliada', @bookline_status, @last_certification_id, datetime('now'))
    ON CONFLICT(liga, temporada) DO UPDATE SET
      status = excluded.status,
      bookline_status = excluded.bookline_status,
      last_certification_id = excluded.last_certification_id,
      updated_at = excluded.updated_at
  `);
  for (const item of leagueSeasons) {
    upsertLeague.run({
      liga: item.liga,
      temporada: item.temporada,
      status: leagueStatusFromCertification(status),
      bookline_status: status,
      last_certification_id: certificationId,
    });
  }

  db.prepare(`
    UPDATE odds
       SET status_certificacao = ?, atualizado_em = datetime('now')
     WHERE coleta_id = ?
  `).run(status, summary.coleta_id);

  db.prepare(`
    UPDATE partidas
       SET processado_odds = 1,
           certificado_em = datetime('now'),
           atualizado_em = datetime('now')
     WHERE id_confronto IN (
       SELECT DISTINCT id_confronto
         FROM odds
        WHERE coleta_id = ?
          AND id_confronto IS NOT NULL
     )
  `).run(summary.coleta_id);

  return {
    certification_id: certificationId,
    status,
    checks_total: checks.length,
    checks_passed: checks.length - checksFailed,
    checks_failed: checksFailed,
    league_seasons: leagueSeasons,
    failed_checks: checks.filter((check) => !check.ok).map((check) => check.name),
  };
}

function updateStoredSummary(db, { runId, coletaId, summary }) {
  const summaryJson = JSON.stringify(summary);
  db.prepare('UPDATE extracoes_log SET summary_json = ? WHERE run_id = ?').run(summaryJson, runId);
  db.prepare('UPDATE odds_coletas SET summary_json = ? WHERE coleta_id = ?').run(summaryJson, coletaId);
}

function buildMatchQuery(args) {
  const clauses = [
    `COALESCE(NULLIF(substr(data_partida, 1, 10), ''), NULLIF(data_brasil, '')) IS NOT NULL`,
    `home_team IS NOT NULL`,
    `away_team IS NOT NULL`,
    `home_team != ''`,
    `away_team != ''`,
  ];
  const params = [];

  if (args.matchId) {
    clauses.push('id_confronto = ?');
    params.push(args.matchId);
  } else {
    const today = todayISO();
    const dateFrom = args.from || args.date || today;
    const dateTo = args.to || args.date || addDaysISO(dateFrom, DEFAULT_WINDOW_FORWARD_DAYS);
    const spanDays = Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) + 1;
    if (!Number.isFinite(spanDays) || spanDays <= 0) {
      throw new Error(`Janela invalida: from=${dateFrom} to=${dateTo}`);
    }
    if (spanDays > MAX_WINDOW_SPAN_DAYS) {
      throw new Error(`Janela ${dateFrom}..${dateTo} (${spanDays}d) excede MAX_WINDOW_SPAN_DAYS=${MAX_WINDOW_SPAN_DAYS}. Use janelas menores (hoje + ${DEFAULT_WINDOW_FORWARD_DAYS} dias por padrao).`);
    }
    clauses.push(`date(COALESCE(NULLIF(substr(data_partida, 1, 10), ''), NULLIF(data_brasil, ''))) BETWEEN date(?) AND date(?)`);
    params.push(dateFrom, dateTo);
  }
  if (args.liga) {
    clauses.push('liga = ?');
    params.push(args.liga);
  }

  let sql = `
    SELECT id_confronto,
           liga,
           temporada,
           home_team,
           away_team,
           COALESCE(NULLIF(substr(data_partida, 1, 10), ''), NULLIF(data_brasil, '')) AS data_jogo
      FROM partidas
     WHERE ${clauses.join(' AND ')}
     ORDER BY data_jogo ASC, liga ASC, home_team ASC, away_team ASC
  `;
  if (Number.isFinite(args.limit) && args.limit > 0) sql += ` LIMIT ${Number(args.limit)}`;
  return { sql, params };
}

function boolFromEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'sim'].includes(String(raw).trim().toLowerCase());
}

function resolveFetchConcurrency(options = {}) {
  const envValue = Number.parseInt(process.env.SCOUT_BOOKLINE_FETCH_CONCURRENCY ?? '', 10);
  const requested = Number.isFinite(options.concurrency) && options.concurrency > 0
    ? options.concurrency
    : envValue;
  const raw = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_FETCH_CONCURRENCY;
  return Math.min(Math.max(1, Math.floor(raw)), MAX_FETCH_CONCURRENCY);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const out = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    for (;;) {
      const index = nextIndex++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return out;
}

export function resolveKnownEventIdForMatch(selectKnownEventId, match) {
  if (!selectKnownEventId || !match?.id_confronto) return null;
  const row = selectKnownEventId.get(match.id_confronto);
  const eventId = String(row?.source_event_id || '').trim();
  return eventId || null;
}

async function fetchOddsForMatch({ match, selectKnownEventId, resolveMissingEvents }) {
  const knownEventId = match.known_event_id || resolveKnownEventIdForMatch(selectKnownEventId, match);
  if (knownEventId) {
    const direct = await fetchOddsRecordsByEventId({
      eventId: knownEventId,
      home: match.home_team,
      away: match.away_team,
    });
    return {
      ...direct,
      lookup_source: 'source_event_id',
      warnings: direct.warnings || [],
    };
  }

  if (!resolveMissingEvents) {
    return {
      records: [],
      event_id: null,
      lookup_source: 'missing_event_id',
      warnings: [`event_id_nao_resolvido:${match.home_team}×${match.away_team}:${match.data_jogo}`],
    };
  }

  const lookup = await fetchOddsRecords({
    home: match.home_team,
    away: match.away_team,
    liga: match.liga,
    date: match.data_jogo,
  });
  return {
    ...lookup,
    lookup_source: 'public_lookup',
    warnings: lookup.warnings || [],
  };
}

export function prepareOddsRowsForMatch({ match, eventId, coletaId, records, createdAt }) {
  const liga = normalizeLegacyLiga(match.liga) || String(match.liga || '').trim() || 'unknown';
  const homeTeam = match.home_team ?? match.equipe_home ?? null;
  const awayTeam = match.away_team ?? match.equipe_away ?? null;
  const uniqueRows = new Map();
  const stats = {
    raw_records: records.length,
    mapped_rows: 0,
    duplicate_rows: 0,
    skipped_rows: 0,
    invalid_odds: 0,
    canonical_market_keys: 0,
    raw_market_keys: 0,
    out_of_catalog_rows: 0,
  };

  for (const rec of records) {
    const teamTab = rec.team_tab
      ?? (rec.scope === 'equipe_home' ? homeTeam : rec.scope === 'equipe_away' ? awayTeam : null);
    const portugueseRow = recordToPortugueseRow(rec);
    if (!portugueseRow) {
      stats.skipped_rows++;
      continue;
    }

    const odd = Number.parseFloat(rec.odd);
    if (!Number.isFinite(odd) || odd <= 1.0) {
      stats.invalid_odds++;
      continue;
    }

    const prepared = {
      fixture_id: eventId,
      coleta_id: coletaId,
      liga,
      home_team: homeTeam,
      away_team: awayTeam,
      equipe_home: homeTeam,
      equipe_away: awayTeam,
      data_jogo: match.data_jogo,
      mercado: portugueseRow.mercado,
      selecao: portugueseRow.selecao,
      linha: portugueseRow.linha ?? null,
      odd,
      id_confronto: match.id_confronto,
      team_tab: teamTab,
      scope: rec.scope ?? null,
      family: rec.family ?? null,
      period: rec.period ?? null,
    };
    const mercadoKey = inferMarketKey(prepared);
    if (mercadoKey.startsWith('legacy_raw_') || !getMarket(mercadoKey)) {
      stats.skipped_rows++;
      stats.out_of_catalog_rows++;
      continue;
    }
    const quoteKey = buildQuoteKey(prepared, liga);
    const quoteSignature = buildQuoteSignature(prepared, liga);
    if (uniqueRows.has(quoteKey)) stats.duplicate_rows++;
    uniqueRows.set(quoteKey, {
      quote_key: quoteKey,
      snapshot_id: quoteKey,
      quote_signature: quoteSignature,
      id_confronto: match.id_confronto,
      source_event_id: String(eventId),
      source_version: SOURCE_VERSION,
      liga,
      home_team: homeTeam,
      away_team: awayTeam,
      data_jogo: match.data_jogo,
      mercado_key: mercadoKey,
      mercado: portugueseRow.mercado,
      selecao: portugueseRow.selecao,
      linha: portugueseRow.linha ?? null,
      odd,
      coleta_id: coletaId,
      payload_raw: JSON.stringify({
        event_id: String(eventId),
        match_id: match.id_confronto,
        team_tab: teamTab,
        record: rec,
      }),
      criado_em: createdAt,
    });
    stats.mapped_rows++;
  }

  const rows = [...uniqueRows.values()];
  for (const row of rows) {
    if (row.mercado_key.startsWith('legacy_raw_')) stats.raw_market_keys++;
    else stats.canonical_market_keys++;
  }

  return { liga, rows, stats };
}

function deriveStatus(summary) {
  if (summary.failed_matches === 0) return 'ok';
  return summary.events_matched > 0 || summary.odds_written > 0 ? 'partial' : 'failed';
}

export async function extractBooklineOdds(options = {}) {
  const args = { ...options };
  const dbPath = resolveExtractionDbPath(args.dbPath);
  applyExtractionMigrations({ dbPath });
  const db = openExtractionDb(dbPath);
  const query = buildMatchQuery(args);
  const resolveMissingEvents = args.resolveMissingEvents ?? boolFromEnv('SCOUT_BOOKLINE_RESOLVE_MISSING_EVENTS', true);
  const fetchConcurrency = resolveFetchConcurrency(args);
  const selectKnownEventId = db.prepare(`
    SELECT source_event_id
      FROM odds
     WHERE id_confronto = ?
       AND source_event_id IS NOT NULL
       AND trim(source_event_id) <> ''
     ORDER BY CASE source_version
                WHEN '${SOURCE_VERSION}' THEN 0
                WHEN 'legacy-bookline-import-v1' THEN 1
                ELSE 2
              END,
              datetime(COALESCE(atualizado_em, criado_em)) DESC
     LIMIT 1
  `);
  const matches = db.prepare(query.sql)
    .all(...query.params)
    .map((match) => ({
      ...match,
      known_event_id: resolveKnownEventIdForMatch(selectKnownEventId, match),
    }));
  const runId = args.runId ?? `bookline-odds-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const coletaId = args.coletaId ?? `bookline-live-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const startedAt = toSqlDateTime();
  const summary = {
    run_id: args.dryRun === true ? null : runId,
    coleta_id: args.dryRun === true ? null : coletaId,
    db: dbPath,
    dry_run: args.dryRun === true,
    liga: args.liga ?? null,
    match_id: args.matchId ?? null,
    matches_checked: matches.length,
    events_matched: 0,
    failed_matches: 0,
    raw_records: 0,
    mapped_rows: 0,
    duplicate_rows: 0,
    skipped_rows: 0,
    invalid_odds: 0,
    canonical_market_keys: 0,
    raw_market_keys: 0,
    out_of_catalog_rows: 0,
    odds_written: 0,
    history_rows_written: 0,
    history_changed_rows: 0,
    history_unchanged_rows: 0,
    coleta_rows_count: 0,
    coleta_rows_missing_signature: 0,
    certification: null,
    checkpoint: null,
    warnings_count: 0,
    direct_event_hits: 0,
    public_lookup_hits: 0,
    missing_event_id: 0,
    resolve_missing_events: Boolean(resolveMissingEvents),
    fetch_concurrency: fetchConcurrency,
    fetch_elapsed_ms: 0,
    write_elapsed_ms: 0,
    failures: [],
    successes: [],
  };

  async function fetchAndPrepare(match) {
    let res;
    try {
      res = await fetchOddsForMatch({ match, selectKnownEventId: null, resolveMissingEvents });
    } catch (err) {
      return {
        match,
        error: { id_confronto: match.id_confronto, reason: 'fetch_falhou', error: err.message },
      };
    }

    if (!res.event_id) {
      return {
        match,
        res,
        error: { id_confronto: match.id_confronto, reason: 'evento_nao_encontrado', warnings: res.warnings },
      };
    }

    return {
      match,
      res,
      prepared: prepareOddsRowsForMatch({
        match,
        eventId: res.event_id,
        coletaId,
        records: res.records,
        createdAt: toSqlDateTime(),
      }),
    };
  }

  function applyFetchResultToSummary(item) {
    const res = item.res;
    if (res?.lookup_source === 'source_event_id') summary.direct_event_hits++;
    else if (res?.lookup_source === 'public_lookup') summary.public_lookup_hits++;
    else if (res?.lookup_source === 'missing_event_id') summary.missing_event_id++;
    summary.warnings_count += res?.warnings?.length || 0;

    if (item.error) {
      summary.failed_matches++;
      summary.failures.push({
        ...item.error,
        home_team: item.match.home_team,
        away_team: item.match.away_team,
        data_jogo: item.match.data_jogo,
      });
      return;
    }

    summary.events_matched++;
    summary.successes.push({
      id_confronto: item.match.id_confronto,
      home_team: item.match.home_team,
      away_team: item.match.away_team,
      data_jogo: item.match.data_jogo,
      odds_count: item.prepared.rows.length,
    });
    const prepared = item.prepared;
    summary.raw_records += prepared.stats.raw_records;
    summary.mapped_rows += prepared.stats.mapped_rows;
    summary.duplicate_rows += prepared.stats.duplicate_rows;
    summary.skipped_rows += prepared.stats.skipped_rows;
    summary.invalid_odds += prepared.stats.invalid_odds;
    summary.canonical_market_keys += prepared.stats.canonical_market_keys;
    summary.raw_market_keys += prepared.stats.raw_market_keys;
    summary.out_of_catalog_rows += prepared.stats.out_of_catalog_rows;
    summary.odds_written += prepared.rows.length;
  }

  if (args.dryRun === true) {
    try {
      const fetchStarted = Date.now();
      const preparedMatches = await mapWithConcurrency(matches, fetchConcurrency, fetchAndPrepare);
      summary.fetch_elapsed_ms = Date.now() - fetchStarted;
      for (const item of preparedMatches) applyFetchResultToSummary(item);
      return summary;
    } finally {
      db.close();
    }
  }

  const upsertOdd = db.prepare(`
    INSERT INTO odds(
      quote_key, snapshot_id, quote_signature, id_confronto, source_event_id, source_system, source_version,
      liga, home_team, away_team, data_jogo, mercado_key, mercado, selecao,
      linha, odd, coleta_id, status_certificacao, payload_raw, criado_em, atualizado_em
    ) VALUES (
      @quote_key, @snapshot_id, @quote_signature, @id_confronto, @source_event_id, 'bookline', @source_version,
      @liga, @home_team, @away_team, @data_jogo, @mercado_key, @mercado, @selecao,
      @linha, @odd, @coleta_id, 'nao_avaliada', @payload_raw, @criado_em, datetime('now')
    )
    ON CONFLICT(quote_key) DO UPDATE SET
      snapshot_id = excluded.snapshot_id,
      quote_signature = excluded.quote_signature,
      id_confronto = excluded.id_confronto,
      source_event_id = excluded.source_event_id,
      source_version = excluded.source_version,
      liga = excluded.liga,
      home_team = excluded.home_team,
      away_team = excluded.away_team,
      data_jogo = excluded.data_jogo,
      mercado_key = excluded.mercado_key,
      mercado = excluded.mercado,
      selecao = excluded.selecao,
      linha = excluded.linha,
      odd = excluded.odd,
      coleta_id = excluded.coleta_id,
      payload_raw = excluded.payload_raw,
      criado_em = excluded.criado_em,
      atualizado_em = excluded.atualizado_em
  `);
  const selectPreviousOddBySignature = db.prepare(`
    SELECT quote_key, snapshot_id, quote_signature, coleta_id, odd, criado_em
      FROM odds
     WHERE coleta_id != @coleta_id
       AND quote_signature = @quote_signature
     ORDER BY criado_em DESC, atualizado_em DESC
     LIMIT 1
  `);
  const selectPreviousOddLegacyFallback = db.prepare(`
    SELECT quote_key, snapshot_id, quote_signature, coleta_id, odd, criado_em
      FROM odds
     WHERE coleta_id != @coleta_id
       AND quote_signature IS NULL
       AND liga = @liga
       AND COALESCE(id_confronto, '') = COALESCE(@id_confronto, '')
       AND source_event_id = @source_event_id
       AND mercado_key = @mercado_key
       AND selecao = @selecao
       AND COALESCE(linha, '') = COALESCE(@linha, '')
     ORDER BY criado_em DESC, atualizado_em DESC
     LIMIT 1
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
  const insertRowsTx = db.transaction((rows) => {
    const stats = { historyRows: 0, changedRows: 0, unchangedRows: 0 };
    for (const row of rows) {
      let previous = row.quote_signature ? selectPreviousOddBySignature.get(row) : null;
      if (!previous && !row.quote_signature) previous = selectPreviousOddLegacyFallback.get(row) || null;
      upsertOdd.run(row);
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
          previous_snapshot_id: previous?.snapshot_id ?? null,
          previous_quote_signature: previous?.quote_signature ?? null,
          previous_coleta_id: previous?.coleta_id ?? null,
          previous_criado_em: previous?.criado_em ?? null,
        }),
        criado_em: row.criado_em,
      });
      stats.historyRows++;
      if (oldOdd != null && delta !== 0) stats.changedRows++;
      else stats.unchangedRows++;
    }
    return stats;
  });

  insertRunLog(db, { runId, liga: args.liga, params: args });
  insertColetaStart(db, { coletaId, liga: args.liga, startedAt, params: args });
  try {
    const fetchStarted = Date.now();
    const preparedMatches = await mapWithConcurrency(matches, fetchConcurrency, fetchAndPrepare);
    summary.fetch_elapsed_ms = Date.now() - fetchStarted;

    const writeStarted = Date.now();
    for (const item of preparedMatches) {
      applyFetchResultToSummary(item);
      if (item.error) continue;

      const historyStats = insertRowsTx(item.prepared.rows);
      summary.history_rows_written += historyStats.historyRows;
      summary.history_changed_rows += historyStats.changedRows;
      summary.history_unchanged_rows += historyStats.unchangedRows;
      if (!args.json) {
        console.log(`[extract-bookline-odds] ${item.match.home_team} x ${item.match.away_team} (${item.match.data_jogo}) event=${item.res.event_id} raw=${item.prepared.stats.raw_records} mapped=${item.prepared.stats.mapped_rows} unique=${item.prepared.rows.length} dup=${item.prepared.stats.duplicate_rows} skip=${item.prepared.stats.skipped_rows + item.prepared.stats.invalid_odds}`);
      }
    }
    summary.write_elapsed_ms = Date.now() - writeStarted;

    summary.target_odds_count = db.prepare('SELECT COUNT(*) AS count FROM odds').get().count;
    summary.target_coletas_count = db.prepare('SELECT COUNT(*) AS count FROM odds_coletas').get().count;
    const coletaRows = db.prepare(`
      SELECT COUNT(*) AS count,
             SUM(CASE WHEN quote_signature IS NULL OR quote_signature = '' THEN 1 ELSE 0 END) AS missing_signature
        FROM odds
       WHERE coleta_id = ?
    `).get(coletaId);
    summary.coleta_rows_count = Number(coletaRows.count || 0);
    summary.coleta_rows_missing_signature = Number(coletaRows.missing_signature || 0);
    const finishedAt = toSqlDateTime();
    const status = deriveStatus(summary);
    summary.status = status;
    summary.certification = insertBooklineCertification(db, { runId, matches, summary });
    finishColeta(db, {
      coletaId,
      liga: args.liga,
      startedAt,
      finishedAt,
      status,
      matchesChecked: summary.matches_checked,
      eventsMatched: summary.events_matched,
      oddsWritten: summary.odds_written,
      warningsCount: summary.warnings_count,
      summary,
      params: args,
    });
    finishRunLog(db, {
      runId,
      status,
      rowsRead: summary.matches_checked,
      rowsWritten: summary.odds_written,
      rowsSkipped: summary.failed_matches,
      warningsCount: summary.warnings_count,
      summary,
    });
    summary.checkpoint = checkpointExtractionDb(db);
    updateStoredSummary(db, { runId, coletaId, summary });
    return summary;
  } catch (err) {
    const finishedAt = toSqlDateTime();
    finishColeta(db, {
      coletaId,
      liga: args.liga,
      startedAt,
      finishedAt,
      status: 'failed',
      matchesChecked: summary.matches_checked,
      eventsMatched: summary.events_matched,
      oddsWritten: summary.odds_written,
      warningsCount: summary.warnings_count,
      errorMessage: err.message,
      summary,
      params: args,
    });
    finishRunLog(db, {
      runId,
      status: 'failed',
      rowsRead: summary.matches_checked,
      rowsWritten: summary.odds_written,
      rowsSkipped: summary.failed_matches,
      warningsCount: summary.warnings_count,
      errorMessage: err.message,
      summary,
    });
    try {
      summary.status = 'failed';
      summary.checkpoint = checkpointExtractionDb(db);
      updateStoredSummary(db, { runId, coletaId, summary });
    } catch {
      // Mantem o erro original da extracao.
    }
    throw err;
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const summary = await extractBooklineOdds(args);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[extract-bookline-odds] db=${summary.db} dry_run=${summary.dry_run} liga=${summary.liga ?? '*'} match_id=${summary.match_id ?? '*'} coleta_id=${summary.coleta_id ?? 'dry-run'}`);
    console.log(`[extract-bookline-odds] matches=${summary.matches_checked} events=${summary.events_matched} failed=${summary.failed_matches} raw=${summary.raw_records} mapped=${summary.mapped_rows} unique=${summary.odds_written} dup=${summary.duplicate_rows} skipped=${summary.skipped_rows + summary.invalid_odds} warnings=${summary.warnings_count}`);
    if (!summary.dry_run) {
      console.log(`[extract-bookline-odds] history=${summary.history_rows_written} changed=${summary.history_changed_rows} cert=${summary.certification?.status ?? 'nao_avaliada'} checkpoint_busy=${summary.checkpoint?.busy ?? 'n/a'}`);
    }
    if (summary.successes?.length > 0) {
      console.log('');
      for (const s of summary.successes) {
        console.log(`[extract-bookline-odds]  OK  ${s.home_team} x ${s.away_team} (${s.data_jogo}) odds=${s.odds_count}`);
      }
    }
    if (summary.failures.length > 0) {
      console.log('');
      for (const f of summary.failures) {
        const name = f.home_team && f.away_team ? `${f.home_team} x ${f.away_team} (${f.data_jogo || '?'})` : f.id_confronto;
        console.log(`[extract-bookline-odds]  NOK ${name} -> ${f.reason}${f.error ? ` (${f.error})` : ''}`);
      }
    }
  }
  process.exitCode = summary.failed_matches > 0 && summary.events_matched === 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[extract-bookline-odds] fatal: ${err.message}`);
    process.exitCode = 1;
  });
}