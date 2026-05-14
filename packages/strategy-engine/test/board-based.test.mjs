/**
 * Mesa de teste — board_based runner (Yankee)
 *
 * Execução: node packages/strategy-engine/test/board-based.test.mjs
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyStrategy, __resetConfigCache } from '../src/index.mjs';

function makeSlot(matchId, overrides) {
  return {
    match_id: matchId, home: 'Team A', away: 'Team B', liga: 'brasileirao',
    date: '2026-05-13', market_key: 'test', family: 'gols', scope: 'total',
    period: 'FT', direction: 'over', line: 2.5, fair_prob: 0.55, fair_odd: 1.82,
    confidence: 0.78, certified: true, market_odd: 1.70, edge_pct: 5.0,
    engine_source: 'curinga', ...overrides,
  };
}

// Criar 10 confrontos com 3 legs válidas cada para garantir um board_status = 'ok'
const SLOTS = [];
for (let i = 1; i <= 10; i++) {
  const m = `m${i}`;
  SLOTS.push(makeSlot(m, { market_key: 'gols_ft_over_2_5', family: 'gols', market_odd: 1.50 }));
  SLOTS.push(makeSlot(m, { market_key: 'esc_ft_over_9_5', family: 'escanteios', market_odd: 1.50 }));
  SLOTS.push(makeSlot(m, { market_key: 'cart_ft_over_3_5', family: 'cartoes', market_odd: 1.50, period: '1T' }));
}

describe('board_based runner — Yankee', () => {
  beforeEach(() => __resetConfigCache());

  it('yankee: generates board and 10 tickets for N=10', async () => {
    const result = await applyStrategy('yankee', SLOTS, { diversity: { max_per_league: 10 } });
    assert.equal(result.strategy_type, 'board_based');
    
    assert.ok(result.board, 'should have board');
    assert.equal(result.board.board_status, 'ok');
    assert.equal(result.board.ready_combos.length, 10);
    
    assert.ok(result.tickets.length > 0, 'should produce tickets');
    assert.equal(result.tickets.length, 10, 'N=10 BIBD should have 10 tickets');
    
    for (const ticket of result.tickets) {
      assert.equal(ticket.confronto_indices.length, 4, 'each ticket should have 4 match indices');
      assert.equal(ticket.match_ids.length, 4, 'each ticket should have 4 match ids');
      assert.ok(ticket.ticket_odd > 0, 'should have ticket_odd');
    }
  });

  it('yankee: fails board validation if insufficient matches', async () => {
    const fewSlots = SLOTS.filter((s) => ['m1', 'm2'].includes(s.match_id));
    const result = await applyStrategy('yankee', fewSlots);
    assert.equal(result.board.board_status, 'insufficient');
    assert.equal(result.tickets.length, 0);
    assert.equal(result.meta.yankee_status, 'skipped');
  });

  it('yankee: diversity fail if missing team/HT legs', async () => {
    const noHtSlots = SLOTS.map(s => ({ ...s, period: 'FT', scope: 'total' }));
    const result = await applyStrategy('yankee', noHtSlots);
    assert.equal(result.board.board_status, 'diversity_fail');
    assert.equal(result.tickets.length, 0);
    assert.ok(result.meta.warnings.some(w => w.includes('team/HT')));
  });
});
