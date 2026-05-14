/**
 * Mesa de teste — combo_scored runner (Trincas)
 * Verifica correlation penalties, odd adjustment, scoring, max_per_family.
 *
 * Execução: node packages/strategy-engine/test/combo-scored.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyStrategy, __resetConfigCache } from '../src/index.mjs';

function makeSlot(overrides) {
  return {
    match_id: 'm1', home: 'Flamengo', away: 'Palmeiras', liga: 'brasileirao',
    date: '2026-05-13', market_key: 'test', family: 'gols', scope: 'total',
    period: 'FT', direction: 'over', line: 2.5, fair_prob: 0.55, fair_odd: 1.82,
    confidence: 0.78, certified: true, market_odd: 1.70, edge_pct: 5.0,
    engine_source: 'curinga', ...overrides,
  };
}

const SLOTS = [
  // Match 1: 4 legs, 3 families
  makeSlot({ market_key: 'gols_ft_over_2_5', family: 'gols', scope: 'total', period: 'FT', direction: 'over', line: 2.5, market_odd: 1.70, fair_prob: 0.55, edge_pct: 5.0 }),
  makeSlot({ market_key: 'esc_ft_over_9_5', family: 'escanteios', scope: 'total', period: 'FT', direction: 'over', line: 9.5, market_odd: 1.65, fair_prob: 0.58, edge_pct: 4.0 }),
  makeSlot({ market_key: 'cart_ft_over_3_5', family: 'cartoes', scope: 'total', period: 'FT', direction: 'over', line: 3.5, market_odd: 1.50, fair_prob: 0.62, edge_pct: 3.0 }),
  makeSlot({ market_key: 'esc_ht_over_4_5', family: 'escanteios', scope: 'total', period: 'HT', direction: 'over', line: 4.5, market_odd: 1.80, fair_prob: 0.52, edge_pct: 3.5 }),

  // Match 2: 3 legs mesma família (deve respeitar max_per_family=2)
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Inter', market_key: 'gols_ft_over_1_5', family: 'gols', period: 'FT', direction: 'over', line: 1.5, market_odd: 1.30, fair_prob: 0.75, edge_pct: 2.5 }),
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Inter', market_key: 'gols_ht_over_0_5', family: 'gols', period: 'HT', direction: 'over', line: 0.5, market_odd: 1.55, fair_prob: 0.65, edge_pct: 3.0 }),
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Inter', market_key: 'gols_ft_over_2_5', family: 'gols', period: 'FT', direction: 'over', line: 2.5, market_odd: 2.20, fair_prob: 0.45, edge_pct: 4.0 }),
];

describe('combo_scored runner — Trincas', () => {
  beforeEach(() => __resetConfigCache());

  it('trincas: generates combos with 2-4 legs', async () => {
    const result = await applyStrategy('trincas', SLOTS);
    assert.equal(result.strategy_type, 'combo_scored');
    assert.ok(result.output_picks > 0, 'should produce picks');
    for (const pick of result.picks) {
      assert.ok(pick.n_legs >= 2, `n_legs ${pick.n_legs} < 2`);
      assert.ok(pick.n_legs <= 4, `n_legs ${pick.n_legs} > 4`);
    }
  });

  it('trincas: combo_odd_adjusted < combo_odd_raw (correlation penalty applied)', async () => {
    const result = await applyStrategy('trincas', SLOTS);
    for (const pick of result.picks) {
      if (pick.n_legs >= 2) {
        assert.ok(pick.combo_odd_adjusted <= pick.combo_odd_raw,
          `adjusted ${pick.combo_odd_adjusted} > raw ${pick.combo_odd_raw}`);
        assert.ok(pick.correlation_factor <= 1.0,
          `correlation_factor ${pick.correlation_factor} > 1.0`);
      }
    }
  });

  it('trincas: max_legs_per_family = 2 respected', async () => {
    const result = await applyStrategy('trincas', SLOTS);
    for (const pick of result.picks) {
      const famCounts = new Map();
      for (const leg of pick.legs) {
        famCounts.set(leg.family, (famCounts.get(leg.family) || 0) + 1);
      }
      for (const [fam, cnt] of famCounts) {
        assert.ok(cnt <= 2, `family ${fam} has ${cnt} legs (max 2)`);
      }
    }
  });

  it('trincas: ranked by score desc', async () => {
    const result = await applyStrategy('trincas', SLOTS);
    for (let i = 1; i < result.picks.length; i++) {
      assert.ok(result.picks[i - 1].score >= result.picks[i].score,
        `picks[${i - 1}].score (${result.picks[i - 1].score}) < picks[${i}].score (${result.picks[i].score})`);
    }
  });

  it('desk test: 3 legs diff family same period FT → factor 0.885^3 ≈ 0.6932', async () => {
    const result = await applyStrategy('trincas', SLOTS);
    // Find a combo with gols+esc+cart (all FT, CAT-D pairs)
    const pick = result.picks.find((p) =>
      p.n_legs === 3 &&
      p.families.includes('gols') &&
      p.families.includes('escanteios') &&
      p.families.includes('cartoes') &&
      p.legs.every((l) => l.period === 'FT'),
    );
    if (pick) {
      // 3 pairs, all CAT-D → 0.885^3 = 0.6932
      const expected = 0.885 ** 3;
      assert.ok(Math.abs(pick.correlation_factor - expected) < 0.01,
        `correlation_factor ${pick.correlation_factor} ≈ expected ${expected.toFixed(4)}`);
      // raw = 1.70 * 1.65 * 1.50 = 4.2075 → adjusted = 4.2075 * 0.6932 = 2.916
      const rawExpected = 1.70 * 1.65 * 1.50;
      assert.ok(Math.abs(pick.combo_odd_raw - rawExpected) < 0.01,
        `raw ${pick.combo_odd_raw} ≈ ${rawExpected.toFixed(3)}`);
    }
  });

  it('trincas: cross-period pair gets CAT-A penalty (esc FT + esc HT same dir)', async () => {
    const result = await applyStrategy('trincas', SLOTS);
    // Find combo with esc_ft_over + esc_ht_over (CAT-A: same fam, same dir, cross period)
    const pick = result.picks.find((p) =>
      p.legs.some((l) => l.market_key === 'esc_ft_over_9_5') &&
      p.legs.some((l) => l.market_key === 'esc_ht_over_4_5'),
    );
    if (pick) {
      // This pair contributes 0.73 to the correlation factor
      assert.ok(pick.correlation_factor < 0.87,
        `correlation with CAT-A pair should be < 0.87, got ${pick.correlation_factor}`);
    }
  });
});
