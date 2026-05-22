import { createHash, randomUUID } from 'node:crypto';
import {
  isBrowserSubmitEnabled,
  getBooklineSession,
  ensureBooklineSessionId,
  invalidateBooklineSession,
} from './bookline-session.mjs';

const BMB_BASE = 'https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2';
const OFFER_EVENT = (id) => `https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/${id}`;
const SUBMIT_URL = 'https://api.web.production.betler.superbet.bet.br/legacy-web/betting/submitTicket?clientSourceType=Desktop_new';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const DEFAULT_HTTP_TIMEOUT_MS = Math.max(1000, Number(process.env.SCOUTCORE_BOOKLINE_HTTP_TIMEOUT_MS || process.env.SCOUTCORE_SB_HTTP_TIMEOUT_MS || 15000));
const DEFAULT_SUBMIT_TIMEOUT_MS = Math.max(1000, Number(process.env.SCOUTCORE_BOOKLINE_SUBMIT_TIMEOUT_MS || process.env.BOOKLINE_SUBMIT_TIMEOUT_MS || 20000));
const DEFAULT_HTTP_RETRIES = Math.max(0, Number(process.env.SCOUTCORE_BOOKLINE_HTTP_RETRIES || 2));

function timeoutController(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, clear: () => clearTimeout(timer) };
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeHeader(value) {
  return String(value || '').replace(/[^\x20-\x7E]/g, '').replace(/[\r\n]/g, '').trim();
}

function getSubmitAuth() {
  const sessionid = safeHeader(
    process.env.BOOKLINE_SESSIONID
      || process.env.SCOUTCORE_BOOKLINE_SESSIONID
      || process.env.SCOUTCORE_SB_SESSIONID
      || '',
  );
  const cookie = safeHeader(
    process.env.BOOKLINE_COOKIE
      || process.env.SCOUTCORE_BOOKLINE_COOKIE
      || process.env.SCOUTCORE_SB_COOKIE
      || '',
  );
  return { sessionid, cookie, configured: Boolean(sessionid || cookie) };
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = DEFAULT_HTTP_TIMEOUT_MS, retries = DEFAULT_HTTP_RETRIES, ...fetchOptions } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const timeout = timeoutController(timeoutMs);
    try {
      const response = await fetch(url, { ...fetchOptions, signal: timeout.controller.signal });
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
      if (!response.ok) {
        const suffix = json?.errorCode || json?.error || text.slice(0, 160);
        throw new Error(`http_${response.status}:${suffix}`);
      }
      return json;
    } catch (error) {
      lastError = error?.name === 'AbortError' ? new Error(`timeout_${timeoutMs}ms`) : error;
      if (attempt >= retries) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      timeout.clear();
    }
  }
  throw lastError;
}

async function fetchSga(eventId, oddUuids) {
  const joined = encodeURIComponent(oddUuids.join(','));
  return fetchJson(`${BMB_BASE}/getSgaOddPrice?match_id=${eventId}&selected_odds_uuids=${joined}&lang=pt-BR&target=SB_BR`, {
    headers: {
      accept: 'application/json',
      origin: 'https://superbet.bet.br',
      referer: 'https://superbet.bet.br/',
      'user-agent': USER_AGENT,
    },
  });
}

async function fetchEventMeta(eventId) {
  const json = await fetchJson(OFFER_EVENT(eventId), { headers: { accept: 'application/json', 'accept-encoding': 'identity' } });
  return Array.isArray(json?.data) ? json.data[0] : json?.data;
}

function buildItemComponents(quote) {
  return (quote?.legs || []).map((leg) => ({
    name: `${leg.marketName}: ${leg.oddName}`,
    marketUuid: leg.marketUuid,
    marketName: leg.marketName,
    oddUuid: leg.oddUuid,
    oddName: leg.oddName,
    status: leg.status || 'ACTIVE',
    bettingStatus: 'ACTIVE',
    isEligibleForEarlySettlement: false,
    isSuperSubEligible: leg.superSubEligible || false,
    sourceScreen: 506,
  }));
}

async function buildSubmitPayload({ validationTicket, stake }) {
  const items = [];
  let actualTicketOdd = 1;

  for (const board of validationTicket?.boards || []) {
    if (board.status !== 'ok') {
      return { ok: false, reason: `board_not_ok:${board.match_id}`, payload: null };
    }
    const eventId = String(board.event_id || '').trim();
    const oddUuids = (board.legs || []).map((leg) => leg.odd_uuid).filter(Boolean);
    if (!eventId || oddUuids.length === 0) {
      return { ok: false, reason: `board_missing_event_or_odds:${board.match_id}`, payload: null };
    }

    const [quote, meta] = await Promise.all([fetchSga(eventId, oddUuids), fetchEventMeta(eventId)]);
    if (quote?.status !== 'ACTIVE' || quote?.combinationBettingStatus !== 'ACTIVE') {
      return { ok: false, reason: `quote_inactive:${quote?.status || 'unknown'}/${quote?.combinationBettingStatus || 'unknown'}`, quote, payload: null };
    }

    const price = Number(quote.price);
    if (!Number.isFinite(price) || price <= 1) {
      return { ok: false, reason: `quote_invalid_price:${board.match_id}`, quote, payload: null };
    }

    items.push({
      value: price.toFixed(2),
      type: 'sport',
      fix: false,
      betRadarId: String(meta?.betradarId || ''),
      eventId: meta?.eventId,
      eventUuid: meta?.uuid,
      oddUuid: quote.sgaUuid,
      sourceType: 201,
      sourceScreen: 506,
      itemComponents: buildItemComponents(quote),
    });
    actualTicketOdd *= price;
  }

  const deviceId = randomUUID();
  const actualStake = Number(stake);
  const payload = {
    ticketOnline: 'online',
    total: actualStake,
    betType: 'prematch',
    combs: '',
    items,
    clientSourceType: 'Desktop_new',
    paymentBonusType: 1,
    locale: 'pt-BR',
    requestDetails: {
      ldAnonymousUserKey: `ANONYMOUS_USER-${Math.floor(Math.random() * 1000)}`,
      deviceId,
      isDeviceIdTestFlagOnSubscribed: 'false',
      isDeviceIdTestFlagOnInitial: 'false',
    },
    geoLocation: 'brSaoPaulo',
    deviceIdentifier: deviceId,
    autoAcceptChanges: '1',
    ticketUuid: randomUUID(),
  };

  return { ok: true, payload, actualTicketOdd: Number(actualTicketOdd.toFixed(4)) };
}

export function isRealSubmitEnabled() {
  return String(process.env.SCOUTCORE_BOOKLINE_REAL_SUBMIT || process.env.BOOKLINE_REAL_SUBMIT || '').toLowerCase() === 'true';
}

export async function buildValidatedTicketSubmitPreview({ validationTicket, stake }) {
  const built = await buildSubmitPayload({ validationTicket, stake });
  if (!built.ok) {
    return { ready: false, reason: built.reason, quote: built.quote ?? null };
  }

  return {
    ready: true,
    payload_hash: sha256Json(built.payload),
    actual_ticket_odd: built.actualTicketOdd,
    stake: built.payload.total,
    items_count: built.payload.items.length,
    item_component_counts: built.payload.items.map((item) => item.itemComponents?.length || 0),
    payload_summary: {
      betType: built.payload.betType,
      clientSourceType: built.payload.clientSourceType,
      autoAcceptChanges: built.payload.autoAcceptChanges,
      items: built.payload.items.map((item) => ({
        eventId: item.eventId,
        eventUuid: item.eventUuid,
        oddUuid: item.oddUuid,
        value: item.value,
        components: item.itemComponents?.length || 0,
      })),
    },
  };
}

function isSessionInvalidResponse(status, json, text) {
  if (status === 401 || status === 403) return true;
  const code = String(json?.errorCode || '').toLowerCase();
  if (code === 'sessionnotvalid' || code === 'unauthenticated' || code === 'unauthorized') return true;
  const blob = `${json?.notice || ''} ${json?.error || ''} ${text || ''}`.toLowerCase();
  return /session\s*not\s*valid|sess(?:ão|ao)\s+(?:foi\s+)?encerrada|fa[çc]a\s+o\s+login|not[_\s-]?authenticated/i.test(blob);
}

async function submitViaBrowser({ payload, payloadHash, built }) {
  let session;
  try {
    session = await getBooklineSession();
  } catch (error) {
    if (error?.code === 'PLAYWRIGHT_MISSING') {
      return { confirmed: false, reason: 'bookline_playwright_missing', retryable: false, hint: 'Rodar `npm install` em apps/api para instalar playwright' };
    }
    return { confirmed: false, reason: `bookline_session_failed:${error?.message || error}`, retryable: true };
  }

  const attempt = async ({ force }) => {
    let sessionid;
    try { sessionid = await ensureBooklineSessionId({ force }); }
    catch (error) {
      return { kind: 'sid_failed', reason: `bookline_sessionid_failed:${error?.message || error}` };
    }

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      origin: 'https://superbet.bet.br',
      referer: 'https://superbet.bet.br/',
      'user-agent': USER_AGENT,
    };
    if (sessionid) headers.sessionid = safeHeader(sessionid);

    let apiResp;
    try {
      apiResp = await session.page.request.post(SUBMIT_URL, {
        headers,
        data: payload,
        timeout: DEFAULT_SUBMIT_TIMEOUT_MS,
      });
    } catch (error) {
      return { kind: 'request_failed', reason: `submit_request_failed:${error?.message || error}` };
    }

    const status = apiResp.status();
    const text = await apiResp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    return { kind: 'response', status, text, json };
  };

  let result = await attempt({ force: false });

  if (result.kind === 'response' && isSessionInvalidResponse(result.status, result.json, result.text)) {
    // Sessão expirada na Superbet: invalida cache + força re-extração de antifraud e tenta de novo.
    await invalidateBooklineSession().catch(() => null);
    result = await attempt({ force: true });
  }

  if (result.kind !== 'response') {
    return { confirmed: false, reason: result.reason, retryable: true, payload_hash: payloadHash, submit_channel: 'browser' };
  }

  const { status, text, json } = result;
  const externalTicketId = json?.data?.ticketId || json?.ticketId || null;
  const ticketData = json?.data?.ticketData || {};

  if (status >= 200 && status < 300 && externalTicketId && !json?.error) {
    return {
      confirmed: true,
      external_ticket_id: String(externalTicketId),
      payload_hash: payloadHash,
      payload,
      response_json: json,
      actual_odd: ticketData.winEstimated && ticketData.sumStake
        ? Number((Number(ticketData.winEstimated) / Number(ticketData.sumStake)).toFixed(4))
        : built.actualTicketOdd,
      actual_stake: ticketData.sumStake ?? payload.total,
      potential_payoff: ticketData.winEstimated ?? null,
      http_status: status,
      submit_channel: 'browser',
    };
  }

  return {
    confirmed: false,
    reason: `submit_error:${json?.errorCode || status}:${json?.notice || json?.error || text.slice(0, 160)}`,
    payload_hash: payloadHash,
    payload,
    response_json: json ?? { text: text.slice(0, 2000) },
    http_status: status,
    retryable: true,
    submit_channel: 'browser',
  };
}

export async function submitValidatedTicket({ validationTicket, stake }) {
  const built = await buildSubmitPayload({ validationTicket, stake });
  if (!built.ok) {
    return { confirmed: false, reason: built.reason, retryable: true, quote: built.quote ?? null };
  }

  // Caminho preferencial: sessão Playwright autenticada (igual ao legado ApolloFinalV2).
  if (isBrowserSubmitEnabled()) {
    return submitViaBrowser({
      payload: built.payload,
      payloadHash: sha256Json(built.payload),
      built,
    });
  }

  // Fallback: fetch direto com sessionid/cookie de env (compatibilidade).
  const auth = getSubmitAuth();
  if (!auth.configured) {
    return { confirmed: false, reason: 'bookline_auth_missing', retryable: false };
  }

  const payloadHash = sha256Json(built.payload);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    origin: 'https://superbet.bet.br',
    referer: 'https://superbet.bet.br/',
    'user-agent': USER_AGENT,
  };
  if (auth.sessionid) headers.sessionid = auth.sessionid;
  if (auth.cookie) headers.cookie = auth.cookie;

  const timeout = timeoutController(DEFAULT_SUBMIT_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(SUBMIT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(built.payload),
      signal: timeout.controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { confirmed: false, reason: `submit_timeout:${DEFAULT_SUBMIT_TIMEOUT_MS}ms`, retryable: true };
    }
    throw error;
  } finally {
    timeout.clear();
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  const externalTicketId = json?.data?.ticketId || json?.ticketId || null;
  const ticketData = json?.data?.ticketData || {};

  if (response.ok && externalTicketId && !json?.error) {
    return {
      confirmed: true,
      external_ticket_id: String(externalTicketId),
      payload_hash: payloadHash,
      payload: built.payload,
      response_json: json,
      actual_odd: ticketData.winEstimated && ticketData.sumStake
        ? Number((Number(ticketData.winEstimated) / Number(ticketData.sumStake)).toFixed(4))
        : built.actualTicketOdd,
      actual_stake: ticketData.sumStake ?? built.payload.total,
      potential_payoff: ticketData.winEstimated ?? null,
      http_status: response.status,
      submit_channel: 'fetch',
    };
  }

  return {
    confirmed: false,
    reason: `submit_error:${json?.errorCode || response.status}:${json?.notice || json?.error || text.slice(0, 160)}`,
    payload_hash: payloadHash,
    payload: built.payload,
    response_json: json ?? { text: text.slice(0, 2000) },
    http_status: response.status,
    retryable: true,
    submit_channel: 'fetch',
  };
}
