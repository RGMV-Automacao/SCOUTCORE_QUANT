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

  it('yankee: selects final N board respecting max_per_league before BIBD', async () => {
    const manySlots = [];
    for (let i = 1; i <= 16; i++) {
      const m = `mx${i}`;
      const liga = i <= 10 ? 'liga-a' : 'liga-b';
      manySlots.push(makeSlot(m, { liga, market_key: 'gols_ft_over_2_5', family: 'gols', market_odd: 1.50, confidence: 0.70 + i / 100 }));
      manySlots.push(makeSlot(m, { liga, market_key: 'btts_sim', family: 'btts', market_odd: 1.50, confidence: 0.70 + i / 100 }));
      manySlots.push(makeSlot(m, { liga, market_key: 'cart_ht_over_1_5', family: 'cartoes', market_odd: 1.50, period: '1T', confidence: 0.70 + i / 100 }));
    }

    const result = await applyStrategy('yankee', manySlots, {
      n_confrontos: [10],
      diversity: { max_per_league: 5, min_families: 3, min_team_or_ht: 2, max_same_family_pct: 0.45 },
    });

    assert.equal(result.board.board_status, 'ok');
    assert.equal(result.board.stats.approved_count, 16);
    assert.equal(result.board.ready_combos.length, 10);
    assert.equal(result.tickets.length, 10);
    assert.equal(result.board.stats.league_counts['liga-a'], 5);
    assert.equal(result.board.stats.league_counts['liga-b'], 5);
  });

  it('yankee: blocks dominated pair btts_sim + gols_total_over_1.5', async () => {
    const dominatedSlots = [];
    for (let i = 1; i <= 10; i++) {
      const m = `dom${i}`;
      dominatedSlots.push(makeSlot(m, {
        market_key: 'gols_total_ft_over_1_5',
        family: 'gols',
        scope: 'total',
        period: 'FT',
        direction: 'over',
        line: 1.5,
        market_odd: 1.38,
        confidence: 0.82,
      }));
      dominatedSlots.push(makeSlot(m, {
        market_key: 'btts_total_ft_sim',
        family: 'btts',
        scope: 'total',
        period: 'FT',
        direction: 'sim',
        line: null,
        market_odd: 1.90,
        confidence: 0.81,
      }));
      dominatedSlots.push(makeSlot(m, {
        market_key: 'cart_ht_over_1_5',
        family: 'cartoes',
        scope: 'total',
        period: 'HT',
        direction: 'over',
        line: 1.5,
        market_odd: 1.55,
        confidence: 0.70,
      }));
    }

    const result = await applyStrategy('yankee', dominatedSlots, {
      n_confrontos: [10],
      diversity: { max_per_league: 10, min_families: 2, min_team_or_ht: 2, max_same_family_pct: 0.6 },
    });

    assert.ok(result.board, 'should have board');
    assert.equal(result.board.ready_combos.length, 10);

    for (const combo of result.board.ready_combos) {
      const keys = combo.legs.map((leg) => leg.market_key);
      const hasDominatedPair = keys.includes('gols_total_ft_over_1_5') && keys.includes('btts_total_ft_sim');
      assert.equal(hasDominatedPair, false, `dominated pair found in combo: ${keys.join(' + ')}`);
    }
  });

  it('yankee: requires distinct families in every combo', async () => {
    const repeatedFamilySlots = [];
    for (let i = 1; i <= 10; i++) {
      const m = `fam${i}`;
      repeatedFamilySlots.push(makeSlot(m, {
        market_key: 'gols_total_ft_over_1_5',
        family: 'gols',
        scope: 'total',
        period: 'FT',
        direction: 'over',
        line: 1.5,
        market_odd: 1.32,
        confidence: 0.90,
      }));
      repeatedFamilySlots.push(makeSlot(m, {
        market_key: 'escanteios_home_ft_under_4_5',
        family: 'escanteios',
        scope: 'home',
        period: 'FT',
        direction: 'under',
        line: 4.5,
        market_odd: 1.50,
        confidence: 0.85,
      }));
      repeatedFamilySlots.push(makeSlot(m, {
        market_key: 'gols_total_2t_over_0_5',
        family: 'gols',
        scope: 'total',
        period: '2T',
        direction: 'over',
        line: 0.5,
        market_odd: 1.35,
        confidence: 0.88,
      }));
      repeatedFamilySlots.push(makeSlot(m, {
        market_key: 'cart_ht_over_1_5',
        family: 'cartoes',
        scope: 'total',
        period: '1T',
        direction: 'over',
        line: 1.5,
        market_odd: 1.70,
        confidence: 0.80,
      }));
    }

    const result = await applyStrategy('yankee', repeatedFamilySlots, {
      n_confrontos: [10],
      diversity: { max_per_league: 10, min_families: 3, min_team_or_ht: 2, max_same_family_pct: 0.5 },
    });

    assert.ok(result.board, 'should have board');
    assert.equal(result.board.board_status, 'ok');
    assert.equal(result.board.ready_combos.length, 10);

    for (const combo of result.board.ready_combos) {
      const families = combo.legs.map((leg) => leg.family);
      const distinctFamilies = new Set(families).size;
      assert.equal(distinctFamilies, combo.legs.length, `repeated family combo found: ${families.join(',')}`);
      const keys = combo.legs.map((leg) => leg.market_key);
      const hasRepeatedGoals = keys.includes('gols_total_ft_over_1_5') && keys.includes('gols_total_2t_over_0_5');
      assert.equal(hasRepeatedGoals, false, `repeated goals pair found in combo: ${keys.join(' + ')}`);
    }
  });

  it('yankee: treats canonical 1x2 and dupla as trusted families', async () => {
    const aliasSlots = [];
    for (let i = 1; i <= 10; i++) {
      const m = `alias${i}`;
      aliasSlots.push(makeSlot(m, {
        market_key: '1x2_total_ft_home',
        family: '1x2',
        scope: 'total',
        period: 'FT',
        direction: 'home',
        line: null,
        market_odd: 1.55,
        confidence: 0.84,
      }));
      aliasSlots.push(makeSlot(m, {
        market_key: 'dupla_total_ft_12',
        family: 'dupla',
        scope: 'total',
        period: 'FT',
        direction: '12',
        line: null,
        market_odd: 1.45,
        confidence: 0.82,
      }));
      aliasSlots.push(makeSlot(m, {
        market_key: 'cart_ht_over_1_5',
        family: 'cartoes',
        scope: 'total',
        period: 'HT',
        direction: 'over',
        line: 1.5,
        market_odd: 1.35,
        confidence: 0.70,
      }));
    }

    const result = await applyStrategy('yankee', aliasSlots, {
      n_confrontos: [10],
      diversity: { max_per_league: 10, min_families: 3, min_team_or_ht: 2, max_same_family_pct: 0.5 },
    });

    assert.equal(result.board.board_status, 'ok');
    for (const combo of result.board.ready_combos) {
      assert.equal(combo.trusted_count, 2);
      assert.ok(combo.families.includes('1x2'));
      assert.ok(combo.families.includes('dupla'));
    }
  });
});
