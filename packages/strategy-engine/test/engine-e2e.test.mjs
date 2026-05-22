/**
 * Mesa de teste — Strategy Engine E2E
 * Testa o registry + runners com slots simulados realistas.
 *
 * Execução: node packages/strategy-engine/test/engine-e2e.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { listStrategies, getStrategyConfig, applyStrategy, __resetConfigCache } from '../src/index.mjs';

// ── Slots simulados (4 confrontos, ~5 mercados cada) ──────────────────────
function makeSlot(overrides) {
  return {
    match_id: 'match_1',
    home: 'Flamengo',
    away: 'Palmeiras',
    liga: 'brasileirao',
    date: '2026-05-13',
    market_key: 'gols_total_ft_over_2_5',
    family: 'gols',
    scope: 'total',
    period: 'FT',
    direction: 'over',
    line: 2.5,
    fair_prob: 0.55,
    fair_odd: 1.82,
    confidence: 0.78,
    certified: true,
    market_odd: 2.10,
    edge_pct: 5.4,
    engine_source: 'curinga',
    ...overrides,
  };
}

const SLOTS = [
  // Flamengo x Palmeiras
  makeSlot({ match_id: 'm1', market_key: 'gols_ft_over_2_5', family: 'gols', direction: 'over', line: 2.5, fair_prob: 0.55, market_odd: 2.10, edge_pct: 5.4, confidence: 0.78 }),
  makeSlot({ match_id: 'm1', market_key: 'btts_ft_sim', family: 'btts', direction: 'sim', line: null, fair_prob: 0.52, market_odd: 1.85, edge_pct: 3.2, confidence: 0.72 }),
  makeSlot({ match_id: 'm1', market_key: 'esc_ft_over_9_5', family: 'escanteios', direction: 'over', line: 9.5, fair_prob: 0.60, market_odd: 1.75, edge_pct: 5.0, confidence: 0.82 }),
  makeSlot({ match_id: 'm1', market_key: '1x2_total_ft_home', family: '1x2', direction: 'home', line: null, fair_prob: 0.62, market_odd: 1.90, edge_pct: 7.8, confidence: 0.85 }),
  makeSlot({ match_id: 'm1', market_key: 'cartoes_ft_over_3_5', family: 'cartoes', direction: 'over', line: 3.5, fair_prob: 0.58, market_odd: 1.80, edge_pct: 4.4, confidence: 0.70 }),

  // Grêmio x Internacional
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Internacional', market_key: 'gols_ft_under_2_5', family: 'gols', direction: 'under', line: 2.5, fair_prob: 0.48, market_odd: 1.95, edge_pct: 2.1, confidence: 0.68 }),
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Internacional', market_key: 'esc_ft_over_10_5', family: 'escanteios', direction: 'over', line: 10.5, fair_prob: 0.45, market_odd: 2.30, edge_pct: 3.5, confidence: 0.65 }),
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Internacional', market_key: 'dupla_total_ft_1x', family: 'dupla', direction: '1x', line: null, fair_prob: 0.67, market_odd: 1.65, edge_pct: 10.6, confidence: 0.76 }),
  makeSlot({ match_id: 'm2', home: 'Grêmio', away: 'Internacional', market_key: 'resultado_ft_draw', family: 'resultado', direction: 'draw', line: null, fair_prob: 0.30, market_odd: 3.50, edge_pct: 5.0, confidence: 0.60 }),

  // Barcelona x Real Madrid
  makeSlot({ match_id: 'm3', home: 'Barcelona', away: 'Real Madrid', liga: 'la-liga', market_key: 'gols_ft_over_3_5', family: 'gols', direction: 'over', line: 3.5, fair_prob: 0.40, market_odd: 2.80, edge_pct: 12.0, confidence: 0.75 }),
  makeSlot({ match_id: 'm3', home: 'Barcelona', away: 'Real Madrid', liga: 'la-liga', market_key: 'esc_ft_under_8_5', family: 'escanteios', direction: 'under', line: 8.5, fair_prob: 0.88, market_odd: 1.15, edge_pct: 1.2, confidence: 0.90 }),
  // Seguro: prob 88% — deve aparecer no 'seguros'

  // Slot sem odd (phantom) — deve ser excluído por require_market_odd
  makeSlot({ match_id: 'm4', home: 'Teste', away: 'Phantom', market_key: 'gols_ft_over_1_5', family: 'gols', direction: 'over', line: 1.5, fair_prob: 0.90, market_odd: null, edge_pct: null, confidence: 0.92 }),
  // Slot não certificado — deve ser excluído por todos
  makeSlot({ match_id: 'm4', home: 'Teste', away: 'NoCert', market_key: 'gols_ft_under_4_5', family: 'gols', direction: 'under', line: 4.5, fair_prob: 0.92, market_odd: 1.12, edge_pct: 2.0, certified: false }),
];

describe('Strategy Engine E2E', () => {
  beforeEach(() => __resetConfigCache());

  it('listStrategies returns 8 strategies', () => {
    const list = listStrategies();
    assert.ok(list.length >= 8, `expected ≥8 strategies, got ${list.length}`);
    const ids = list.map((s) => s.id);
    assert.ok(ids.includes('yankee'));
    assert.ok(ids.includes('duplas'));
    assert.ok(ids.includes('trincas'));
    assert.ok(ids.includes('bingo-resultado'));
    assert.ok(ids.includes('bingo-escanteios'));
    assert.ok(ids.includes('bingo-cartoes'));
    assert.ok(ids.includes('singles-ev'));
    assert.ok(ids.includes('seguros'));
  });

  it('getStrategyConfig returns correct config', () => {
    const cfg = getStrategyConfig('yankee');
    assert.ok(cfg);
    assert.equal(cfg.type, 'board_based');
    assert.deepEqual(cfg.params.n_confrontos, [10, 12]);
  });

  it('getStrategyConfig returns null for unknown', () => {
    assert.equal(getStrategyConfig('nonexistent'), null);
  });

  it('singles-ev: filters by edge ≥ 3% and requires market_odd', async () => {
    const result = await applyStrategy('singles-ev', SLOTS);
    assert.equal(result.strategy_id, 'singles-ev');
    assert.equal(result.strategy_type, 'global_filter');
    assert.ok(result.output_picks > 0, 'should have picks');
    // Todos devem ter edge ≥ 3
    for (const pick of result.picks) {
      assert.ok(pick.edge_pct >= 3, `pick edge ${pick.edge_pct} < 3`);
      assert.ok(pick.ev_real >= 0.03, `pick ev_real ${pick.ev_real} < 0.03`);
      assert.ok(pick.market_odd != null, 'must have market_odd');
    }
    // Phantom (null odd) deve estar excluído
    assert.ok(!result.picks.some((p) => p.match_id === 'm4' && p.market_odd == null));
    // Não certificado deve estar excluído
    assert.ok(!result.picks.some((p) => p.certified === false));
  });

  it('singles-ev: rejects stale positive edge when recalculated EV is negative', async () => {
    const result = await applyStrategy('singles-ev', [
      makeSlot({
        match_id: 'stale-edge',
        market_key: 'stale_edge_negative_ev',
        fair_prob: 0.40,
        market_odd: 2.00,
        edge_pct: 9.0,
        certified: true,
      }),
      makeSlot({
        match_id: 'valid-edge',
        market_key: 'valid_positive_ev',
        fair_prob: 0.60,
        market_odd: 2.00,
        edge_pct: 9.0,
        certified: true,
      }),
    ]);

    assert.equal(result.picks.some((pick) => pick.market_key === 'stale_edge_negative_ev'), false);
    assert.equal(result.picks.some((pick) => pick.market_key === 'valid_positive_ev'), true);
  });

  it('seguros: only prob ≥ 85%', async () => {
    const result = await applyStrategy('seguros', SLOTS);
    assert.equal(result.strategy_id, 'seguros');
    assert.ok(result.output_picks > 0);
    for (const pick of result.picks) {
      assert.ok(pick.fair_prob >= 0.85, `pick prob ${pick.fair_prob} < 0.85`);
    }
    // Barcelona Esc Under 8.5 (prob=0.88) deve aparecer
    assert.ok(result.picks.some((p) => p.market_key === 'esc_ft_under_8_5'));
  });

  it('bingo-escanteios: only family=escanteios, edge ≥ 3%', async () => {
    const result = await applyStrategy('bingo-escanteios', SLOTS);
    assert.equal(result.strategy_id, 'bingo-escanteios');
    for (const pick of result.picks) {
      assert.equal(pick.family, 'escanteios');
      assert.ok(pick.edge_pct >= 3, `edge ${pick.edge_pct} < 3`);
    }
  });

  it('bingo-resultado: accepts canonical and legacy resultado aliases', async () => {
    const result = await applyStrategy('bingo-resultado', SLOTS);
    assert.equal(result.strategy_id, 'bingo-resultado');
    const validFamilies = new Set(['resultado', '1x2', 'dupla_chance', 'dupla']);
    for (const pick of result.picks) {
      assert.ok(validFamilies.has(pick.family), `unexpected family: ${pick.family}`);
    }
    assert.ok(result.picks.some((pick) => pick.family === '1x2'));
    assert.ok(result.picks.some((pick) => pick.family === 'dupla'));
  });

  it('bingo-cartoes: only family=cartoes', async () => {
    const result = await applyStrategy('bingo-cartoes', SLOTS);
    assert.equal(result.strategy_id, 'bingo-cartoes');
    for (const pick of result.picks) {
      assert.equal(pick.family, 'cartoes');
    }
  });

  it('unknown strategy returns error gracefully', async () => {
    const result = await applyStrategy('nonexistent', SLOTS);
    assert.ok(result.error);
    assert.equal(result.output_picks, 0);
  });

  it('overrides are applied (top_n override)', async () => {
    const result = await applyStrategy('singles-ev', SLOTS, { top_n: 2 });
    assert.ok(result.output_picks <= 2, `expected ≤2 picks, got ${result.output_picks}`);
  });

  it('singles-ev is ranked by ev_real desc', async () => {
    const result = await applyStrategy('singles-ev', SLOTS);
    for (let i = 1; i < result.picks.length; i++) {
      assert.ok(result.picks[i - 1].ev_real >= result.picks[i].ev_real,
        `picks[${i - 1}].ev_real (${result.picks[i - 1].ev_real}) < picks[${i}].ev_real (${result.picks[i].ev_real})`);
    }
  });
});
