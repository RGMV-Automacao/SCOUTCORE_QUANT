'use strict';

/**
 * src/motor/scraper/sb-api-client.cjs
 * Superbet public odds API (Fastly CDN) — zero browser.
 *
 * Copiado de ApolloFinalV2/scraper/sb-api-client.cjs.
 * Fix: startDate NÃO usa encodeURIComponent (API rejeita %2B, exige + literal).
 */

const API_BASE = 'https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR';
const SPORT_ID_FOOTBALL = 5;

const DEFAULT_HEADERS = Object.freeze({
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
});

/**
 * Formata data JS → 'YYYY-MM-DD+00:00:00' (formato aceito pela API).
 * @param {Date|string} input
 */
function formatApiDate(input) {
  if (typeof input === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input}+00:00:00`;
    const d = new Date(input);
    if (!isNaN(d.getTime())) return formatApiDate(d);
    throw new Error(`Invalid date string: ${input}`);
  }
  const d = input instanceof Date ? input : new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}+00:00:00`;
}

/**
 * GET com retry leve + timeout.
 */
async function fetchJson(url, opts = {}) {
  const { timeoutMs = 10000, retries = 2, headers = {} } = opts;
  const mergedHeaders = { ...DEFAULT_HEADERS, ...headers };
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: mergedHeaders, signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status} on ${url}`);
        if (res.status >= 400 && res.status < 500) throw lastErr;
      } else {
        return await res.json();
      }
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err.name === 'AbortError') lastErr = new Error(`timeout ${timeoutMs}ms on ${url}`);
      if (attempt >= retries) break;
      const backoffMs = 200 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  throw lastErr || new Error(`fetch failed on ${url}`);
}

/**
 * Lista eventos ativos de um torneio numa data.
 * ATENÇÃO: startDate NÃO é encodeURIComponent'd — a API exige + literal.
 *
 * @param {{ tournamentId, date, sportId? }} opts
 * @returns {Promise<Array>}
 */
async function fetchEventList({ tournamentId, date, sportId = SPORT_ID_FOOTBALL }) {
  const apiDate = formatApiDate(date);
  const url =
    `${API_BASE}/events/by-date?currentStatus=active&offerState=prematch` +
    `&tournamentIds=${encodeURIComponent(tournamentId)}` +
    `&startDate=${apiDate}&sportId=${sportId}`;  // + literal, sem encode
  const json = await fetchJson(url);
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.events)) return json.events;
  return [];
}

/**
 * Busca detalhes completos de um evento (todos os mercados ativos).
 *
 * @param {number|string} eventId
 * @returns {Promise<object>}
 */
async function fetchEventDetails(eventId) {
  if (!eventId) throw new Error('eventId required');
  const url = `${API_BASE}/events/${encodeURIComponent(eventId)}`;
  const json = await fetchJson(url);
  // Normaliza: API retorna { error, dataIn, data: [event] }
  if (json && Array.isArray(json.data) && json.data[0]) return json.data[0];
  if (json && Array.isArray(json) && json[0]) return json[0];
  return json;
}

module.exports = {
  API_BASE,
  SPORT_ID_FOOTBALL,
  DEFAULT_HEADERS,
  formatApiDate,
  fetchJson,
  fetchEventList,
  fetchEventDetails,
};
