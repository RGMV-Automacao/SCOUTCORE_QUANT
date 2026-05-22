import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { canonicalizeMarketKey } from '@scoutcore/markets';
import {
  applyExtractionMigrations,
  checkpointExtractionDb,
  openExtractionDb,
  resolveExtractionDbPath,
} from './lib/extraction-db.mjs';
import { resolveToOriginal } from '../apps/jobs/src/statsline-team-resolver.mjs';

const SOURCE_VERSION = 'legacy-bookline-import-v1';
const DEFAULT_BATCH_SIZE = 5000;
const DEFAULT_PROGRESS_EVERY = 50000;

const LIGA_ALIASES = Object.freeze({
  brasileiro: 'brasileirao',
  brasileirao: 'brasileirao',
  brasileirob: 'brasileirao-b',
  'brasileirao-b': 'brasileirao-b',
  premier: 'premier-league',
  'premier-league': 'premier-league',
  laliga: 'la-liga',
  'la-liga': 'la-liga',
  laliga2: 'la-liga-2',
  'la-liga-2': 'la-liga-2',
  seriea: 'serie-a',
  'serie-a': 'serie-a',
  serieb: 'serie-b-italia',
  'serie-b-italia': 'serie-b-italia',
  ligue1: 'ligue-1',
  'ligue-1': 'ligue-1',
  bundesliga: 'bundesliga',
  championship: 'championship',
  ligamx: 'liga-mx',
  'liga-mx': 'liga-mx',
  argentina: 'superliga-argentina',
  'superliga-argentina': 'superliga-argentina',
  'primeira-liga': 'primeira-liga',
});

const TOTAL_FAMILY_MAP = Object.freeze({
  'Total de Gols': 'gols',
  'Total de Gols Asiatico': 'asian_total',
  'Total de Escanteios': 'escanteios',
  'Total de Cartoes': 'cartoes',
  'Total de Cartoes Vermelhos': 'cartoes_vermelhos',
  'Total de Faltas': 'faltas',
  'Total de Impedimentos': 'impedimentos',
  'Total de Finalizacoes': 'chutes',
  'Total de Chutes no Gol': 'chutes_alvo',
  'Total de Defesas do Goleiro': 'defesas',
  'Total de Desarmes': 'desarmes',
});

const TEAM_TOTAL_FAMILY_MAP = Object.freeze({
  'Total de Gols da Equipe': 'gols',
  'Total de Gols do Time': 'gols',
  'Total de Escanteios da Equipe': 'escanteios',
  'Total de Cartoes da Equipe': 'cartoes',
  'Total de Chutes no Gol da Equipe': 'chutes_alvo',
  'Chutes no Gol Totais da Equipe': 'chutes_alvo',
  'Total de Finalizacoes da Equipe': 'chutes',
  'Finalizacoes Totais da Equipe': 'chutes',
  'Total de Faltas da Equipe': 'faltas',
  'Total de Impedimentos da Equipe': 'impedimentos',
  'Total de Defesas do Goleiro da Equipe': 'defesas',
  'Total de Desarmes da Equipe': 'desarmes',
});

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    batchSize: DEFAULT_BATCH_SIZE,
    progressEvery: DEFAULT_PROGRESS_EVERY,
    reset: false,
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === '--reset') out.reset = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg.startsWith('--legacy-db=')) out.legacyDbPath = arg.slice(12);
    else if (arg.startsWith('--liga=')) out.liga = arg.slice(7);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8));
    else if (arg.startsWith('--batch-size=')) out.batchSize = Number(arg.slice(13));
    else if (arg.startsWith('--progress-every=')) out.progressEvery = Number(arg.slice(17));
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/migrate-legacy-bookline-odds.mjs [--db=data/scout_extraction.db] [--legacy-db=C:/.../opta.db] [--liga=brasileirao] [--limit=N] [--reset] [--dry-run] [--json]');
}

function resolveLegacyDbPath(input) {
  const raw = input || process.env.STATSLINE_LEGACY_DB;
  if (!raw) throw new Error('missing_required_env:STATSLINE_LEGACY_DB');
  const abs = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  if (!existsSync(abs)) throw new Error(`legacy_db_not_found:${abs}`);
  return abs;
}

function normalizeAscii(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizeLegacyLiga(raw) {
  const key = normalizeAscii(raw).toLowerCase().replace(/[^a-z0-9-]+/g, '');
  return LIGA_ALIASES[key] || String(raw || '').trim() || null;
}

function normalizeTeamKey(name) {
  return normalizeAscii(resolveToOriginal(name || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeadingKey(heading) {
  return normalizeAscii(heading).replace(/\s+/g, ' ').trim();
}

function getHomeTeam(row) {
  return row?.home_team ?? row?.equipe_home ?? null;
}

function getAwayTeam(row) {
  return row?.away_team ?? row?.equipe_away ?? null;
}

function extractDate(row) {
  const candidates = [row?.data_jogo, row?.data_brasil, row?.data_iso];
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (value.length >= 10) return value.slice(0, 10);
  }
  return null;
}

function extractSourceEventId(urlPartida, fixtureId) {
  const fixture = Number.parseInt(fixtureId, 10);
  if (Number.isFinite(fixture) && fixture > 0) return String(fixture);
  const url = String(urlPartida || '').trim();
  const match = url.match(/-(\d+)(?:\/)?$/);
  return match?.[1] || null;
}

function toLineTag(line) {
  if (line == null) return null;
  const raw = String(line).trim().replace(',', '.');
  if (!raw) return null;
  return raw.replace(/\./g, '_').replace(/[^0-9_+-]/g, '');
}

function toSignedLineTag(line) {
  const numeric = Number.parseFloat(String(line ?? '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  const sign = numeric < 0 ? 'minus' : 'plus';
  const abs = String(Math.abs(numeric)).replace('.', '_');
  return `${sign}_${abs}`;
}

function parseDirectionAndLine(row) {
  const selectionRaw = normalizeHeadingKey(row?.selecao).toLowerCase();
  const lineRaw = String(row?.linha || '').trim().replace(',', '.');
  const line = lineRaw || (selectionRaw.match(/(?:mais|menos) de\s+(-?[0-9]+(?:\.[0-9]+)?)/)?.[1] ?? null);
  if (!line) return null;
  if (selectionRaw === 'mais' || selectionRaw.startsWith('mais de ')) return { direction: 'over', line };
  if (selectionRaw === 'menos' || selectionRaw.startsWith('menos de ')) return { direction: 'under', line };
  return null;
}

function extractTeamFromSelection(selection) {
  const raw = normalizeHeadingKey(selection);
  const withoutDirection = raw.replace(/^(mais|menos|over|under)(?:\s+de)?\s+/i, '').trim();
  if (!withoutDirection || /^[-+]?\d/.test(withoutDirection)) return null;
  return withoutDirection;
}

function parseTeamDirectionAndLine(row) {
  const selectionRaw = normalizeHeadingKey(row?.selecao).toLowerCase();
  const lineRaw = String(row?.linha || '').trim().replace(',', '.');
  const line = lineRaw || (selectionRaw.match(/(?:mais|menos) de\s+(-?[0-9]+(?:\.[0-9]+)?)/)?.[1] ?? null);
  if (!line) return null;
  if (selectionRaw === 'mais' || selectionRaw.startsWith('mais ') || selectionRaw.startsWith('mais de ') || selectionRaw.startsWith('over ')) return { direction: 'over', line };
  if (selectionRaw === 'menos' || selectionRaw.startsWith('menos ') || selectionRaw.startsWith('menos de ') || selectionRaw.startsWith('under ')) return { direction: 'under', line };
  return null;
}

function periodAndHeading(rawHeading) {
  const heading = normalizeHeadingKey(rawHeading);
  if (/^1[º°o] Tempo -\s*/.test(heading)) return { period: 'ht', heading: heading.replace(/^1[º°o] Tempo -\s*/, '') };
  if (/^2[º°o] Tempo -\s*/.test(heading)) return { period: '2t', heading: heading.replace(/^2[º°o] Tempo -\s*/, '') };
  return { period: 'ft', heading };
}

function map1x2Selection(selection) {
  const value = normalizeHeadingKey(selection).toLowerCase();
  if (value === '1') return 'home';
  if (value === 'x') return 'draw';
  if (value === '2') return 'away';
  if (value === 'empate') return 'draw';
  return null;
}

function map1x2SelectionWithTeams(row) {
  const direct = map1x2Selection(row?.selecao);
  if (direct) return direct;
  const selectedTeam = normalizeTeamKey(row?.selecao);
  if (!selectedTeam) return null;
  if (selectedTeam === normalizeTeamKey(getHomeTeam(row))) return 'home';
  if (selectedTeam === normalizeTeamKey(getAwayTeam(row))) return 'away';
  return null;
}

function mapDuplaSelection(selection) {
  const value = normalizeHeadingKey(selection).toLowerCase();
  if (value === '1x' || value === '1 ou empate') return '1x';
  if (value === '12' || value === '1 ou 2') return '12';
  if (value === 'x2' || value === 'empate ou 2') return 'x2';
  return null;
}

function resolveTeamSide(row) {
  const scope = String(row?.scope || '').toLowerCase();
  if (scope === 'equipe_home' || scope === 'home') return 'home';
  if (scope === 'equipe_away' || scope === 'away') return 'away';
  const team = normalizeTeamKey(row?.team_tab || row?.team || row?.time || row?.selection_team || extractTeamFromSelection(row?.selecao));
  if (!team) return null;
  if (team === normalizeTeamKey(getHomeTeam(row))) return 'home';
  if (team === normalizeTeamKey(getAwayTeam(row))) return 'away';
  return null;
}

function inferLabelMarketKey(row, { heading, period }) {
  const direction = map1x2SelectionWithTeams(row);
  if (!direction) return null;
  if (heading === 'Equipe Com Mais Escanteios (1X2)' || heading === 'Time com Mais Escanteios') {
    return canonicalizeMarketKey(`escanteios_1x2_total_${period}_${direction}`);
  }
  if (heading === 'Cartoes 1X2' || heading === 'Cartões 1X2' || heading === 'Equipe com Mais Cartoes (1X2)' || heading === 'Equipe com Mais Cartões (1X2)') {
    return canonicalizeMarketKey(`cartoes_1x2_total_${period}_${direction}`);
  }
  if (heading === 'Equipe Com Mais Chutes no Gol (1X2)') {
    return canonicalizeMarketKey(`chutes_alvo_1x2_total_${period}_${direction}`);
  }
  if (heading === 'Equipe Com Mais Finalizações (1X2)' || heading === 'Equipe Com Mais Finalizacoes (1X2)' || heading === 'Finalizacoes 1X2') {
    return canonicalizeMarketKey(`chutes_1x2_total_${period}_${direction}`);
  }
  return null;
}

function inferOddEvenMarketKey({ heading, period, selection }) {
  const normalizedSelection = normalizeHeadingKey(selection).toLowerCase();
  const direction = normalizedSelection === 'par' ? 'par'
    : normalizedSelection === 'impar' || normalizedSelection === 'ímpar' ? 'impar'
      : null;
  if (!direction) return null;
  if (heading === 'Total de Gols Impar/Par') return canonicalizeMarketKey(`gols_oddeven_total_${period}_${direction}`);
  if (heading === 'Impar/Par - Escanteios' || heading === 'Escanteios Impar/Par') return canonicalizeMarketKey(`escanteios_oddeven_total_${period}_${direction}`);
  return null;
}

function inferHandicapMarketKey(row, { period, heading }) {
  const overUnder = parseDirectionAndLine(row);
  if (!overUnder?.line) return null;
  const side = resolveTeamSide(row);
  if (!side) return null;
  const lineTag = toSignedLineTag(overUnder.line);
  if (!lineTag) return null;
  if (heading === 'Handicap') {
    return canonicalizeMarketKey(`asian_handicap_total_${period}_${side}_${lineTag}`);
  }
  if (heading === 'Handicap de Escanteio' || heading === 'Escanteios - Handicap') {
    return canonicalizeMarketKey(`escanteios_handicap_total_${period}_${side}_${lineTag}`);
  }
  return null;
}

function inferCanonicalMarketKey(row) {
  const rawHeading = String(row?.mercado || '').trim();
  if (!rawHeading) return null;
  const { period, heading } = periodAndHeading(rawHeading);
  const selection = normalizeHeadingKey(row?.selecao).toLowerCase();

  if (heading === 'Resultado Final' || heading === 'Resultado Final (1X2)' || heading === 'Resultado (1X2)') {
    const direction = map1x2SelectionWithTeams(row);
    if (direction) return canonicalizeMarketKey(`resultado_1x2_${period}_${direction}`);
  }

  if (heading === 'Dupla Chance') {
    const dupla = mapDuplaSelection(row?.selecao);
    if (dupla) return canonicalizeMarketKey(`resultado_dupla_${period}_${dupla}`);
  }

  if (heading.endsWith('Ambas as Equipes Marcam') && (selection === 'sim' || selection === 'nao' || selection === 'não')) {
    return canonicalizeMarketKey(`btts_${period}_${selection === 'não' ? 'nao' : selection}`);
  }

  if (heading === 'Ambas as Equipes Marcam 2 ou Mais Gols' && (selection === 'sim' || selection === 'nao' || selection === 'não')) {
    return canonicalizeMarketKey(`btts_2plus_total_${period}_${selection === 'não' ? 'nao' : selection}`);
  }

  const labelKey = inferLabelMarketKey(row, { heading, period });
  if (labelKey) return labelKey;

  const oddEvenKey = inferOddEvenMarketKey({ heading, period, selection: row?.selecao });
  if (oddEvenKey) return oddEvenKey;

  const handicapKey = inferHandicapMarketKey(row, { period, heading });
  if (handicapKey) return handicapKey;

  const teamFamily = TEAM_TOTAL_FAMILY_MAP[heading];
  const teamOverUnder = parseTeamDirectionAndLine(row);
  if (teamFamily && teamOverUnder) {
    const side = resolveTeamSide(row);
    if (side) return canonicalizeMarketKey(`${teamFamily}_${side}_${period}_${teamOverUnder.direction}_${toLineTag(teamOverUnder.line)}`);
  }

  const overUnder = parseDirectionAndLine(row);
  const family = TOTAL_FAMILY_MAP[heading];
  if (family && overUnder) {
    return canonicalizeMarketKey(`${family}_total_${period}_${overUnder.direction}_${toLineTag(overUnder.line)}`);
  }

  return null;
}

function fallbackRawMarketKey(row) {
  const token = createHash('sha1')
    .update([
      normalizeHeadingKey(row?.mercado),
      normalizeTeamKey(row?.team_tab || row?.team || row?.time || row?.selection_team) || normalizeHeadingKey(row?.scope),
      normalizeHeadingKey(row?.selecao),
      String(row?.linha || '').trim(),
    ].join('|'))
    .digest('hex')
    .slice(0, 24);
  return `legacy_raw_${token}`;
}

export function inferMarketKey(row) {
  return inferCanonicalMarketKey(row) || fallbackRawMarketKey(row);
}

function buildQuoteHash(row, normalizedLiga, { includeColeta }) {
  const eventId = extractSourceEventId(row.url_partida, row.fixture_id) || '';
  const teamScopeIdentity = normalizeTeamKey(row.team_tab || row.team || row.time || row.selection_team) || normalizeHeadingKey(row.scope);
  return createHash('sha1')
    .update([
      'bookline',
      ...(includeColeta ? [String(row.coleta_id || '').trim()] : [String(row.id_confronto || '').trim()]),
      eventId,
      normalizedLiga || '',
      extractDate(row) || '',
      normalizeTeamKey(getHomeTeam(row)),
      normalizeTeamKey(getAwayTeam(row)),
      normalizeHeadingKey(row.mercado),
      teamScopeIdentity,
      normalizeHeadingKey(row.selecao),
      String(row.linha || '').trim(),
    ].join('|'))
    .digest('hex');
}

export function buildQuoteKey(row, normalizedLiga) {
  const token = buildQuoteHash(row, normalizedLiga, { includeColeta: true });
  return `bookline_${token}`;
}

export function buildQuoteSignature(row, normalizedLiga) {
  const token = buildQuoteHash(row, normalizedLiga, { includeColeta: false });
  return `bookline_sig_${token}`;
}

function buildPartidaLookup(db) {
  const rows = db.prepare(`
    SELECT id_confronto, liga, home_team, away_team, data_partida, data_brasil
      FROM partidas
     WHERE home_team IS NOT NULL
       AND away_team IS NOT NULL
  `).all();

  const exact = new Map();
  const relaxed = new Map();
  const pushUnique = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const row of rows) {
    const liga = normalizeLegacyLiga(row.liga) || row.liga;
    const home = normalizeTeamKey(row.home_team);
    const away = normalizeTeamKey(row.away_team);
    if (!home || !away) continue;
    for (const dateValue of [row.data_partida, row.data_brasil]) {
      const date = String(dateValue || '').slice(0, 10);
      if (!date) continue;
      const exactKey = `${liga}|${date}|${home}|${away}`;
      const relaxedKey = `${date}|${home}|${away}`;
      pushUnique(exact, exactKey, row.id_confronto);
      pushUnique(relaxed, relaxedKey, row.id_confronto);
    }
  }

  for (const [key, ids] of exact) exact.set(key, [...ids]);
  for (const [key, ids] of relaxed) relaxed.set(key, [...ids]);
  return { exact, relaxed };
}

function resolveMatchId(lookup, row, normalizedLiga) {
  const date = extractDate(row);
  if (!date) return null;
  const home = normalizeTeamKey(getHomeTeam(row));
  const away = normalizeTeamKey(getAwayTeam(row));
  if (!home || !away) return null;

  const exactKey = `${normalizedLiga || ''}|${date}|${home}|${away}`;
  const exactMatches = lookup.exact.get(exactKey) || [];
  if (exactMatches.length === 1) return exactMatches[0];

  const relaxedKey = `${date}|${home}|${away}`;
  const relaxedMatches = lookup.relaxed.get(relaxedKey) || [];
  return relaxedMatches.length === 1 ? relaxedMatches[0] : null;
}

function buildScope(args) {
  const clauses = [];
  const params = [];
  if (args.liga) {
    clauses.push('(liga = ? OR liga_betmines = ?)');
    params.push(args.liga, args.liga);
  }
  return {
    where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function loadColetaSummaries(legacyDb, scope) {
  return legacyDb.prepare(`
    SELECT coleta_id,
           MIN(criado_em) AS janela_inicio,
           MAX(criado_em) AS janela_fim,
           COUNT(*) AS odds_written,
           COUNT(DISTINCT COALESCE(data_jogo, '') || '|' || home_team || '|' || away_team) AS matches_checked,
           CASE WHEN COUNT(DISTINCT liga) = 1 THEN MIN(liga) ELSE NULL END AS liga
      FROM odds
     WHERE coleta_id IS NOT NULL
       AND coleta_id != ''${scope.where.replace(' WHERE ', ' AND ')}
     GROUP BY coleta_id
  `).all(...scope.params);
}

export async function migrateLegacyBooklineOdds(options = {}) {
  const dbPath = resolveExtractionDbPath(options.dbPath);
  const legacyDbPath = resolveLegacyDbPath(options.legacyDbPath);
  applyExtractionMigrations({ dbPath });
  const db = openExtractionDb(dbPath);
  const legacyDb = new Database(legacyDbPath, { readonly: true, fileMustExist: true });

  const runId = `legacy-bookline-import-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const scope = buildScope(options);
  const coletaSummaries = loadColetaSummaries(legacyDb, scope);
  const partidaLookup = buildPartidaLookup(db);
  const limitSql = Number.isFinite(options.limit) && options.limit > 0 ? ' LIMIT ?' : '';
  const rowParams = [...scope.params];
  if (limitSql) rowParams.push(options.limit);

  const totalLegacyOdds = legacyDb.prepare(`SELECT COUNT(*) AS count FROM odds${scope.where}`).get(...scope.params).count;
  const summary = {
    run_id: runId,
    dbPath,
    legacyDbPath,
    dry_run: options.dryRun === true,
    reset: options.reset === true,
    liga: options.liga ?? null,
    total_legacy_odds: totalLegacyOdds,
    total_coletas: coletaSummaries.length,
    odds_written: 0,
    coletas_written: 0,
    matched_partidas: 0,
    unmatched_partidas: 0,
    canonical_market_keys: 0,
    raw_market_keys: 0,
    skipped_invalid_odd: 0,
    samples_unmatched: [],
  };

  if (options.dryRun === true) {
    legacyDb.close();
    db.close();
    return summary;
  }

  const upsertColeta = db.prepare(`
    INSERT INTO odds_coletas(
      coleta_id, source_system, source_version, liga, janela_inicio, janela_fim,
      status, started_at, finished_at, matches_checked, events_matched,
      odds_written, warnings_count, error_message, params_json, summary_json
    ) VALUES (
      @coleta_id, 'bookline', @source_version, @liga, @janela_inicio, @janela_fim,
      'ok', @started_at, @finished_at, @matches_checked, @events_matched,
      @odds_written, 0, NULL, @params_json, @summary_json
    )
    ON CONFLICT(coleta_id) DO UPDATE SET
      source_version = excluded.source_version,
      liga = excluded.liga,
      janela_inicio = excluded.janela_inicio,
      janela_fim = excluded.janela_fim,
      finished_at = excluded.finished_at,
      matches_checked = excluded.matches_checked,
      events_matched = excluded.events_matched,
      odds_written = excluded.odds_written,
      params_json = excluded.params_json,
      summary_json = excluded.summary_json
  `);
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

  const resetTx = db.transaction(() => {
    db.prepare('DELETE FROM odds_historico').run();
    db.prepare('DELETE FROM odds').run();
    db.prepare('DELETE FROM odds_coletas').run();
  });
  const importColetasTx = db.transaction((rows) => {
    for (const row of rows) {
      upsertColeta.run({
        coleta_id: row.coleta_id,
        source_version: SOURCE_VERSION,
        liga: normalizeLegacyLiga(row.liga) || row.liga || null,
        janela_inicio: row.janela_inicio,
        janela_fim: row.janela_fim,
        started_at: row.janela_inicio,
        finished_at: row.janela_fim,
        matches_checked: row.matches_checked,
        events_matched: row.matches_checked,
        odds_written: row.odds_written,
        params_json: JSON.stringify({ imported_from: 'legacy_db.odds', legacy_db: legacyDbPath }),
        summary_json: JSON.stringify({ odds_written: row.odds_written, matches_checked: row.matches_checked }),
      });
      summary.coletas_written++;
    }
  });
  const importOddsBatchTx = db.transaction((rows) => {
    for (const row of rows) {
      const odd = Number.parseFloat(row.odd);
      if (!Number.isFinite(odd) || odd <= 1.0) {
        summary.skipped_invalid_odd++;
        continue;
      }
      const liga = normalizeLegacyLiga(row.liga || row.liga_betmines) || String(row.liga || row.liga_betmines || 'unknown').trim();
      const mercado_key = inferMarketKey(row);
      const id_confronto = resolveMatchId(partidaLookup, row, liga);
      const quote_key = buildQuoteKey({ ...row, id_confronto }, liga);
      const quote_signature = buildQuoteSignature({ ...row, id_confronto }, liga);
      if (mercado_key.startsWith('legacy_raw_')) summary.raw_market_keys++;
      else summary.canonical_market_keys++;
      if (id_confronto) summary.matched_partidas++;
      else {
        summary.unmatched_partidas++;
        if (summary.samples_unmatched.length < 10) {
          summary.samples_unmatched.push({
            home_team: getHomeTeam(row),
            away_team: getAwayTeam(row),
            data_jogo: extractDate(row),
            liga,
            mercado: row.mercado,
          });
        }
      }
      upsertOdd.run({
        quote_key,
        snapshot_id: quote_key,
        quote_signature,
        id_confronto,
        source_event_id: extractSourceEventId(row.url_partida, row.fixture_id),
        source_version: SOURCE_VERSION,
        liga,
        home_team: getHomeTeam(row),
        away_team: getAwayTeam(row),
        data_jogo: extractDate(row),
        mercado_key,
        mercado: row.mercado,
        selecao: row.selecao,
        linha: row.linha != null ? String(row.linha) : null,
        odd,
        coleta_id: row.coleta_id,
        payload_raw: JSON.stringify({
          legacy_id: row.id,
          fonte: row.fonte,
          liga_betmines: row.liga_betmines,
          league_id: row.league_id,
          fixture_id: row.fixture_id,
          data_iso: row.data_iso,
          prob_betmines: row.prob_betmines,
          ev_pct: row.ev_pct,
          fair_odd: row.fair_odd,
          categoria: row.categoria,
          url_partida: row.url_partida,
          data_brasil: row.data_brasil,
          hora_brasil: row.hora_brasil,
        }),
        criado_em: row.criado_em,
      });
      summary.odds_written++;
    }
  });

  if (options.reset === true) resetTx();
  importColetasTx(coletaSummaries);

  const iterator = legacyDb.prepare(`
    SELECT id, fonte, home_team, away_team, liga, liga_betmines, league_id, fixture_id,
           data_jogo, data_iso, mercado, selecao, linha, odd, prob_betmines,
           ev_pct, fair_odd, categoria, url_partida, coleta_id, criado_em,
           data_brasil, hora_brasil
      FROM odds${scope.where}
     ORDER BY id${limitSql}
  `).iterate(...rowParams);

  const batchSize = Number.isFinite(options.batchSize) && options.batchSize > 0 ? options.batchSize : DEFAULT_BATCH_SIZE;
  const progressEvery = Number.isFinite(options.progressEvery) && options.progressEvery > 0 ? options.progressEvery : DEFAULT_PROGRESS_EVERY;
  const startedAt = Date.now();
  let batch = [];
  for (const row of iterator) {
    batch.push(row);
    if (batch.length >= batchSize) {
      importOddsBatchTx(batch);
      batch = [];
      if (!options.json && summary.odds_written > 0 && summary.odds_written % progressEvery < batchSize) {
        const elapsedSec = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const rate = (summary.odds_written / elapsedSec).toFixed(0);
        console.log(`[migrate-legacy-bookline-odds] imported=${summary.odds_written}/${totalLegacyOdds} matched=${summary.matched_partidas} raw_keys=${summary.raw_market_keys} rate=${rate}/s`);
      }
    }
  }
  if (batch.length > 0) importOddsBatchTx(batch);

  summary.elapsed_ms = Date.now() - startedAt;
  summary.target_odds_count = db.prepare('SELECT COUNT(*) AS count FROM odds').get().count;
  summary.target_coletas_count = db.prepare('SELECT COUNT(*) AS count FROM odds_coletas').get().count;
  summary.checkpoint = checkpointExtractionDb(db);
  legacyDb.close();
  db.close();
  return summary;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  const summary = await migrateLegacyBooklineOdds(args);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[migrate-legacy-bookline-odds] legacy=${summary.legacyDbPath}`);
    console.log(`[migrate-legacy-bookline-odds] odds=${summary.odds_written}/${summary.total_legacy_odds} coletas=${summary.coletas_written}/${summary.total_coletas} matched_partidas=${summary.matched_partidas} unmatched_partidas=${summary.unmatched_partidas}`);
    console.log(`[migrate-legacy-bookline-odds] canonical_keys=${summary.canonical_market_keys} raw_keys=${summary.raw_market_keys} invalid_odds=${summary.skipped_invalid_odd} elapsed_ms=${summary.elapsed_ms ?? 0}`);
    if (summary.samples_unmatched.length > 0) {
      console.log('[migrate-legacy-bookline-odds] unmatched_samples');
      console.table(summary.samples_unmatched);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[migrate-legacy-bookline-odds] fatal: ${err.message}`);
    process.exitCode = 1;
  });
}