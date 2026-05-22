import { fetchOddsRecords, fetchOddsRecordsByEventId, recordToPortugueseRow } from '@scoutcore/superbet-scraper';

const BMB_BASE = 'https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2';
const BMB_HEADERS = {
  accept: 'application/json',
  origin: 'https://superbet.bet.br',
  referer: 'https://superbet.bet.br/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

const DEFAULT_HTTP_TIMEOUT_MS = Math.max(1000, Number(process.env.SCOUTCORE_BOOKLINE_HTTP_TIMEOUT_MS || process.env.SCOUTCORE_SB_HTTP_TIMEOUT_MS || 5000));
const DEFAULT_EVENT_RETRIES = Math.max(0, Number(process.env.SCOUTCORE_BOOKLINE_EVENT_RETRIES || process.env.SCOUTCORE_SB_EVENT_RETRIES || 0));
const DEFAULT_VALIDATE_CONCURRENCY = Math.max(1, Number(process.env.SCOUTCORE_SB_VALIDATE_CONCURRENCY || 12));

function timeoutController(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(timer) };
}

function compactError(error) {
  const message = error?.name === 'AbortError'
    ? 'timeout'
    : String(error?.message || error || 'unknown_error');
  return message.replace(/https?:\/\/\S+/g, '<url>').replace(/\s+/g, '_').slice(0, 120);
}

function extractEventId(urlOrPath) {
  const raw = String(urlOrPath || '');
  const match = /evento-(\d+)|-(\d+)(?:\/?$)|match_id=(\d+)/i.exec(raw);
  return match ? (match[1] || match[2] || match[3]) : null;
}

function buildEventUrl(eventId) {
  const normalized = String(eventId || '').trim();
  return normalized ? `https://superbet.bet.br/odds/futebol/evento-${normalized}` : null;
}

async function fetchJson(url, { timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}) {
  const timeout = timeoutController(timeoutMs);
  try {
    const response = await fetch(url, { headers: BMB_HEADERS, signal: timeout.controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`http_${response.status}:${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`invalid_json:${text.slice(0, 120)}`);
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`timeout_${timeoutMs}ms`);
    throw error;
  } finally {
    timeout.clear();
  }
}

async function fetchSga(eventId, oddUuids, { timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}) {
  const joined = encodeURIComponent(oddUuids.join(','));
  return fetchJson(`${BMB_BASE}/getSgaOddPrice?match_id=${eventId}&selected_odds_uuids=${joined}&lang=pt-BR&target=SB_BR`, { timeoutMs });
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function boardCacheKey(board) {
  const legs = (board?.legs || []).map((leg) => leg.market_key).sort().join(',');
  return `${board?.match_id || 'unknown'}::${legs}`;
}

function buildSlotMap(slots) {
  const map = new Map();
  for (const slot of slots || []) {
    map.set(`${slot.match_id}::${slot.market_key}`, slot);
  }
  return map;
}

function findParsedOdd(records, slot) {
  const list = Array.isArray(records) ? records : [];
  const matches = list.filter((record) => record?.market_key === slot.market_key && Number(record?.odd) > 1);
  if (matches.length === 0) return null;
  matches.sort((a, b) => Number(b?.odd ?? 0) - Number(a?.odd ?? 0));
  return matches[0];
}

function expectedBoardCombo(comboByMatchId, matchId) {
  const combo = comboByMatchId.get(matchId);
  return combo && typeof combo === 'object' ? combo : null;
}

function expectedBoardOdd(boardSlots, comboByMatchId, matchId) {
  const comboOdd = expectedBoardCombo(comboByMatchId, matchId)?.combo_odd;
  if (Number.isFinite(Number(comboOdd)) && Number(comboOdd) > 1) return Number(comboOdd);
  const legOdds = boardSlots.map((slot) => Number(slot?.market_odd)).filter((odd) => Number.isFinite(odd) && odd > 1);
  if (legOdds.length === boardSlots.length && legOdds.length > 0) {
    return Number(legOdds.reduce((acc, odd) => acc * odd, 1).toFixed(4));
  }
  return null;
}

function buildDrift(expectedOdd, actualOdd) {
  const expected = Number(expectedOdd);
  const actual = Number(actualOdd);
  if (!Number.isFinite(expected) || !Number.isFinite(actual) || expected <= 0 || actual <= 0) return null;
  return Number((((expected - actual) / expected) * 100).toFixed(2));
}

function buildEventContextStmt(db) {
  const columns = new Set(
    db.prepare('PRAGMA table_info(odds)').all().map((row) => String(row?.name || '').toLowerCase())
  );

  if (columns.has('source_event_id')) {
    const byMatchId = columns.has('id_confronto')
      ? db.prepare(`
          SELECT source_event_id
          FROM odds
          WHERE id_confronto = ?
            AND source_event_id IS NOT NULL
            AND trim(source_event_id) <> ''
          LIMIT 1
        `)
      : null;
    const byLeagueDateTeams = columns.has('liga')
      ? db.prepare(`
          SELECT source_event_id
          FROM odds
          WHERE liga = ?
            AND data_jogo = ?
            AND home_team = ?
            AND away_team = ?
            AND source_event_id IS NOT NULL
            AND trim(source_event_id) <> ''
          LIMIT 1
        `)
      : null;
    const byDateTeams = db.prepare(`
      SELECT source_event_id
      FROM odds
      WHERE home_team = ?
        AND away_team = ?
        AND data_jogo = ?
        AND source_event_id IS NOT NULL
        AND trim(source_event_id) <> ''
      LIMIT 1
    `);
    return {
      get(slot) {
        const matchId = String(slot?.match_id ?? slot?.opta_match_id ?? '').trim();
        if (byMatchId && matchId) {
          const row = byMatchId.get(matchId);
          if (row?.source_event_id) return row;
        }
        if (byLeagueDateTeams && slot?.liga) {
          const row = byLeagueDateTeams.get(slot.liga, slot.date, slot.home, slot.away);
          if (row?.source_event_id) return row;
        }
        return byDateTeams.get(slot.home, slot.away, slot.date);
      },
    };
  }

  if (columns.has('url_partida')) {
    const byMatchId = columns.has('id_confronto')
      ? db.prepare(`
          SELECT url_partida
          FROM odds
          WHERE id_confronto = ?
            AND url_partida IS NOT NULL
            AND trim(url_partida) <> ''
          LIMIT 1
        `)
      : null;
    const byLeagueDateTeams = columns.has('liga')
      ? db.prepare(`
          SELECT url_partida
          FROM odds
          WHERE liga = ?
            AND data_jogo = ?
            AND home_team = ?
            AND away_team = ?
            AND url_partida IS NOT NULL
            AND trim(url_partida) <> ''
          LIMIT 1
        `)
      : null;
    const byDateTeams = db.prepare(`
      SELECT url_partida
      FROM odds
      WHERE home_team = ?
        AND away_team = ?
        AND data_jogo = ?
        AND url_partida IS NOT NULL
        AND trim(url_partida) <> ''
      LIMIT 1
    `);
    return {
      get(slot) {
        const matchId = String(slot?.match_id ?? slot?.opta_match_id ?? '').trim();
        if (byMatchId && matchId) {
          const row = byMatchId.get(matchId);
          if (row?.url_partida) return row;
        }
        if (byLeagueDateTeams && slot?.liga) {
          const row = byLeagueDateTeams.get(slot.liga, slot.date, slot.home, slot.away);
          if (row?.url_partida) return row;
        }
        return byDateTeams.get(slot.home, slot.away, slot.date);
      },
    };
  }

  throw new Error('odds_table_missing_source_event_id_or_url_partida');
}

async function resolveEventContext({ slot, eventStmt }) {
  const fromDb = eventStmt.get(slot);
  const dbUrl = fromDb?.url_partida || null;
  const dbEventId = String(fromDb?.source_event_id || extractEventId(dbUrl) || '').trim() || null;
  if (dbEventId) {
    return { event_id: dbEventId, url_partida: dbUrl || buildEventUrl(dbEventId), source: 'odds_table', warnings: [] };
  }

  try {
    const lookup = await fetchOddsRecords({
      home: slot.home,
      away: slot.away,
      liga: slot.liga,
      date: slot.date,
    });
    if (lookup?.event_id) {
      return {
        event_id: String(lookup.event_id),
        url_partida: lookup.url_partida || null,
        source: 'public_lookup',
        warnings: lookup.warnings || [],
      };
    }
    return { event_id: null, url_partida: null, source: 'unresolved', warnings: lookup?.warnings || [] };
  } catch (error) {
    return { event_id: null, url_partida: null, source: 'error', warnings: [error.message] };
  }
}

async function validateBoard({
  board,
  slotMap,
  comboByMatchId,
  caches,
  eventStmt,
  maxDropPct,
  maxFavorableDriftPct,
  minActualComboEv,
  httpTimeoutMs,
  eventRetries,
}) {
  const slots = [];
  for (const leg of board?.legs || []) {
    const slot = slotMap.get(`${board.match_id}::${leg.market_key}`);
    if (slot) slots.push(slot);
  }

  if (slots.length === 0) {
    return {
      match_id: board?.match_id ?? null,
      match: null,
      status: 'error',
      gaps: [{ market_key: null, reason: 'slot_metadata_missing' }],
      warnings: [],
      legs: [],
      event_id: null,
      url_partida: null,
      expected_combo_odd: null,
      expected_combo_ev: null,
      actual_combo_odd: null,
      actual_combo_ev: null,
      drift_pct: null,
    };
  }

  const matchMeta = slots[0];
  let eventCtx = caches.events.get(board.match_id);
  if (!eventCtx) {
    eventCtx = await resolveEventContext({ slot: matchMeta, eventStmt });
    caches.events.set(board.match_id, eventCtx);
  }

  const warnings = [...(eventCtx.warnings || [])];
  if (!eventCtx.event_id) {
    return {
      match_id: board.match_id,
      match: `${matchMeta.home} x ${matchMeta.away}`,
      status: 'error',
      gaps: [{ market_key: null, reason: 'event_id_unresolved' }],
      warnings,
      legs: [],
      event_id: null,
      url_partida: eventCtx.url_partida,
      expected_combo_odd: expectedBoardOdd(slots, comboByMatchId, board.match_id),
      expected_combo_ev: expectedBoardCombo(comboByMatchId, board.match_id)?.combo_ev ?? null,
      actual_combo_odd: null,
      actual_combo_ev: null,
      drift_pct: null,
    };
  }

  let eventOdds = caches.catalogs.get(eventCtx.event_id);
  if (!eventOdds) {
    try {
      eventOdds = await fetchOddsRecordsByEventId({
        eventId: eventCtx.event_id,
        home: matchMeta.home,
        away: matchMeta.away,
        timeoutMs: httpTimeoutMs,
        retries: eventRetries,
      });
    } catch (error) {
      return {
        match_id: board.match_id,
        match: `${matchMeta.home} x ${matchMeta.away}`,
        status: 'error',
        gaps: [{ market_key: null, reason: `catalog_fetch_error:${compactError(error)}` }],
        warnings,
        legs: [],
        event_id: eventCtx.event_id,
        url_partida: eventCtx.url_partida,
        expected_combo_odd: expectedBoardOdd(slots, comboByMatchId, board.match_id),
        expected_combo_ev: expectedBoardCombo(comboByMatchId, board.match_id)?.combo_ev ?? null,
        actual_combo_odd: null,
        actual_combo_ev: null,
        drift_pct: null,
      };
    }
    caches.catalogs.set(eventCtx.event_id, eventOdds);
  }
  warnings.push(...(eventOdds?.warnings || []));

  const legs = [];
  const gaps = [];
  for (const slot of slots) {
    const resolvedRecord = findParsedOdd(eventOdds?.records, slot);
    if (!resolvedRecord) {
      gaps.push({ market_key: slot.market_key, reason: 'market_or_selection_missing_in_superbet' });
      continue;
    }

    if (!resolvedRecord.odd_uuid) {
      gaps.push({ market_key: slot.market_key, reason: 'odd_uuid_missing_in_superbet_record' });
      continue;
    }

    const row = recordToPortugueseRow(resolvedRecord);
    const actualOdd = Number(resolvedRecord.odd ?? null);
    legs.push({
      market_key: slot.market_key,
      status: 'ok',
      market_name: resolvedRecord.section_name || resolvedRecord.heading,
      selection_name: row?.selecao ?? resolvedRecord.outcome ?? null,
      expected_market_odd: slot.market_odd ?? null,
      actual_market_odd: Number.isFinite(actualOdd) ? actualOdd : null,
      price_diff: Number.isFinite(Number(slot.market_odd)) && Number.isFinite(actualOdd)
        ? Number((actualOdd - Number(slot.market_odd)).toFixed(4))
        : null,
      odd_uuid: resolvedRecord.odd_uuid,
    });
  }

  const expectedComboOdd = expectedBoardOdd(slots, comboByMatchId, board.match_id);
  const expectedCombo = expectedBoardCombo(comboByMatchId, board.match_id);
  if (gaps.length > 0) {
    return {
      match_id: board.match_id,
      match: `${matchMeta.home} x ${matchMeta.away}`,
      status: 'error',
      gaps,
      warnings,
      legs,
      event_id: eventCtx.event_id,
      url_partida: eventCtx.url_partida,
      expected_combo_odd: expectedComboOdd,
      expected_combo_ev: expectedCombo?.combo_ev ?? null,
      actual_combo_odd: null,
      actual_combo_ev: null,
      drift_pct: null,
    };
  }

  const quoteKey = `${eventCtx.event_id}::${legs.map((leg) => leg.odd_uuid).sort().join(',')}`;
  let quote = caches.quotes.get(quoteKey);
  if (!quote) {
    try {
      quote = await fetchSga(eventCtx.event_id, legs.map((leg) => leg.odd_uuid), { timeoutMs: httpTimeoutMs });
    } catch (error) {
      return {
        match_id: board.match_id,
        match: `${matchMeta.home} x ${matchMeta.away}`,
        status: 'error',
        gaps: [{ market_key: null, reason: `quote_fetch_error:${compactError(error)}` }],
        warnings,
        legs,
        event_id: eventCtx.event_id,
        url_partida: eventCtx.url_partida,
        expected_combo_odd: expectedComboOdd,
        expected_combo_ev: expectedCombo?.combo_ev ?? null,
        actual_combo_odd: null,
        actual_combo_ev: null,
        drift_pct: null,
      };
    }
    caches.quotes.set(quoteKey, quote);
  }

  const actualComboOdd = Number(quote?.price ?? null);
  const driftPct = buildDrift(expectedComboOdd, actualComboOdd);
  const actualComboEv = buildActualComboEv(expectedCombo, actualComboOdd);
  if (quote?.status !== 'ACTIVE' || quote?.combinationBettingStatus !== 'ACTIVE') {
    gaps.push({ market_key: null, reason: `quote_inactive:${quote?.status || 'unknown'}/${quote?.combinationBettingStatus || 'unknown'}` });
  }
  if (driftPct != null && driftPct > maxDropPct) {
    gaps.push({ market_key: null, reason: `price_drift_combo:${driftPct}%>${maxDropPct}%` });
  }
  if (isActualComboEvBelowMin(actualComboEv, minActualComboEv)) {
    gaps.push({ market_key: null, reason: `actual_ev_combo:${Number((actualComboEv * 100).toFixed(2))}%<${Number((minActualComboEv * 100).toFixed(2))}%` });
  }
  if (driftPct != null && driftPct < -maxFavorableDriftPct) {
    warnings.push(`favorable_price_drift_combo:${Math.abs(driftPct)}%>${maxFavorableDriftPct}%`);
  }

  return {
    match_id: board.match_id,
    match: `${matchMeta.home} x ${matchMeta.away}`,
    status: gaps.length > 0 ? 'error' : 'ok',
    gaps,
    warnings,
    legs,
    event_id: eventCtx.event_id,
    url_partida: eventCtx.url_partida,
    expected_combo_odd: expectedComboOdd,
    expected_combo_ev: expectedCombo?.combo_ev ?? null,
    actual_combo_odd: Number.isFinite(actualComboOdd) ? actualComboOdd : null,
    actual_combo_ev: actualComboEv,
    drift_pct: driftPct,
  };
}

export async function validateYankeeAgainstSuperbet({
  repo,
  run,
  yankee,
  maxDropPct = 8,
  maxFavorableDriftPct = 25,
  minActualComboEv = 0,
  httpTimeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
  eventRetries = DEFAULT_EVENT_RETRIES,
  concurrency = DEFAULT_VALIDATE_CONCURRENCY,
  validationCache = null,
} = {}) {
  const tickets = Array.isArray(yankee?.tickets) ? yankee.tickets : [];
  const comboByMatchId = new Map(
    (yankee?.board?.ready_combos || []).map((combo) => [combo.match_id ?? combo.opta_match_id, combo])
  );
  const slotMap = buildSlotMap(run?.slots || []);
  const caches = validationCache ?? {
    events: new Map(),
    catalogs: new Map(),
    quotes: new Map(),
  };
  if (!caches.events) caches.events = new Map();
  if (!caches.catalogs) caches.catalogs = new Map();
  if (!caches.quotes) caches.quotes = new Map();
  const eventStmt = buildEventContextStmt(repo.db);

  const uniqueBoards = [];
  const seenBoardKeys = new Set();
  for (const ticket of tickets) {
    for (const board of ticket.boards || []) {
      const cacheKey = boardCacheKey(board);
      if (seenBoardKeys.has(cacheKey)) continue;
      seenBoardKeys.add(cacheKey);
      if (caches.quotes.has(`board:${cacheKey}`)) continue;
      uniqueBoards.push({ cacheKey, board });
    }
  }

  await mapWithConcurrency(uniqueBoards, concurrency, async ({ cacheKey, board }) => {
    const boardResult = await validateBoard({
      board,
      slotMap,
      comboByMatchId,
      caches,
      eventStmt,
      maxDropPct,
      maxFavorableDriftPct,
      minActualComboEv,
      httpTimeoutMs,
      eventRetries,
    });
    caches.quotes.set(`board:${cacheKey}`, boardResult);
  });

  const ticketResults = [];
  const sampleGaps = [];
  let boardsOk = 0;
  let boardsFailed = 0;
  let ticketsOk = 0;
  let ticketsFailed = 0;
  let gapsTotal = 0;
  let warningsTotal = 0;
  let actualEvNegativeBoards = 0;

  for (const ticket of tickets) {
    const boards = [];
    for (const board of ticket.boards || []) {
      const cacheKey = boardCacheKey(board);
      let boardResult = caches.quotes.get(`board:${cacheKey}`);
      if (!boardResult) {
        boardResult = await validateBoard({
          board,
          slotMap,
          comboByMatchId,
          caches,
          eventStmt,
          maxDropPct,
          maxFavorableDriftPct,
          minActualComboEv,
          httpTimeoutMs,
          eventRetries,
        });
        caches.quotes.set(`board:${cacheKey}`, boardResult);
      }
      boards.push(boardResult);
      if (boardResult.status === 'ok') boardsOk++;
      else boardsFailed++;
      if (isActualComboEvBelowMin(boardResult.actual_combo_ev, minActualComboEv)) actualEvNegativeBoards++;
      warningsTotal += boardResult.warnings?.length || 0;
      for (const gap of boardResult.gaps || []) {
        gapsTotal++;
        if (sampleGaps.length < 8) {
          sampleGaps.push({
            ticket_idx: ticket.ticket_idx,
            match_id: boardResult.match_id,
            match: boardResult.match,
            market_key: gap.market_key,
            reason: gap.reason,
          });
        }
      }
    }

    const expectedTicketOdd = Number(ticket.ticket_odd ?? null);
    const actualTicketOdd = boards.every((board) => Number.isFinite(Number(board.actual_combo_odd)) && Number(board.actual_combo_odd) > 0)
      ? Number(boards.reduce((acc, board) => acc * Number(board.actual_combo_odd), 1).toFixed(4))
      : null;
    const driftPct = buildDrift(expectedTicketOdd, actualTicketOdd);
    const status = boards.every((board) => board.status === 'ok') ? 'ok' : 'error';
    if (status === 'ok') ticketsOk++;
    else ticketsFailed++;

    ticketResults.push({
      ticket_idx: ticket.ticket_idx,
      status,
      expected_ticket_odd: Number.isFinite(expectedTicketOdd) ? expectedTicketOdd : null,
      actual_ticket_odd: actualTicketOdd,
      drift_pct: driftPct,
      boards,
    });
  }

  return {
    provider: 'superbet_public_bmb',
    mode: 'catalog_quote_only',
    summary: {
      tickets_total: tickets.length,
      tickets_ok: ticketsOk,
      tickets_failed: ticketsFailed,
      boards_total: boardsOk + boardsFailed,
      boards_ok: boardsOk,
      boards_failed: boardsFailed,
      gaps_total: gapsTotal,
      warnings_total: warningsTotal,
      actual_ev_negative_boards: actualEvNegativeBoards,
    },
    sample_gaps: sampleGaps,
    tickets: ticketResults,
  };
}

function buildActualComboEv(combo, actualOdd) {
  const jointProb = Number(combo?.joint_prob);
  const odd = Number(actualOdd);
  if (!Number.isFinite(jointProb) || !Number.isFinite(odd) || jointProb <= 0 || odd <= 1) return null;
  return Number(((jointProb * odd) - 1).toFixed(4));
}

export function isActualComboEvBelowMin(actualComboEv, minActualComboEv = 0) {
  const actual = Number(actualComboEv);
  const min = Number(minActualComboEv);
  if (!Number.isFinite(actual) || !Number.isFinite(min)) return false;
  return actual < min;
}