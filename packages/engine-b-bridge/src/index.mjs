// engine-b-bridge — HTTP client honesto para o sidecar Python (FastAPI).
//
// Contratos:
//   - predictBatch({ liga, home, away, data, features? }) → { available, slots, version, reason? }
//   - ping() → { available, version, models_loaded? }
//
// Garantias:
//   - NUNCA lança. Falha de rede / timeout / parse → { available:false, reason }.
//   - Honesto: se sidecar offline, fallback degrada Motor para Engine A puro.

export const ENGINE_B_VERSION = process.env.ENGINE_B_VERSION || '0.3.0-xgb-lgbm';

const URL_BASE = process.env.ENGINE_B_URL || 'http://127.0.0.1:4055';
const TIMEOUT_MS = Number(process.env.ENGINE_B_TIMEOUT_MS || 2000);

async function httpJson(url, { method = 'GET', body, timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) return { _error: `http_${res.status}` };
    return await res.json();
  } catch (e) {
    if (e?.name === 'AbortError') return { _error: 'timeout' };
    return { _error: `network:${e?.code || e?.message || 'unknown'}` };
  } finally {
    clearTimeout(t);
  }
}

export async function predictBatch({ liga, home, away, data, features } = {}) {
  if (!liga || !home || !away || !data) {
    return {
      available: false,
      reason: 'missing_match_keys',
      slots: [],
      version: ENGINE_B_VERSION,
    };
  }
  const r = await httpJson(`${URL_BASE}/predict`, {
    method: 'POST',
    body: { liga, home, away, data, features },
  });
  if (r._error) {
    return {
      available: false,
      reason: r._error,
      slots: [],
      version: ENGINE_B_VERSION,
    };
  }
  if (!r.available) {
    return {
      available: false,
      reason: r.reason || 'sidecar_unavailable',
      slots: [],
      version: r.version || ENGINE_B_VERSION,
    };
  }
  const slots = (r.slots || []).map((s) => ({
    ...parseMarketKey(canonicalMarketKey(s.market_key)),
    market_key: canonicalMarketKey(s.market_key),
    fair_prob: s.fair_prob,
    source: 'engine_b',
    certified: true,
    provenance: { engine: 'B', model: 'ml-sidecar', version: r.version || ENGINE_B_VERSION },
  }));
  return {
    available: true,
    slots,
    version: r.version || ENGINE_B_VERSION,
  };
}

export function canonicalMarketKey(key) {
  if (key === 'btts_sim') return 'btts_total_ft_sim';
  if (key === 'btts_nao') return 'btts_total_ft_nao';
  if (key === '1x2_home') return '1x2_total_ft_home';
  if (key === '1x2_draw') return '1x2_total_ft_draw';
  if (key === '1x2_away') return '1x2_total_ft_away';
  return key;
}

function parseMarketKey(key) {
  if (!key) return {};
  const parts = key.split('_');
  let family = parts[0];
  let offset = 1;
  if (key.startsWith('chutes_alvo_')) { family = 'chutes_alvo'; offset = 2; }
  const scope = parts[offset] ?? 'total';
  const period = (parts[offset + 1] ?? 'ft').toUpperCase();
  const direction = parts[offset + 2] ?? null;
  const lineParts = parts.slice(offset + 3);
  const line = lineParts.length > 0 ? Number(lineParts.join('.')) : null;
  return {
    family,
    scope,
    period,
    direction,
    line: Number.isFinite(line) ? line : null,
  };
}

export async function ping() {
  const r = await httpJson(`${URL_BASE}/health`, { method: 'GET' });
  if (r._error) return { available: false, version: ENGINE_B_VERSION, reason: r._error };
  return {
    available: !!r.ok,
    version: r.version || ENGINE_B_VERSION,
    models_loaded: r.models_loaded || [],
    models_count: r.models_count || 0,
  };
}
