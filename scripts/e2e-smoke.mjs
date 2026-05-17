// scripts/e2e-smoke.mjs
// Chama predict + evaluation summary e asserta shape esperado.
const API = process.env.API_URL || 'http://127.0.0.1:4040';

async function fetchJson(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data; try { data = JSON.parse(txt); } catch { data = txt; }
  return { ok: res.ok, status: res.status, data };
}

function assert(cond, msg) {
  if (!cond) { console.error('[e2e] FAIL:', msg); process.exit(1); }
  console.log('[e2e] ok:', msg);
}

(async () => {
  const h = await fetchJson('GET', '/v1/health');
  assert(h.ok && h.status === 200, '/v1/health 200');
  assert(h.data.status === 'ok' && h.data.engine_signature, 'health has engine_signature');

  const m = await fetchJson('GET', '/v1/markets');
  assert(m.ok && m.data.count > 100, `/v1/markets count > 100 (got ${m.data?.count})`);

  const p = await fetchJson('POST', '/v1/predict', {
    contract_version: '1.0.0',
    match: {
      external_id: 'e2e:1', home: 'TestHome', away: 'TestAway',
      liga: 'brasileirao', date: '2026-05-15',
    },
  });
  assert(p.ok && p.status === 200, `/v1/predict 200 (got ${p.status})`);
  assert(Array.isArray(p.data.slots) && p.data.slots.length > 0, 'predict returned slots[]');
  assert(p.data.engine_signature, 'predict has engine_signature');

  const e = await fetchJson('GET', '/v1/evaluation/summary');
  assert(e.status === 200, `/v1/evaluation/summary 200 (got ${e.status})`);

  console.log('[e2e] all checks passed');
})().catch((err) => { console.error('[e2e] crash:', err); process.exit(1); });
