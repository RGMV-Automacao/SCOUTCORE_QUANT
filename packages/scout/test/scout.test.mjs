// scout test — sanity checks
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoutReport, SCOUT_VERSION } from '../src/index.mjs';

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
