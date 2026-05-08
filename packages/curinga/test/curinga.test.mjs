// curinga test — combine A/B + sanity gates
import test from 'node:test';
import assert from 'node:assert/strict';
import { combine, CURINGA_VERSION } from '../src/index.mjs';

test('CURINGA_VERSION', () => assert.equal(typeof CURINGA_VERSION, 'string'));

test('B unavailable → A pure with provenance', () => {
  const a = [{ market_key: 'k', fair_prob: 0.6, certified: true, provenance: {} }];
  const out = combine({ slotsA: a, slotsB: null });
  assert.equal(out[0].provenance.weight_a, 1);
  assert.equal(out[0].provenance.weight_b, 0);
  assert.equal(out[0].provenance.divergence_resolved_by, 'engine_b_unavailable');
});

test('B available → weighted average', () => {
  const a = [{ market_key: 'gols_total_ft_over_2_5', fair_prob: 0.60, certified: true, provenance: {} }];
  const b = [{ market_key: 'gols_total_ft_over_2_5', fair_prob: 0.40 }];
  const out = combine({ slotsA: a, slotsB: b });
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].fair_prob - 0.5) < 1e-9);
  assert.equal(out[0].provenance.fair_prob_a, 0.60);
  assert.equal(out[0].provenance.fair_prob_b, 0.40);
  assert.equal(out[0].provenance.weight_a, 0.5);
  assert.equal(out[0].provenance.weight_b, 0.5);
  assert.equal(out[0].provenance.divergence_resolved_by, 'weighted_average');
  assert.equal(out[0].provenance.divergence_pp, 20);
  assert.equal(out[0].provenance.divergence_flag, true);
});

test('A-only (no B counterpart) → kept with engine_b_no_slot', () => {
  const a = [{ market_key: 'kA', fair_prob: 0.5, certified: true, provenance: {} }];
  const b = [{ market_key: 'kB', fair_prob: 0.6 }];
  const out = combine({ slotsA: a, slotsB: b });
  const aOut = out.find((s) => s.market_key === 'kA');
  assert.equal(aOut.provenance.divergence_resolved_by, 'engine_b_no_slot');
});

test('B-only slot → appended with weight_b=1', () => {
  const a = [{ market_key: 'kA', fair_prob: 0.5, certified: true, provenance: {} }];
  const b = [{ market_key: 'gols_total_ft_over_2_5', fair_prob: 0.6, certified: true }];
  const out = combine({ slotsA: a, slotsB: b });
  const bOnly = out.find((s) => s.market_key === 'gols_total_ft_over_2_5');
  assert.ok(bOnly);
  assert.equal(bOnly.source, 'engine_b_only');
  assert.equal(bOnly.provenance.weight_a, 0);
  assert.equal(bOnly.provenance.weight_b, 1);
  assert.equal(bOnly.family, 'gols');
});

test('sanity: fair_prob fora de [0.02,0.98] perde certified', () => {
  const a = [{ market_key: 'k', fair_prob: 0.99, certified: true, provenance: {} }];
  const out = combine({ slotsA: a, slotsB: null });
  assert.equal(out[0].certified, false);
});
