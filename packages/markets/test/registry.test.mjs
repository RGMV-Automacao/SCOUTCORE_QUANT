import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeMarketKey,
  normalizeMarketSnapshot,
  MARKET_KEY_ALIASES,
} from '../src/index.mjs';

test('canonicalizeMarketKey: traduz aliases legados principais', () => {
  assert.equal(canonicalizeMarketKey('gols_total_ft_over_25'), 'gols_total_ft_over_2_5');
  assert.equal(canonicalizeMarketKey('escanteios_total_ft_over_95'), 'escanteios_total_ft_over_9_5');
  assert.equal(canonicalizeMarketKey('chutes_total_ft_over_255'), 'chutes_total_ft_over_25_5');
  assert.equal(canonicalizeMarketKey('btts_sim'), 'btts_total_ft_sim');
  assert.equal(canonicalizeMarketKey('btts_ft_nao'), 'btts_total_ft_nao');
  assert.equal(canonicalizeMarketKey('resultado_1x2_ft_home'), '1x2_total_ft_home');
  assert.equal(canonicalizeMarketKey('resultado_dupla_ht_x2'), 'dupla_total_ht_x2');
  assert.equal(canonicalizeMarketKey('1x2_draw'), '1x2_total_ft_draw');
});

test('canonicalizeMarketKey: alias map exporta traducoes conhecidas', () => {
  assert.equal(MARKET_KEY_ALIASES.gols_total_ft_over_25, 'gols_total_ft_over_2_5');
  assert.equal(MARKET_KEY_ALIASES.escanteios_total_ft_over_95, 'escanteios_total_ft_over_9_5');
  assert.equal(MARKET_KEY_ALIASES.chutes_total_ft_over_255, 'chutes_total_ft_over_25_5');
  assert.equal(MARKET_KEY_ALIASES.btts_ft_sim, 'btts_total_ft_sim');
  // v2.0.0 — 1x2 só FT/HT (2T removido do whitelist Superbet)
  assert.equal(MARKET_KEY_ALIASES.resultado_1x2_ht_away, '1x2_total_ht_away');
  assert.equal(MARKET_KEY_ALIASES.resultado_dupla_ft_12, 'dupla_total_ft_12');
});

test('normalizeMarketSnapshot: aplica aliases built-in e explicitos', () => {
  const warnings = [];
  const normalized = normalizeMarketSnapshot({
    gols_total_ft_over_25: 1.85,
    escanteios_total_ft_over_95: 1.91,
    btts_ft_sim: 1.8,
    '1x2_home': 2.05,
    legacy_custom: 3.1,
  }, {
    legacy_custom: 'chutes_total_ft_over_25_5',
  }, warnings);

  assert.deepEqual(normalized, {
    gols_total_ft_over_2_5: 1.85,
    escanteios_total_ft_over_9_5: 1.91,
    btts_total_ft_sim: 1.8,
    '1x2_total_ft_home': 2.05,
    chutes_total_ft_over_25_5: 3.1,
  });
  assert.deepEqual(warnings, [
    'market_alias_resolved:gols_total_ft_over_25->gols_total_ft_over_2_5',
    'market_alias_resolved:escanteios_total_ft_over_95->escanteios_total_ft_over_9_5',
    'market_alias_resolved:btts_ft_sim->btts_total_ft_sim',
    'market_alias_resolved:1x2_home->1x2_total_ft_home',
    'market_alias_resolved:legacy_custom->chutes_total_ft_over_25_5',
  ]);
});

test('catalogo v2.1 cobre os 598 slots da tela Superbet', async () => {
  const { MARKETS, MARKETS_VERSION, getMarket } = await import('../src/registry.mjs');
  assert.equal(MARKETS_VERSION, '2.1.1');
  assert.equal(MARKETS.length, 598);
  assert.ok(getMarket('cartoes_1x2_total_ht_draw'));
  assert.ok(getMarket('cartoes_total_ft_over_0_5'));
  assert.ok(getMarket('escanteios_total_ft_over_3_5'));
  assert.ok(getMarket('escanteios_total_ft_under_18_5'));
  assert.ok(getMarket('escanteios_handicap_total_ft_home_minus_5_5'));
  assert.ok(getMarket('escanteios_handicap_total_ft_away_plus_5_5'));
  assert.ok(getMarket('defesas_total_ht_over_2_5'));
  assert.ok(getMarket('faltas_home_ht_under_6_5'));
  assert.ok(getMarket('desarmes_total_ft_over_30_5'));
  assert.equal(getMarket('desarmes_total_ft_over_14_5'), null);
});