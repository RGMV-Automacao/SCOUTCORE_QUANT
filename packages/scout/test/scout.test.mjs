// scout test — sanity checks
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoutReport, SCOUT_VERSION, runScout, fetchWebContext } from '../src/index.mjs';

const baseMatch = { home: 'A', away: 'B', liga: 'brasileirao', date: '2025-10-01' };

test('SCOUT_VERSION exported', () => {
  assert.equal(typeof SCOUT_VERSION, 'string');
});

test('empty top_picks → no_odds_provided note', () => {
  const r = buildScoutReport({
    match: baseMatch,
    slots: [{ market_key: 'a', family: 'gols', market_odd: null, fair_prob: 0.5 }],
    evRanked: [],
    evRankedCappedOut: [],
    warnings: [],
  });
  assert.equal(r.top_picks.length, 0);
  assert.ok(r.notes.some((n) => n.startsWith('no_odds_provided')));
});

test('top_picks ordering reflects evRanked', () => {
  const slots = [
    { market_key: 'm1', family: 'gols', direction: 'over', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.5 },
    { market_key: 'm2', family: 'btts', direction: 'sim', fair_prob: 0.55, market_odd: 1.9, edge_pct: 4, confidence: 0.4 },
  ];
  const r = buildScoutReport({
    match: baseMatch, slots,
    evRanked: ['m2', 'm1'],
    evRankedCappedOut: [],
    warnings: [],
  });
  assert.equal(r.top_picks[0].market_key, 'm2');
  assert.equal(r.top_picks[1].market_key, 'm1');
});

test('phantom flag → note added', () => {
  const slots = [
    { market_key: 'm1', family: 'gols', direction: 'over', fair_prob: 0.6, market_odd: 5, edge_pct: 50, confidence: 0.5,
      provenance: { phantom_edge_flag: true } },
  ];
  const r = buildScoutReport({
    match: baseMatch, slots,
    evRanked: ['m1'], evRankedCappedOut: [], warnings: [],
  });
  assert.ok(r.notes.some((n) => n.startsWith('phantom_edge_detected')));
  assert.equal(r.top_picks[0].phantom, true);
});

test('capped_out_count + family_cap_filtered note', () => {
  const r = buildScoutReport({
    match: baseMatch, slots: [],
    evRanked: [], evRankedCappedOut: ['m1', 'm2'], warnings: [],
  });
  assert.equal(r.capped_out_count, 2);
  assert.ok(r.notes.some((n) => n.startsWith('family_cap_filtered')));
});

test('low_confidence note when conf<0.4 in top5', () => {
  const slots = [
    { market_key: 'm1', family: 'gols', direction: 'over', fair_prob: 0.4, market_odd: 2, edge_pct: 5, confidence: 0.2 },
  ];
  const r = buildScoutReport({
    match: baseMatch, slots,
    evRanked: ['m1'], evRankedCappedOut: [], warnings: [],
  });
  assert.ok(r.notes.some((n) => n.startsWith('low_confidence_in_top5')));
});

// ─── runScout (GPT-único) ────────────────────────────────────────────────────

test('runScout retorna null quando options.scout !== true (zero latência)', async () => {
  const out = await runScout({
    slots: [], evidence: null,
    matchContext: baseMatch,
    evRanked: [],
    options: {},
  });
  assert.equal(out, null);
});

test('runScout retorna skip_reason=no_openai_key quando env ausente', async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const out = await runScout({
      slots: [{ market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.6 }],
      evidence: null,
      matchContext: baseMatch,
      evRanked: ['m1'],
      options: { scout: true },
    });
    assert.equal(out.skip_reason, 'no_openai_key');
    assert.equal(out.model, null);
    assert.deepEqual(out.red_flags, []);
  } finally {
    if (prev) process.env.OPENAI_API_KEY = prev;
  }
});

test('runScout sem slots elegíveis → skip_reason=no_eligible_slots', async () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  try {
    const out = await runScout({
      slots: [],
      evidence: null,
      matchContext: baseMatch,
      evRanked: [],
      options: { scout: true },
    });
    assert.equal(out.skip_reason, 'no_eligible_slots');
  } finally {
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
  }
});

test('runScout com fetch mockado: clip de confidence_delta e filtro de severity inválida', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.PERPLEXITY_API_KEY; // garante que fetchWebContext não tenta chamar
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({
        red_flags: [
          { market_key: 'm1', reason: 'phantom edge', severity: 'high', confidence_delta: -0.99, rationale: 'edge inflado' }, // clipa p/ -0.20
          { market_key: 'm2', reason: 'positivo',     severity: 'low',  confidence_delta: 0.50,  rationale: 'mantém pos' },   // clipa p/ +0.15
          { market_key: 'm1', reason: 'severity bug', severity: 'critical', confidence_delta: 0.0, rationale: '' },           // ignorado
          { market_key: 'm99', reason: 'fora da lista', severity: 'low', confidence_delta: 0.0, rationale: '' },              // ignorado (não está em evRanked)
        ],
        narrative: 'Análise teste.',
        scout_score: 73,
      }) } }],
      usage: { total_tokens: 42 },
    }),
  });
  try {
    const slots = [
      { market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 25, confidence: 0.5 },
      { market_key: 'm2', family: 'btts', fair_prob: 0.55, market_odd: 1.9, edge_pct: 4, confidence: 0.4 },
    ];
    const out = await runScout({
      slots,
      evidence: { profileHome: { n: 10, avg_goals_scored_home: 1.5 }, profileAway: null },
      matchContext: baseMatch,
      evRanked: ['m1', 'm2'],
      options: { scout: true },
    });
    assert.equal(out.skip_reason, null);
    assert.equal(out.model, 'gpt-4o');
    assert.equal(out.tokens_used, 42);
    assert.equal(out.narrative, 'Análise teste.');
    assert.equal(out.scout_score, 73);
    assert.equal(out.web_context_used, false);
    assert.equal(out.red_flags.length, 2);
    assert.equal(out.red_flags[0].confidence_delta, -0.20);
    assert.equal(out.red_flags[1].confidence_delta, +0.15);
  } finally {
    globalThis.fetch = origFetch;
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
  }
});

test('runScout: erro HTTP da OpenAI → skip_reason=openai_failed (não trava)', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.PERPLEXITY_API_KEY;
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'upstream' });
  try {
    const out = await runScout({
      slots: [{ market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.6 }],
      evidence: null,
      matchContext: baseMatch,
      evRanked: ['m1'],
      options: { scout: true },
    });
    assert.ok(out.skip_reason?.startsWith('openai_failed'));
    assert.equal(out.model, null);
  } finally {
    globalThis.fetch = origFetch;
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
  }
});

test('fetchWebContext retorna null sem PERPLEXITY_API_KEY (graceful)', async () => {
  const prev = process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  try {
    const out = await fetchWebContext(baseMatch);
    assert.equal(out, null);
  } finally {
    if (prev) process.env.PERPLEXITY_API_KEY = prev;
  }
});

test('runScout encadeia Perplexity → GPT-4o (web_context_used=true)', async () => {
  const prevO = process.env.OPENAI_API_KEY;
  const prevP = process.env.PERPLEXITY_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  process.env.PERPLEXITY_API_KEY = 'pplx-test-fake';
  globalThis.fetch = async (url) => {
    if (String(url).includes('perplexity')) {
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '1. CLÁSSICO: derby intenso.\n3. DESFALQUES: artilheiro fora.' } }] }),
      };
    }
    // OpenAI
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          red_flags: [{ market_key: 'm1', reason: 'desfalque crítico', severity: 'high', confidence_delta: -0.10, rationale: 'artilheiro fora' }],
          narrative: 'Derby com desfalque.',
          scout_score: 55,
        }) } }],
        usage: { total_tokens: 80 },
      }),
    };
  };
  try {
    const out = await runScout({
      slots: [{ market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.6 }],
      evidence: null,
      matchContext: baseMatch,
      evRanked: ['m1'],
      options: { scout: true },
    });
    assert.equal(out.skip_reason, null);
    assert.equal(out.web_context_used, true);
    assert.equal(out.red_flags.length, 1);
    assert.equal(out.red_flags[0].confidence_delta, -0.10);
  } finally {
    globalThis.fetch = origFetch;
    if (prevO) process.env.OPENAI_API_KEY = prevO;
    else delete process.env.OPENAI_API_KEY;
    if (prevP) process.env.PERPLEXITY_API_KEY = prevP;
    else delete process.env.PERPLEXITY_API_KEY;
  }
});

test('runScout opt-out de web (options.scout_web=false) ignora Perplexity', async () => {
  const prevO = process.env.OPENAI_API_KEY;
  const prevP = process.env.PERPLEXITY_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  process.env.PERPLEXITY_API_KEY = 'pplx-test-fake';
  let pplxCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url).includes('perplexity')) { pplxCalled = true; return { ok: true, json: async () => ({}) }; }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ red_flags: [], narrative: 'ok', scout_score: 50 }) } }],
        usage: { total_tokens: 10 },
      }),
    };
  };
  try {
    const out = await runScout({
      slots: [{ market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.6 }],
      evidence: null,
      matchContext: baseMatch,
      evRanked: ['m1'],
      options: { scout: true, scout_web: false },
    });
    assert.equal(pplxCalled, false);
    assert.equal(out.web_context_used, false);
    assert.equal(out.skip_reason, null);
  } finally {
    globalThis.fetch = origFetch;
    if (prevO) process.env.OPENAI_API_KEY = prevO;
    else delete process.env.OPENAI_API_KEY;
    if (prevP) process.env.PERPLEXITY_API_KEY = prevP;
    else delete process.env.PERPLEXITY_API_KEY;
  }
});
