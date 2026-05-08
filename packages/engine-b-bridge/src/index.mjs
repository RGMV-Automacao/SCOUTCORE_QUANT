// engine-b-bridge — HTTP client honesto para o sidecar Python (FastAPI).
//
// Contratos:
//   - predictBatch({ liga, home, away, data, features? }) → { available, slots, version, reason? }
//   - ping() → { available, version, models_loaded? }
//
// Garantias:
//   - NUNCA lança. Falha de rede / timeout / parse → { available:false, reason }.
//   - Honesto: se sidecar offline, fallback degrada Motor para Engine A puro.

export const ENGINE_B_VERSION = '0.2.0-sklearn-gbm';

const URL_BASE = process.env.ENGINE_B_URL || 'http://127.0.0.1:4055';
const TIMEOUT_MS = Number(process.env.ENGINE_B_TIMEOUT_MS || 800);

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
    market_key: s.market_key,
    fair_prob: s.fair_prob,
    source: 'engine_b',
    certified: true,
    provenance: { engine: 'B', model: 'sklearn-gbm', version: r.version || ENGINE_B_VERSION },
  }));
  return {
    available: true,
    slots,
    version: r.version || ENGINE_B_VERSION,
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
