import { fetchOddsRecords } from '@scoutcore/superbet-scraper';
import { buildLookupPlan } from '../../../scripts/lib/superbet-mapping.mjs';

const BMB_BASE = 'https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2';
const BMB_HEADERS = {
  accept: 'application/json',
  origin: 'https://superbet.bet.br',
  referer: 'https://superbet.bet.br/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractEventId(urlOrPath) {
  const raw = String(urlOrPath || '');
  const match = /evento-(\d+)|-(\d+)(?:\/?$)|match_id=(\d+)/i.exec(raw);
  return match ? (match[1] || match[2] || match[3]) : null;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: BMB_HEADERS });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`http_${response.status}:${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`invalid_json:${text.slice(0, 120)}`);
  }
}

async function fetchCatalog(eventId) {
  return fetchJson(`${BMB_BASE}/getBetbuilderMarketsForMatch?match_id=${eventId}&lang=pt-BR&target=SB_BR`);
}

async function fetchSga(eventId, oddUuids) {
  const joined = encodeURIComponent(oddUuids.join(','));
  return fetchJson(`${BMB_BASE}/getSgaOddPrice?match_id=${eventId}&selected_odds_uuids=${joined}&lang=pt-BR&target=SB_BR`);
}

function matchesEqOrLike(name, rule) {
  const normalizedName = normalizeText(name);
  if (!rule) return false;
  if (rule.eq != null) return normalizedName === normalizeText(rule.eq);
  if (rule.like != null) {
    const needle = normalizeText(String(rule.like).replace(/%/g, ''));
    return needle ? normalizedName.includes(needle) : false;
  }
  return false;
}

function findMarket(markets, plan) {
  const list = Array.isArray(markets) ? markets : [];
  const direct = list.find((market) => matchesEqOrLike(market?.name, plan?.mercadoEqOrLike));
  if (direct) return direct;
  return null;
}

function selectionMatches(odd, selection) {
  const target = normalizeText(selection);
  if (!target) return false;
  const names = [odd?.name, odd?.description].map(normalizeText).filter(Boolean);
  return names.some((value) => value === target);
}

function findOdd(market, plan) {
  const odds = Array.isArray(market?.odds) ? market.odds : [];
  const direct = odds.find((odd) => selectionMatches(odd, plan.selecao));
  if (direct) return direct;

  const targetSelection = normalizeText(plan.selecao);
  const targetLine = normalizeText(plan.linha);
  if (targetSelection || targetLine) {
    const bySpec = odds.find((odd) => {
      const name = normalizeText(odd?.name);
      const description = normalizeText(odd?.description);
      const specifiers = odd?.specifiers ?? {};
      const total = normalizeText(specifiers.total);
      const hcp = normalizeText(specifiers.hcp);
      const selectionOk = targetSelection
        ? (name === targetSelection || description === targetSelection || name.includes(targetSelection))
        : true;
      const lineOk = targetLine
        ? [name, description, total, hcp].some((value) => value && value.includes(targetLine))
        : true;
      return selectionOk && lineOk;
    });
    if (bySpec) return bySpec;
  }

  if (targetSelection === 'x') {
    return odds.find((odd) => /^(x|empate)$/.test(normalizeText(odd?.name))) ?? null;
  }
  if (targetSelection === '1' || targetSelection === '2') {
    const nonDraw = odds.filter((odd) => !/^(x|empate)$/.test(normalizeText(odd?.name)));
    if (nonDraw.length >= 2) return targetSelection === '1' ? nonDraw[0] : nonDraw[nonDraw.length - 1];
  }

  return null;
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

function expectedBoardOdd(boardSlots, comboByMatchId, matchId) {
  const comboOdd = comboByMatchId.get(matchId);
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

async function resolveEventContext({ repo, slot, urlStmt }) {
  const fromDb = urlStmt.get(slot.home, slot.away, slot.date);
  const dbUrl = fromDb?.url_partida || null;
  const dbEventId = extractEventId(dbUrl);
  if (dbEventId) {
    return { event_id: dbEventId, url_partida: dbUrl, source: 'odds_table', warnings: [] };
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

async function validateBoard({ board, slotMap, comboByMatchId, caches, repo, urlStmt, maxDropPct }) {
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
      expected_combo_odd: null,
      actual_combo_odd: null,
      drift_pct: null,
    };
  }

  const matchMeta = slots[0];
  let eventCtx = caches.events.get(board.match_id);
  if (!eventCtx) {
    eventCtx = await resolveEventContext({ repo, slot: matchMeta, urlStmt });
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
      expected_combo_odd: expectedBoardOdd(slots, comboByMatchId, board.match_id),
      actual_combo_odd: null,
      drift_pct: null,
    };
  }

  let catalog = caches.catalogs.get(eventCtx.event_id);
  if (!catalog) {
    catalog = await fetchCatalog(eventCtx.event_id);
    caches.catalogs.set(eventCtx.event_id, catalog);
  }

  const legs = [];
  const gaps = [];
  for (const slot of slots) {
    const plans = buildLookupPlan(slot.market_key, slot.home, slot.away);
    if (plans == null) {
      gaps.push({ market_key: slot.market_key, reason: 'unmapped_in_motor_catalog' });
      continue;
    }
    if (plans.length === 0) {
      gaps.push({ market_key: slot.market_key, reason: 'mapped_but_invalid_line' });
      continue;
    }

    let resolved = null;
    for (const plan of plans) {
      const market = findMarket(catalog?.markets, plan);
      if (!market) continue;
      const odd = findOdd(market, plan);
      if (!odd) continue;
      resolved = {
        market_key: slot.market_key,
        status: 'ok',
        market_name: market.name,
        selection_name: odd.name,
        expected_market_odd: slot.market_odd ?? null,
        actual_market_odd: Number(odd.price ?? null),
        price_diff: Number.isFinite(Number(slot.market_odd)) && Number.isFinite(Number(odd.price))
          ? Number((Number(odd.price) - Number(slot.market_odd)).toFixed(4))
          : null,
        odd_uuid: odd.uuid,
      };
      break;
    }

    if (!resolved) {
      gaps.push({ market_key: slot.market_key, reason: 'market_or_selection_missing_in_superbet' });
      continue;
    }

    legs.push(resolved);
  }

  const expectedComboOdd = expectedBoardOdd(slots, comboByMatchId, board.match_id);
  if (gaps.length > 0) {
    return {
      match_id: board.match_id,
      match: `${matchMeta.home} x ${matchMeta.away}`,
      status: 'error',
      gaps,
      warnings,
      legs,
      event_id: eventCtx.event_id,
      expected_combo_odd: expectedComboOdd,
      actual_combo_odd: null,
      drift_pct: null,
    };
  }

  const quoteKey = `${eventCtx.event_id}::${legs.map((leg) => leg.odd_uuid).sort().join(',')}`;
  let quote = caches.quotes.get(quoteKey);
  if (!quote) {
    quote = await fetchSga(eventCtx.event_id, legs.map((leg) => leg.odd_uuid));
    caches.quotes.set(quoteKey, quote);
  }

  const actualComboOdd = Number(quote?.price ?? null);
  const driftPct = buildDrift(expectedComboOdd, actualComboOdd);
  if (quote?.status !== 'ACTIVE' || quote?.combinationBettingStatus !== 'ACTIVE') {
    gaps.push({ market_key: null, reason: `quote_inactive:${quote?.status || 'unknown'}/${quote?.combinationBettingStatus || 'unknown'}` });
  }
  if (driftPct != null && driftPct > maxDropPct) {
    gaps.push({ market_key: null, reason: `price_drift_combo:${driftPct}%>${maxDropPct}%` });
  }

  return {
    match_id: board.match_id,
    match: `${matchMeta.home} x ${matchMeta.away}`,
    status: gaps.length > 0 ? 'error' : 'ok',
    gaps,
    warnings,
    legs,
    event_id: eventCtx.event_id,
    expected_combo_odd: expectedComboOdd,
    actual_combo_odd: Number.isFinite(actualComboOdd) ? actualComboOdd : null,
    drift_pct: driftPct,
  };
}

export async function validateYankeeAgainstSuperbet({ repo, run, yankee, maxDropPct = 8 } = {}) {
  const tickets = Array.isArray(yankee?.tickets) ? yankee.tickets : [];
  const comboByMatchId = new Map(
    (yankee?.board?.ready_combos || []).map((combo) => [combo.match_id ?? combo.opta_match_id, combo.combo_odd])
  );
  const slotMap = buildSlotMap(run?.slots || []);
  const caches = {
    events: new Map(),
    catalogs: new Map(),
    quotes: new Map(),
  };
  const urlStmt = repo.db.prepare(`
    SELECT url_partida
    FROM odds
    WHERE home_team = ?
      AND away_team = ?
      AND data_jogo = ?
      AND url_partida IS NOT NULL
      AND trim(url_partida) <> ''
    ORDER BY odd DESC
    LIMIT 1
  `);

  const ticketResults = [];
  const sampleGaps = [];
  let boardsOk = 0;
  let boardsFailed = 0;
  let ticketsOk = 0;
  let ticketsFailed = 0;
  let gapsTotal = 0;

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
          repo,
          urlStmt,
          maxDropPct,
        });
        caches.quotes.set(`board:${cacheKey}`, boardResult);
      }
      boards.push(boardResult);
      if (boardResult.status === 'ok') boardsOk++;
      else boardsFailed++;
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
    },
    sample_gaps: sampleGaps,
    tickets: ticketResults,
  };
}