/**
 * Mesa de teste — per_match runner (Duplas)
 * Verifica geração de combos, contradição, famílias distintas, ranking.
 *
 * Execução: node packages/strategy-engine/test/per-match.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyStrategy, __resetConfigCache } from '../src/index.mjs';

function makeSlot(overrides) {
  return {
    match_id: 'm1', home: 'Flamengo', away: 'Palmeiras', liga: 'brasileirao',
    date: '2026-05-13', market_key: 'test', family: 'gols', scope: 'total',
    period: 'FT', direction: 'over', line: 2.5, fair_prob: 0.55, fair_odd: 1.82,
    confidence: 0.78, certified: true, market_odd: 2.10, edge_pct: 5.4,
    engine_source: 'curinga', ...overrides,
  };
}

const SLOTS = [
  // Match 1: 5 legs (3 families: gols, escanteios, cartoes)
  makeSlot({ match_id: 'm1', market_key: 'gols_ft_over_2_5', family: 'gols', direction: 'over', line: 2.5, market_odd: 1.70, edge_pct: 4.0 }),
  makeSlot({ match_id: 'm1', market_key: 'esc_ft_over_9_5', family: 'escanteios', direction: 'over', line: 9.5, market_odd: 1.65, edge_pct: 5.0 }),
  makeSlot({ match_id: 'm1', market_key: 'cart_ft_over_3_5', family: 'cartoes', direction: 'over', line: 3.5, market_odd: 1.80, edge_pct: 3.0 }),
  // Contraditório: over 2.5 + under 2.5 mesma família
  makeSlot({ match_id: 'm1', market_key: 'gols_ft_under_2_5', family: 'gols', direction: 'under', line: 2.5, market_odd: 2.00, edge_pct: 2.0 }),
  makeSlot({ match_id: 'm1', market_key: 'esc_ft_under_8_5', family: 'escanteios', direction: 'under', line: 8.5, market_odd: 1.50, edge_pct: 2.5 }),

  // Match 2: apenas 1 leg (impossível fazer dupla)
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Inter', market_key: 'gols_ft_over_1_5', family: 'gols', market_odd: 1.40, edge_pct: 3.0 }),
];

describe('per_match runner — Duplas', () => {
  beforeEach(() => __resetConfigCache());

  it('duplas: generates combos with 2 legs from same match', async () => {
    const result = await applyStrategy('duplas', SLOTS);
    assert.equal(result.strategy_type, 'per_match');
    assert.ok(result.output_picks > 0, 'should produce picks');
    for (const pick of result.picks) {
      assert.equal(pick.n_legs, 2);
      assert.equal(pick.match_id, 'm1'); // m2 only has 1 leg
    }
  });

  it('duplas: no contradictions in results (over/under same line excluded)', async () => {
    const result = await applyStrategy('duplas', SLOTS);
    for (const pick of result.picks) {
      // Não deve ter gols_over_2.5 + gols_under_2.5 juntos
      const keys = pick.legs.map((l) => l.market_key);
      const hasConflict = keys.includes('gols_ft_over_2_5') && keys.includes('gols_ft_under_2_5');
      assert.ok(!hasConflict, `contradiction found: ${keys.join(' + ')}`);
    }
  });

  it('duplas: require_different_families works', async () => {
    const result = await applyStrategy('duplas', SLOTS);
    for (const pick of result.picks) {
      const fams = new Set(pick.legs.map((l) => l.family));
      assert.equal(fams.size, 2, `expected 2 different families, got: ${[...fams]}`);
    }
  });

  it('duplas: combo_odd within range [2.0, 4.0]', async () => {
    const result = await applyStrategy('duplas', SLOTS);
    for (const pick of result.picks) {
      assert.ok(pick.combo_odd >= 2.0, `combo_odd ${pick.combo_odd} < 2.0`);
      assert.ok(pick.combo_odd <= 4.0, `combo_odd ${pick.combo_odd} > 4.0`);
    }
  });

  it('duplas: ranked by ev_sum_pct desc', async () => {
    const result = await applyStrategy('duplas', SLOTS);
    for (let i = 1; i < result.picks.length; i++) {
      assert.ok(result.picks[i - 1].rank_value >= result.picks[i].rank_value,
        `picks[${i - 1}].rank (${result.picks[i - 1].rank_value}) < picks[${i}].rank (${result.picks[i].rank_value})`);
    }
  });

  it('duplas: match with only 1 leg produces no combos', async () => {
    const result = await applyStrategy('duplas', SLOTS);
    assert.ok(!result.picks.some((p) => p.match_id === 'm2'),
      'm2 should not appear (only 1 eligible leg)');
  });

  it('desk test: gols_over_2.5 (1.70) + esc_over_9.5 (1.65) → combo_odd 2.805', async () => {
    const result = await applyStrategy('duplas', SLOTS);
    const pick = result.picks.find((p) =>
      p.legs.some((l) => l.market_key === 'gols_ft_over_2_5') &&
      p.legs.some((l) => l.market_key === 'esc_ft_over_9_5'),
    );
    assert.ok(pick, 'should find gols+esc combo');
    assert.ok(Math.abs(pick.combo_odd - 2.805) < 0.01,
      `combo_odd ${pick.combo_odd} ≠ expected 2.805`);
  });
});
