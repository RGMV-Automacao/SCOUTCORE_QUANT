// scout test — sanity checks
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoutReport, SCOUT_VERSION, runScout, fetchWebContext, clearWebContextCache } from '../src/index.mjs';

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

// ─── runScout (cadeia de fallback) ───────────────────────────────────────────

test('runScout retorna null quando options.scout !== true (zero latência)', async () => {
  const out = await runScout({
    slots: [], evidence: null,
    matchContext: baseMatch,
    evRanked: [],
    options: {},
  });
  assert.equal(out, null);
});

test('runScout retorna skip_reason=no_provider_configured quando nenhum provider está configurado', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const out = await runScout({
      slots: [{ market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.6 }],
      evidence: null,
      matchContext: baseMatch,
      evRanked: ['m1'],
      options: { scout: true },
    });
    assert.equal(out.skip_reason, 'no_provider_configured');
    assert.equal(out.model, null);
    assert.deepEqual(out.red_flags, []);
  } finally {
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
    else delete process.env.PERPLEXITY_API_KEY;
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('runScout sem slots elegíveis → skip_reason=no_eligible_slots', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.ANTHROPIC_API_KEY;
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
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('runScout com fetch mockado: clip de confidence_delta e filtro de severity inválida', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.PERPLEXITY_API_KEY; // garante que fetchWebContext não tenta chamar
  delete process.env.ANTHROPIC_API_KEY;
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
    assert.equal(out.scout_score, 59);
    assert.equal(out.web_context_used, false);
    assert.equal(out.red_flags.length, 2);
    assert.equal(out.red_flags[0].confidence_delta, -0.20);
    assert.equal(out.red_flags[1].confidence_delta, +0.15);
  } finally {
    globalThis.fetch = origFetch;
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
    else delete process.env.PERPLEXITY_API_KEY;
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('runScout: erro no único provider configurado → skip_reason=all_providers_failed', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => 'upstream' });
  try {
    const out = await runScout({
      slots: [{ market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.6 }],
      evidence: null,
      matchContext: baseMatch,
      evRanked: ['m1'],
      options: { scout: true },
    });
    assert.equal(out.skip_reason, 'all_providers_failed');
    assert.equal(out.model, null);
  } finally {
    globalThis.fetch = origFetch;
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
    else delete process.env.PERPLEXITY_API_KEY;
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('runScout faz fallback para Claude quando OpenAI falha e Anthropic está configurado', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  const prevModel = process.env.SCOUT_ANTHROPIC_MODEL;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.PERPLEXITY_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'anth-test-fake';
  process.env.SCOUT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-latest';
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('openai')) {
      return { ok: false, status: 503, text: async () => 'upstream' };
    }
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ red_flags: [], narrative: 'fallback claude', scout_score: 67 }) }],
        usage: { input_tokens: 21, output_tokens: 9 },
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
    assert.equal(out.skip_reason, null);
    assert.equal(out.model, 'claude-3-5-sonnet-latest');
    assert.equal(out.tokens_used, 30);
    assert.equal(out.narrative, 'fallback claude');
    assert.deepEqual(calls, [
      'https://api.openai.com/v1/chat/completions',
      'https://api.anthropic.com/v1/messages',
    ]);
  } finally {
    globalThis.fetch = origFetch;
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
    else delete process.env.PERPLEXITY_API_KEY;
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
    if (prevModel) process.env.SCOUT_ANTHROPIC_MODEL = prevModel;
    else delete process.env.SCOUT_ANTHROPIC_MODEL;
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
    else delete process.env.PERPLEXITY_API_KEY;
  }
});

test('fetchWebContext envia metadados e regras anti-fonte-fraca para a Sonar', async () => {
  const prev = process.env.PERPLEXITY_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.PERPLEXITY_API_KEY = 'pplx-test-fake';
  clearWebContextCache();
  let request = null;
  globalThis.fetch = async (_url, opts) => {
    request = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '1. CLÁSSICO/RIVALIDADE — Não é derby. (CONFIANÇA: alta)' } }] }) };
  };
  try {
    const out = await fetchWebContext({
      ...baseMatch,
      hora: '19:30',
      temporada: '2025/2026',
      rodada: 36,
      stadium: 'Santiago Bernabéu',
      referee: 'Ricardo De Burgos Bengoetxea',
      venue_city: 'Madrid',
      away_city: 'Oviedo',
    }, { cacheTtlMs: 0 });
    assert.ok(out.includes('Santiago Bernabéu'));
    assert.match(request.messages[0].content, /Não use YouTube/);
    assert.match(request.messages[0].content, /priorize: \(1\) próximo compromisso/);
    assert.match(request.messages[0].content, /confirmado pelo clube/);
    assert.match(request.messages[1].content, /Rodada: 36/);
    assert.match(request.messages[1].content, /Estádio: Santiago Bernabéu/);
    assert.match(request.messages[1].content, /Madrid ↔ Oviedo/);
    assert.match(request.messages[1].content, /fonte conflitante/i);
    assert.equal(request.max_tokens, 1100);
  } finally {
    clearWebContextCache();
    globalThis.fetch = origFetch;
    if (prev) process.env.PERPLEXITY_API_KEY = prev;
    else delete process.env.PERPLEXITY_API_KEY;
  }
});

test('fetchWebContext usa cache em memória para mesma partida', async () => {
  const prev = process.env.PERPLEXITY_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.PERPLEXITY_API_KEY = 'pplx-test-fake';
  clearWebContextCache();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: `contexto-${calls}` } }] }) };
  };
  try {
    const match = { ...baseMatch, home: 'Cache A', away: 'Cache B', date: '2026-05-14' };
    const a = await fetchWebContext(match, { cacheTtlMs: 60000 });
    const b = await fetchWebContext(match, { cacheTtlMs: 60000 });
    assert.equal(calls, 1);
    assert.equal(a, b);
  } finally {
    clearWebContextCache();
    globalThis.fetch = origFetch;
    if (prev) process.env.PERPLEXITY_API_KEY = prev;
    else delete process.env.PERPLEXITY_API_KEY;
  }
});

test('runScout envia âncoras de score, narrativa específica e variância recente ao GPT', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let request = null;
  globalThis.fetch = async (_url, opts) => {
    request = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ red_flags: [], narrative: 'edge parece limpo no slot m1.', scout_score: 88 }) } }],
        usage: { total_tokens: 99 },
      }),
    };
  };
  try {
    const out = await runScout({
      slots: [{ market_key: 'm1', family: 'escanteios', fair_prob: 0.7, market_odd: 1.6, edge_pct: 12, confidence: 0.55 }],
      evidence: {
        profileHome: { n: 10, avg_escanteios: 6.1 },
        profileAway: { n: 10, avg_escanteios: 3.8 },
        slotForm: [{
          market_key: 'm1',
          metric: 'escanteios',
          home: { values: [8, 7, 6, 9, 5], min: 5, max: 9, avg: 7.0, n: 5 },
          away: { values: [3, 4, 2, 5, 4], min: 2, max: 5, avg: 3.6, n: 5 },
        }],
      },
      matchContext: baseMatch,
      evRanked: ['m1'],
      options: { scout: true },
    });
    assert.equal(out.skip_reason, null);
    assert.match(request.messages[0].content, /Âncoras scout_score/);
    assert.match(request.messages[0].content, /slot mais confiável/);
    assert.match(request.messages[0].content, /edge parece limpo/);
    assert.match(request.messages[1].content, /FORMA RECENTE \/ VARIÂNCIA DOS TOP SLOTS/);
    assert.match(request.messages[1].content, /ult=\[8,7,6,9,5\]/);
    assert.match(request.messages[1].content, /edge=12\.0%/);
    assert.doesNotMatch(request.messages[1].content, /edge=1200\.0%/);
  } finally {
    globalThis.fetch = origFetch;
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
    else delete process.env.PERPLEXITY_API_KEY;
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('runScout limita scout_score quando top3 tem confiança muito baixa', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ red_flags: [], narrative: 'cautela recomendada.', scout_score: 75 }) } }],
      usage: { total_tokens: 12 },
    }),
  });
  try {
    const out = await runScout({
      slots: [
        { market_key: 'm1', family: 'gols', fair_prob: 0.6, market_odd: 1.8, edge_pct: 8, confidence: 0.20 },
        { market_key: 'm2', family: 'btts', fair_prob: 0.55, market_odd: 1.9, edge_pct: 6, confidence: 0.25 },
        { market_key: 'm3', family: '1x2', fair_prob: 0.7, market_odd: 1.5, edge_pct: 5, confidence: 0.29 },
      ],
      evidence: null,
      matchContext: baseMatch,
      evRanked: ['m1', 'm2', 'm3'],
      options: { scout: true },
    });
    assert.equal(out.scout_score, 59);
  } finally {
    globalThis.fetch = origFetch;
    if (prev) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
    if (prevPplx) process.env.PERPLEXITY_API_KEY = prevPplx;
    else delete process.env.PERPLEXITY_API_KEY;
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('runScout encadeia Perplexity → GPT-4o (web_context_used=true)', async () => {
  const prevO = process.env.OPENAI_API_KEY;
  const prevP = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  process.env.PERPLEXITY_API_KEY = 'pplx-test-fake';
  delete process.env.ANTHROPIC_API_KEY;
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
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('runScout opt-out de web (options.scout_web=false) ignora Perplexity', async () => {
  const prevO = process.env.OPENAI_API_KEY;
  const prevP = process.env.PERPLEXITY_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  const origFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-fake';
  process.env.PERPLEXITY_API_KEY = 'pplx-test-fake';
  delete process.env.ANTHROPIC_API_KEY;
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
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});
