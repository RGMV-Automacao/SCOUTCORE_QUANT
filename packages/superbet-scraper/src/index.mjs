// @scoutcore/superbet-scraper — ESM facade sobre os módulos .cjs do scraper.
// Reescrita ESM de odds-service.js (legado opta-extractor/motor) — self-contained.
//
// Exporta:
//   - fetchEventList, fetchEventDetails        (HTTP cliente Superbet)
//   - eventToRawEntries                        (payload API → rawEntries)
//   - parseRawEntries                          (rawEntries → records normalizados)
//   - TOURNAMENT_IDS, getTournamentIdsForLiga  (liga → tournamentId)
//   - fetchOddsSnapshot                        (high-level: home/away/liga/date → snapshot canônico)
//   - fetchOddsRecords                         (high-level: home/away/liga/date → records crus PT)
//   - recordToPortugueseRow                    (denormalização record → mercado/selecao/linha)

import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { canonicalizeMarketKey } from '@scoutcore/markets';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _require = createRequire(import.meta.url);

const { fetchEventList, fetchEventDetails } = _require(resolve(__dirname, 'scraper', 'sb-api-client.cjs'));
const { eventToRawEntries }                 = _require(resolve(__dirname, 'scraper', 'sb-api-adapter.cjs'));
const { parseRawEntries }                   = _require(resolve(__dirname, 'scraper', 'sb-odds-parser.cjs'));

export { fetchEventList, fetchEventDetails, eventToRawEntries, parseRawEntries };

// ── Liga → Superbet tournamentId ─────────────────────────────────────────────
// IDs verificados (espelhados de opta-extractor/motor/odds-service.js).
export const TOURNAMENT_IDS = Object.freeze({
  'brasileirao':          1698,
  'brasileirao-b':        1697,
  'serie-a':              104,
  'premier-league':       106,
  'la-liga':              98,
  'la-liga-2':            191,
  'bundesliga':           245,
  'ligue-1':              100,
  'superliga-argentina':  84092,
  'liga-mx':              83,
  'primeira-liga':        142,
  'serie-b-italia':       244,
  'championship':         27,
});

export const TOURNAMENT_ID_CANDIDATES = Object.freeze({
  'championship':           [27, 1608],
  'championship-mata-mata': [27, 1608],
  'liga-mx':                [83, 1095],
  'liga-mx-clausura':       [83, 1095],
  'ligamx':                 [83, 1095],
});

const LEAGUE_ID_ALIASES = Object.freeze({ 'ligamx': 'liga-mx' });

export function getTournamentIdsForLiga(liga) {
  const rawKey = String(liga || '').trim();
  const canonicalKey = LEAGUE_ID_ALIASES[rawKey] || rawKey;
  const candidates = TOURNAMENT_ID_CANDIDATES[rawKey]
    || TOURNAMENT_ID_CANDIDATES[canonicalKey]
    || [TOURNAMENT_IDS[rawKey] || TOURNAMENT_IDS[canonicalKey]];
  return [...new Set(candidates.filter(Boolean).map(Number))];
}

// ── Fuzzy match de times ─────────────────────────────────────────────────────
function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const TEAM_TOKEN_NOISE = new Set([
  'fc','sc','cf','ac','sk','if','bk','sv','ec','ca','cs',
  'mg','sp','rj','rs','pr','ba','pe','go','ce','df','am',
  'city','town','united','utd','de','do','da','dos','das','la','el','los','las',
  'jr','b','ii','iii',
]);

function _teamTokens(s) {
  return stripDiacritics(s).split(/[\s\-/.()]+/).filter(Boolean);
}

function _isStrictSubset(a, b) {
  const bSet = new Set(b);
  let significant = 0;
  for (const tok of a) {
    if (!bSet.has(tok)) return false;
    if (!TEAM_TOKEN_NOISE.has(tok) && tok.length >= 3) significant++;
  }
  return significant >= 1;
}

function teamsMatch(apiName, dbName) {
  if (!apiName || !dbName) return false;
  const a = stripDiacritics(apiName);
  const b = stripDiacritics(dbName);
  if (a === b) return true;
  const tokA = _teamTokens(apiName);
  const tokB = _teamTokens(dbName);
  if (tokA.length && tokB.length) {
    if (_isStrictSubset(tokA, tokB) || _isStrictSubset(tokB, tokA)) return true;
  }
  return false;
}

function findEventId(events, home, away, requestedDate) {
  for (const ev of events) {
    const name = ev.matchName || ev.name || '';
    const parts = name.split(/\s*[·•—–-]\s*/);
    if (parts.length < 2) continue;
    const [evHome, evAway] = parts;
    if (!teamsMatch(evHome, home) || !teamsMatch(evAway, away)) continue;
    if (requestedDate && ev.matchDate) {
      const evDate = ev.matchDate.slice(0, 10);
      const diffDays = Math.abs(new Date(evDate) - new Date(requestedDate)) / 86400000;
      if (diffDays > 1) continue;
    }
    return ev.eventId || ev.id || null;
  }
  return null;
}

// ── Cache leve do eventList (mesma janela do legado) ─────────────────────────
const EVENT_LIST_CACHE_TTL_MS = Math.max(30_000, Number(process.env.SUPERBET_EVENT_LIST_CACHE_MS || 120_000));
const eventListCache = new Map();

async function fetchCachedEventList({ tournamentId, date }) {
  const key = `${tournamentId}|${date}`;
  const now = Date.now();
  const cached = eventListCache.get(key);
  if (cached && now - cached.ts < EVENT_LIST_CACHE_TTL_MS) {
    if (cached.promise) return cached.promise;
    return cached.events;
  }
  const promise = fetchEventList({ tournamentId, date })
    .then((events) => { eventListCache.set(key, { ts: Date.now(), events }); return events; })
    .catch((err) => { eventListCache.delete(key); throw err; });
  eventListCache.set(key, { ts: now, promise });
  return promise;
}

// ── Denormalização record → linha PT (mercado/selecao/linha) ────────────────
// Espelha o vocabulário que apps/api/src/routes/runs.mjs:mapOddsKey lê.
// Retorna null para records que não cabem na tabela odds atual (scope!=total,
// handicap puro, outcomes 'gol'/'semgol', etc).
export function recordToPortugueseRow(rec) {
  if (!rec || !rec.heading || !rec.outcome) return null;
  // Tabela odds atual só guarda escopo agregado.
  if (rec.scope && rec.scope !== 'total') return null;

  const mercado = rec.heading;
  const outcome = rec.outcome;

  // Over/under
  if (outcome === 'mais' || outcome === 'menos') {
    if (rec.line == null) return null;
    const lineStr = rec.line_str || String(rec.line);
    const selecao = (outcome === 'mais' ? 'Mais de ' : 'Menos de ') + lineStr;
    return { mercado, selecao, linha: lineStr };
  }

  // BTTS (label sim/nao)
  if (outcome === 'sim') return { mercado, selecao: 'Sim',  linha: null };
  if (outcome === 'nao') return { mercado, selecao: 'Não',  linha: null };

  // 1X2 e Dupla Chance literais
  if (['1', 'X', '2', '1X', '12', 'X2'].includes(outcome)) {
    return { mercado, selecao: outcome, linha: null };
  }

  return null;
}

// ── High-level: snapshot canônico (compat com legado) ────────────────────────
// Mantém o formato { market_key: odd } usado por consumidores antigos.
// Cobre apenas as 4 famílias do legado (gols, btts, 1x2, dupla); para cobertura
// completa use fetchOddsRecords + recordToPortugueseRow.
export async function fetchOddsSnapshot({ home, away, liga, date }) {
  const { records, warnings, event_id } = await fetchOddsRecords({ home, away, liga, date });
  const odds_snapshot = {};
  for (const rec of records) {
    const mk = canonicalMarketKey(rec);
    if (!mk) continue;
    if (!odds_snapshot[mk] || rec.odd > odds_snapshot[mk]) odds_snapshot[mk] = rec.odd;
  }
  return { odds_snapshot, event_id, markets_found: Object.keys(odds_snapshot).length, warnings };
}

function canonicalMarketKey(rec) {
  const { family, scope, period, outcome, line, heading } = rec;
  const pLow = String(period || 'FT').toLowerCase();
  if (scope === 'equipe') return null;
  if (outcome === 'mais' || outcome === 'menos') {
    if (line == null || !Number.isFinite(Number(line))) return null;
    const direction = outcome === 'mais' ? 'over' : 'under';
    const lineNoDot = String(line).replace('.', '_');
    return canonicalizeMarketKey(`${family}_${scope}_${pLow}_${direction}_${lineNoDot}`);
  }
  if (family === 'gols' && scope === 'total' && (outcome === 'sim' || outcome === 'nao')) {
    if (!/Ambas as Equipes Marcam$/.test(heading)) return null;
    return canonicalizeMarketKey(`btts_${pLow}_${outcome}`);
  }
  if (family === 'resultado' && ['1', 'X', '2'].includes(outcome)) {
    const dir = outcome === '1' ? 'home' : outcome === 'X' ? 'draw' : 'away';
    return canonicalizeMarketKey(`resultado_1x2_${pLow}_${dir}`);
  }
  if (family === 'resultado' && ['1X', '12', 'X2'].includes(outcome)) {
    return canonicalizeMarketKey(`resultado_dupla_${pLow}_${outcome.toLowerCase()}`);
  }
  return null;
}

// ── High-level: records crus (PT) prontos para a tabela odds ─────────────────
// Retorna a lista completa de records do parser, com warnings de diagnóstico.
export async function fetchOddsRecords({ home, away, liga, date }) {
  const warnings = [];
  const empty = { records: [], event_id: null, warnings };

  const tournamentIds = getTournamentIdsForLiga(liga);
  if (!tournamentIds.length) {
    warnings.push(`liga_sem_tournament_id:${liga}`);
    return empty;
  }

  const diagnostics = [];
  const misses = [];

  for (const tournamentId of tournamentIds) {
    let events;
    try {
      events = await fetchCachedEventList({ tournamentId, date });
    } catch (err) {
      warnings.push(`fetchEventList_falhou:${tournamentId}:${err.message}`);
      continue;
    }
    diagnostics.push(`${tournamentId}:${events.length}`);
    if (!events.length) continue;

    const eventId = findEventId(events, home, away, date);
    if (!eventId) {
      misses.push(...events.slice(0, 8).map((e) => `${e.matchName || e.eventId}(${(e.matchDate || '').slice(0, 10)})`));
      continue;
    }
    if (tournamentId !== tournamentIds[0]) warnings.push(`tournament_id_fallback:${liga}:${tournamentId}`);

    let payload;
    try {
      payload = await fetchEventDetails(eventId);
    } catch (err) {
      warnings.push(`fetchEventDetails_falhou:${err.message}`);
      return { ...empty, event_id: String(eventId), warnings };
    }

    const rawEntries = eventToRawEntries(payload, { homeTeam: home, awayTeam: away });
    const { records, skipped } = parseRawEntries(rawEntries, {
      homeTeam: home, awayTeam: away, matchId: 0, runId: 'scoutcore',
    });
    if (skipped.length > 0) warnings.push(`${skipped.length}_entries_ignoradas`);

    return { records, event_id: String(eventId), warnings };
  }

  if (diagnostics.every((item) => item.endsWith(':0'))) {
    warnings.push(`sem_eventos_superbet:${liga}:${date}:ids=${diagnostics.join(',')}`);
    return empty;
  }
  warnings.push(`evento_nao_encontrado:${home}×${away}:${date} — ids:[${diagnostics.join(',')}] disponíveis:[${misses.slice(0, 8).join(', ')}]`);
  return empty;
}
