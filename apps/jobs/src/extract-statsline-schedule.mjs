import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  applyExtractionMigrations,
  openExtractionDb,
  resolveExtractionDbPath,
} from '../../../scripts/lib/extraction-db.mjs';
import {
  extractTmclFromUrl,
  getConfiguredSeasonUrl,
  listExtractionSeasons,
  loadExtractionLeaguesConfig,
} from '../../../scripts/lib/extraction-config.mjs';
import { resolveToOriginal } from './statsline-team-resolver.mjs';

const SOURCE_VERSION = 'schedule-v1';
const DEFAULT_STATSLINE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--all') out.all = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--liga=')) out.liga = arg.slice(7);
    else if (arg.startsWith('--temporada=')) out.temporada = arg.slice(12);
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8));
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node apps/jobs/src/extract-statsline-schedule.mjs --liga=brasileirao --temporada=2026 [--dry-run] [--limit=N] [--json]');
  console.log('     node apps/jobs/src/extract-statsline-schedule.mjs --all [--liga=brasileirao] [--dry-run] [--json]');
}

function normalizeSourceDate(dateStr) {
  return String(dateStr || '').trim().replace(/Z$/, '');
}

function normalizeSourceTime(timeStr) {
  return String(timeStr || '').trim().replace(/Z$/, '').slice(0, 8);
}

function sourceUtcToBrasilia(dateStr, timeStr) {
  const date = normalizeSourceDate(dateStr);
  const time = normalizeSourceTime(timeStr);
  if (!date || !time) return null;

  const parsed = new Date(`${date}T${time}Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed);

  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    data_brasil: `${read('year')}-${read('month')}-${read('day')}`,
    hora_brasil: `${read('hour')}:${read('minute')}`,
  };
}

function getScheduleFromMatchPayload(rawPayload, fallback = {}) {
  const info = rawPayload?.matchInfo || {};
  const utcSchedule = sourceUtcToBrasilia(info.date, info.time);
  if (utcSchedule) {
    return {
      data_partida: normalizeSourceDate(info.date) || fallback.data_partida || '',
      hora_partida: normalizeSourceTime(info.time).slice(0, 5) || fallback.hora_partida || '',
      ...utcSchedule,
    };
  }

  return {
    data_partida: normalizeSourceDate(info.localDate || info.date) || fallback.data_partida || '',
    hora_partida: normalizeSourceTime(info.localTime || info.time).slice(0, 5) || fallback.hora_partida || '',
    data_brasil: fallback.data_brasil || normalizeSourceDate(info.localDate || info.date) || '',
    hora_brasil: fallback.hora_brasil || normalizeSourceTime(info.localTime || info.time).slice(0, 5) || '',
  };
}

function parseJsonOrJsonp(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('schedule_empty_response');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);

  const start = trimmed.indexOf('(');
  const end = trimmed.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start) throw new Error('schedule_invalid_jsonp');
  return JSON.parse(trimmed.slice(start + 1, end));
}

function getPageSizeFromUrl(url) {
  try {
    const value = new URL(url).searchParams.get('_pgSz');
    const parsed = Number.parseInt(value || '400', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 400;
  } catch {
    return 400;
  }
}

function buildPagedUrl(baseUrl, pageNumber) {
  const url = new URL(baseUrl);
  if (pageNumber > 1) url.searchParams.set('_pgNm', String(pageNumber));
  else url.searchParams.delete('_pgNm');
  return url.toString();
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function fetchScheduleResponse(fetchImpl, pageUrl, options = {}) {
  const maxRetries = Number.isFinite(options.retries) ? options.retries : 2;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchImpl(pageUrl, { headers: buildStatslineHeaders(options.env) });
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) break;
      const delayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 750 * (attempt + 1);
      await delay(delayMs);
    }
  }

  const detail = lastError?.cause?.code || lastError?.message || 'unknown';
  throw new Error(`schedule_fetch_failed:${detail}`);
}

export function buildStatslineHeaders(env = process.env) {
  const headers = {
    'User-Agent': env.STATSLINE_USER_AGENT || DEFAULT_STATSLINE_USER_AGENT,
  };
  const referer = env.STATSLINE_REFERER || env.STATSLINE_HTTP_REFERER;
  if (referer) headers.Referer = referer;
  return headers;
}

function readMatchesFromPayload(payload) {
  const matches = payload?.match || payload?.matches || payload?.data?.match || payload?.data?.matches || [];
  if (!Array.isArray(matches)) throw new Error('schedule_matches_not_array');
  return matches;
}

export async function fetchSchedulePages(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');

  const pageSize = getPageSizeFromUrl(url);
  const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : 10;
  const seenIds = new Set();
  const allMatches = [];

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const pageUrl = buildPagedUrl(url, pageNumber);
    const response = await fetchScheduleResponse(fetchImpl, pageUrl, options);
    if (!response?.ok) throw new Error(`schedule_http_${response?.status ?? 'unknown'}`);

    const payload = parseJsonOrJsonp(await response.text());
    if (payload?.httpStatus && String(payload.httpStatus) !== '200') {
      const code = payload.errorCode ? `_${payload.errorCode}` : '';
      throw new Error(`schedule_provider_${payload.httpStatus}${code}`);
    }
    const pageMatches = readMatchesFromPayload(payload);
    if (pageMatches.length === 0) break;

    let addedThisPage = 0;
    for (const match of pageMatches) {
      const id = match?.matchInfo?.id || JSON.stringify(match);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      allMatches.push(match);
      addedThisPage++;
    }

    if (pageMatches.length < pageSize || addedThisPage === 0) break;
  }

  return allMatches;
}

function parseNullableInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNullableFloat(value) {
  if (value == null || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function joinName(...parts) {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ').trim();
}

function parseScheduleOfficials(match) {
  const rawOfficials = match?.liveData?.matchDetailsExtra?.matchOfficial || [];
  if (!Array.isArray(rawOfficials)) return [];

  return rawOfficials.map((official) => {
    const statslineId = String(official?.id || '').trim();
    const firstName = String(official?.firstName || '').trim() || null;
    const lastName = String(official?.lastName || '').trim() || null;
    const name = joinName(firstName, lastName) || String(official?.name || '').trim();
    if (!statslineId || !name) return null;
    return {
      statsline_id: statslineId,
      nome: name,
      primeiro_nome: firstName,
      sobrenome: lastName,
      pais: official?.country || official?.countryCode || null,
      tipo: String(official?.type || 'Main').trim() || 'Main',
      source_system: 'statsline',
      source_version: SOURCE_VERSION,
      payload_raw: JSON.stringify(official),
    };
  }).filter(Boolean);
}

export function parseScheduleMatch(match, { liga, temporada, sourceVersion = SOURCE_VERSION } = {}) {
  const info = match?.matchInfo || {};
  const live = match?.liveData?.matchDetails || {};
  const contestants = Array.isArray(info.contestant) ? info.contestant : [];
  const home = contestants.find((item) => item.position === 'home') || contestants[0] || {};
  const away = contestants.find((item) => item.position === 'away') || contestants[1] || {};
  const homeTeam = resolveToOriginal(home.name || '?');
  const awayTeam = resolveToOriginal(away.name || '?');
  const idConfronto = String(info.id || '').trim();

  if (!idConfronto) {
    return { ok: false, reason: 'missing_match_identity' };
  }

  const scores = live.scores || {};
  const ft = scores.ft || scores.total || {};
  const ht = scores.ht || {};
  const schedule = getScheduleFromMatchPayload(match);
  const venue = info.venue || {};
  const officials = parseScheduleOfficials(match);
  const mainReferee = officials.find((official) => official.tipo === 'Main') || officials[0] || null;

  return {
    ok: true,
    row: {
      id_confronto: idConfronto,
      liga,
      temporada,
      id_liga: info.competition?.id ? String(info.competition.id) : null,
      rodada: info.week != null ? String(info.week) : null,
      confronto: `${homeTeam} x ${awayTeam}`,
      home_team: homeTeam,
      away_team: awayTeam,
      data_partida: schedule.data_partida,
      hora_partida: schedule.hora_partida,
      data_brasil: schedule.data_brasil,
      hora_brasil: schedule.hora_brasil,
      status: live.matchStatus || info.matchStatus || 'Unknown',
      home_goals: parseNullableInteger(ft.home),
      away_goals: parseNullableInteger(ft.away),
      home_goals_ht: parseNullableInteger(ht.home),
      away_goals_ht: parseNullableInteger(ht.away),
      competition_id: info.competition?.id ? String(info.competition.id) : null,
      estadio: venue.longName || venue.name || null,
      estadio_lat: parseNullableFloat(venue.latitude),
      estadio_lon: parseNullableFloat(venue.longitude),
      arbitro_principal: mainReferee?.nome || null,
      publico: parseNullableInteger(match?.liveData?.matchDetailsExtra?.attendance),
      source_system: 'statsline',
      source_version: sourceVersion,
      payload_raw: JSON.stringify(match),
    },
    officials,
  };
}

function insertRunLog(db, { runId, liga, temporada, params }) {
  db.prepare(`
    INSERT INTO extracoes_log(run_id, job_name, source_system, source_version, liga, temporada, status, params_json)
    VALUES (?, 'extract-statsline-schedule', 'statsline', ?, ?, ?, 'running', ?)
  `).run(runId, SOURCE_VERSION, liga, temporada, JSON.stringify(params ?? {}));
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

export function upsertScheduleMatches(db, rows, { runId, dryRun = false } = {}) {
  if (dryRun) return { inserted: 0, updated: 0, written: 0, officials_written: 0 };

  const existsStmt = db.prepare('SELECT 1 FROM partidas WHERE id_confronto = ? LIMIT 1');
  const upsertStmt = db.prepare(`
    INSERT INTO partidas(
      id_confronto, liga, temporada, id_liga, rodada, confronto,
      home_team, away_team, data_partida, hora_partida, data_brasil, hora_brasil,
      status, home_goals, away_goals, home_goals_ht, away_goals_ht, competition_id,
      estadio, estadio_lat, estadio_lon, arbitro_principal, publico,
      run_id, source_system, source_version, payload_raw, atualizado_em
    )
    VALUES (
      @id_confronto, @liga, @temporada, @id_liga, @rodada, @confronto,
      @home_team, @away_team, @data_partida, @hora_partida, @data_brasil, @hora_brasil,
      @status, @home_goals, @away_goals, @home_goals_ht, @away_goals_ht, @competition_id,
      @estadio, @estadio_lat, @estadio_lon, @arbitro_principal, @publico,
      @run_id, @source_system, @source_version, @payload_raw, datetime('now')
    )
    ON CONFLICT(id_confronto) DO UPDATE SET
      liga = excluded.liga,
      temporada = excluded.temporada,
      id_liga = excluded.id_liga,
      rodada = excluded.rodada,
      confronto = excluded.confronto,
      home_team = excluded.home_team,
      away_team = excluded.away_team,
      data_partida = excluded.data_partida,
      hora_partida = excluded.hora_partida,
      data_brasil = excluded.data_brasil,
      hora_brasil = excluded.hora_brasil,
      status = excluded.status,
      home_goals = excluded.home_goals,
      away_goals = excluded.away_goals,
      home_goals_ht = excluded.home_goals_ht,
      away_goals_ht = excluded.away_goals_ht,
      competition_id = excluded.competition_id,
      estadio = COALESCE(excluded.estadio, estadio),
      estadio_lat = COALESCE(excluded.estadio_lat, estadio_lat),
      estadio_lon = COALESCE(excluded.estadio_lon, estadio_lon),
      arbitro_principal = COALESCE(excluded.arbitro_principal, arbitro_principal),
      publico = COALESCE(excluded.publico, publico),
      run_id = excluded.run_id,
      source_system = excluded.source_system,
      source_version = excluded.source_version,
      payload_raw = excluded.payload_raw,
      atualizado_em = excluded.atualizado_em
  `);

  const upsertRefereeStmt = db.prepare(`
    INSERT INTO arbitros(
      statsline_id, nome, primeiro_nome, sobrenome, pais,
      run_id, source_system, source_version, payload_raw, atualizado_em
    )
    VALUES (
      @statsline_id, @nome, @primeiro_nome, @sobrenome, @pais,
      @run_id, @source_system, @source_version, @payload_raw, datetime('now')
    )
    ON CONFLICT(statsline_id) DO UPDATE SET
      nome = excluded.nome,
      primeiro_nome = excluded.primeiro_nome,
      sobrenome = excluded.sobrenome,
      pais = excluded.pais,
      run_id = excluded.run_id,
      source_system = excluded.source_system,
      source_version = excluded.source_version,
      payload_raw = excluded.payload_raw,
      atualizado_em = excluded.atualizado_em
  `);
  const upsertMatchRefereeStmt = db.prepare(`
    INSERT INTO partida_arbitro(
      id_confronto, statsline_id, tipo, nome,
      run_id, source_system, source_version, payload_raw, atualizado_em
    )
    VALUES (
      @id_confronto, @statsline_id, @tipo, @nome,
      @run_id, @source_system, @source_version, @payload_raw, datetime('now')
    )
    ON CONFLICT(id_confronto, statsline_id, tipo) DO UPDATE SET
      nome = excluded.nome,
      run_id = excluded.run_id,
      source_system = excluded.source_system,
      source_version = excluded.source_version,
      payload_raw = excluded.payload_raw,
      atualizado_em = excluded.atualizado_em
  `);

  let inserted = 0;
  let updated = 0;
  let officialsWritten = 0;
  const tx = db.transaction((items) => {
    for (const item of items) {
      const row = item.row ?? item;
      const officials = item.officials ?? [];
      const existed = Boolean(existsStmt.get(row.id_confronto));
      upsertStmt.run({ ...row, run_id: runId });
      if (existed) updated++;
      else inserted++;

      for (const official of officials) {
        const payload = { ...official, id_confronto: row.id_confronto, run_id: runId };
        upsertRefereeStmt.run(payload);
        upsertMatchRefereeStmt.run(payload);
        officialsWritten++;
      }
    }
  });
  tx(rows);

  return { inserted, updated, written: rows.length, officials_written: officialsWritten };
}

export async function extractStatslineSchedule(options = {}) {
  const liga = options.liga;
  const temporada = options.temporada;
  if (!liga || !temporada) throw new Error('missing_required_args:liga_temporada');

  const config = options.config ?? loadExtractionLeaguesConfig(options.configPath);
  const url = getConfiguredSeasonUrl(liga, temporada, options.env ?? process.env, config);
  if (!url) throw new Error(`statsline_url_not_configured:${liga}:${temporada}`);
  if (!extractTmclFromUrl(url)) throw new Error(`statsline_url_missing_tmcl:${liga}:${temporada}`);

  const rawMatches = await fetchSchedulePages(url, { fetchImpl: options.fetchImpl, maxPages: options.maxPages, env: options.env ?? process.env });
  const limitedMatches = Number.isFinite(options.limit) && options.limit > 0
    ? rawMatches.slice(0, options.limit)
    : rawMatches;

  const parsedMatches = [];
  const skipped = [];
  for (const match of limitedMatches) {
    const parsed = parseScheduleMatch(match, { liga, temporada, sourceVersion: SOURCE_VERSION });
    if (parsed.ok) parsedMatches.push(parsed);
    else skipped.push(parsed.reason);
  }

  const dryRun = options.dryRun === true;
  const runId = options.runId ?? `statsline-schedule-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const dbPath = resolveExtractionDbPath(options.dbPath);
  const summary = {
    run_id: dryRun ? null : runId,
    liga,
    temporada,
    db: dryRun ? null : dbPath,
    dry_run: dryRun,
    fetched: rawMatches.length,
    considered: limitedMatches.length,
    parsed: parsedMatches.length,
    skipped: skipped.length,
    inserted: 0,
    updated: 0,
    written: 0,
    officials_written: 0,
  };

  if (dryRun) return summary;

  applyExtractionMigrations({ dbPath });
  const db = openExtractionDb(dbPath);
  insertRunLog(db, { runId, liga, temporada, params: { liga, temporada, limit: options.limit ?? null } });
  try {
    const writeResult = upsertScheduleMatches(db, parsedMatches, { runId });
    Object.assign(summary, writeResult);
    const status = skipped.length > 0 ? 'partial' : 'ok';
    finishRunLog(db, {
      runId,
      status,
      rowsRead: limitedMatches.length,
      rowsWritten: writeResult.written,
      rowsSkipped: skipped.length,
      warningsCount: skipped.length,
      summary,
    });
    return summary;
  } catch (err) {
    finishRunLog(db, {
      runId,
      status: 'failed',
      rowsRead: limitedMatches.length,
      rowsWritten: summary.written,
      rowsSkipped: skipped.length,
      warningsCount: skipped.length,
      errorMessage: err.message,
      summary,
    });
    throw err;
  } finally {
    db.close();
  }
}

export function listStatslineScheduleTargets(config = loadExtractionLeaguesConfig(), options = {}) {
  return listExtractionSeasons(config)
    .filter((season) => options.includeDisabled === true || season.enabled !== false)
    .filter((season) => !options.liga || season.league_id === options.liga)
    .filter((season) => !options.temporada || season.season_label === options.temporada)
    .map((season) => ({
      liga: season.league_id,
      temporada: season.season_label,
    }));
}

export async function extractStatslineScheduleAll(options = {}) {
  const config = options.config ?? loadExtractionLeaguesConfig(options.configPath);
  const targets = options.targets ?? listStatslineScheduleTargets(config, options);
  const summary = {
    all: true,
    dry_run: options.dryRun === true,
    target_count: targets.length,
    ok: 0,
    failed: 0,
    fetched: 0,
    considered: 0,
    parsed: 0,
    skipped: 0,
    inserted: 0,
    updated: 0,
    written: 0,
    officials_written: 0,
    results: [],
  };

  for (const target of targets) {
    try {
      const result = await extractStatslineSchedule({
        ...options,
        liga: target.liga,
        temporada: target.temporada,
        config,
      });
      summary.ok++;
      for (const key of ['fetched', 'considered', 'parsed', 'skipped', 'inserted', 'updated', 'written', 'officials_written']) {
        summary[key] += result[key] ?? 0;
      }
      summary.results.push({ status: 'ok', ...result });
    } catch (err) {
      summary.failed++;
      summary.results.push({
        status: 'failed',
        liga: target.liga,
        temporada: target.temporada,
        error: err.message,
      });
      if (options.failFast === true) throw err;
    }
  }

  return summary;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  if (args.all) {
    const summary = await extractStatslineScheduleAll(args);
    if (args.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`[extract-statsline-schedule:all] targets=${summary.target_count} ok=${summary.ok} failed=${summary.failed} dry_run=${summary.dry_run}`);
      console.log(`[extract-statsline-schedule:all] fetched=${summary.fetched} parsed=${summary.parsed} skipped=${summary.skipped} inserted=${summary.inserted} updated=${summary.updated} written=${summary.written} officials_written=${summary.officials_written}`);
      for (const failure of summary.results.filter((item) => item.status === 'failed')) {
        console.log(`[extract-statsline-schedule:all] fail liga=${failure.liga} temporada=${failure.temporada} error=${failure.error}`);
      }
    }
    process.exitCode = summary.failed > 0 ? 1 : 0;
    return;
  }

  const summary = await extractStatslineSchedule({
    liga: args.liga,
    temporada: args.temporada,
    dbPath: args.dbPath,
    dryRun: args.dryRun,
    limit: args.limit,
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[extract-statsline-schedule] liga=${summary.liga} temporada=${summary.temporada} dry_run=${summary.dry_run}`);
    console.log(`[extract-statsline-schedule] fetched=${summary.fetched} parsed=${summary.parsed} skipped=${summary.skipped} inserted=${summary.inserted} updated=${summary.updated} written=${summary.written} officials_written=${summary.officials_written}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[extract-statsline-schedule] fatal: ${err.message}`);
    process.exitCode = 1;
  });
}
