import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predict } from '../src/engine.mjs';

const baseCtx = {
  home: 'A', away: 'B', liga: 'BRA1',
  profileHome: {
    avg_gols_marcados: 1.5, avg_gols_sofridos: 1.0,
    avg_escanteios: 5.5, avg_chutes: 12, avg_cartoes_amarelos: 2, avg_faltas_cometidas: 12,
    avg_chutes_alvo: 4.5, avg_impedimentos: 2.0, avg_defesas: 3.5,
    n_events: 10,
  },
  profileAway: {
    avg_gols_marcados: 1.2, avg_gols_sofridos: 1.3,
    avg_escanteios: 4.8, avg_chutes: 10, avg_cartoes_amarelos: 2.2, avg_faltas_cometidas: 13,
    avg_chutes_alvo: 4.0, avg_impedimentos: 2.2, avg_defesas: 3.8,
    n_events: 10,
  },
  priors: {
    avg_goals_total: 2.6, avg_escanteios_total: 10.0, avg_chutes_total: 22,
    avg_cartoes_total: 4.2, avg_faltas_total: 24,
    avg_chutes_alvo_total: 8.5, avg_impedimentos_total: 4.2, avg_defesas_total: 7.3,
  },
};

function findSlot(slots, key) { return slots.find((s) => s.market_key === key); }

test('lambda_mult shifta probabilidade Over de count families', () => {
  const baseline = predict(baseCtx);
  const boosted = predict({ ...baseCtx, calibration: { escanteios: { lambda_mult: 1.20 } } });

  const baseOver = findSlot(baseline.slots, 'escanteios_total_ft_over_9_5');
  const boostOver = findSlot(boosted.slots, 'escanteios_total_ft_over_9_5');
  assert.ok(baseOver && boostOver, 'slot escanteios over_9.5 existe');
  assert.ok(boostOver.fair_prob > baseOver.fair_prob,
    `boost (${boostOver.fair_prob}) deve ser > base (${baseOver.fair_prob})`);
});

test('lambda_mult não afeta gols/btts/1x2 (matrix conjunta)', () => {
  const baseline = predict(baseCtx);
  // Calib em escanteios não pode mexer em gols/btts.
  const withCalib = predict({ ...baseCtx, calibration: { escanteios: { lambda_mult: 1.50 } } });

  const baseGols = findSlot(baseline.slots, 'gols_total_ft_over_2_5');
  const calibGols = findSlot(withCalib.slots, 'gols_total_ft_over_2_5');
  assert.equal(baseGols.fair_prob, calibGols.fair_prob);
});

test('lambda_mult propaga em provenance', () => {
  const out = predict({ ...baseCtx, calibration: { chutes: { lambda_mult: 0.85 } } });
  const slot = out.slots.find((s) => s.family === 'chutes' && s.scope === 'total');
  assert.equal(slot.provenance.lambda_mult, 0.85);
});

test('sem calibration: lambda_mult=1.0 (no-op)', () => {
  const out = predict(baseCtx);
  const slot = out.slots.find((s) => s.family === 'escanteios');
  assert.equal(slot.provenance.lambda_mult, 1.0);
});

test('Engine A emite todo o catalogo canonico de 576 mercados', () => {
  const out = predict(baseCtx);
  assert.equal(out.slots.length, 576);
  assert.ok(findSlot(out.slots, 'gols_home_ht_over_0_5'));
  assert.ok(findSlot(out.slots, 'gols_away_ht_under_1_5'));
  assert.ok(findSlot(out.slots, 'escanteios_asian_total_ft_over_9_25'));
});

test('lambda_mult Under: Over diminui ⇒ Under aumenta (complementar)', () => {
  const baseline = predict(baseCtx);
  const reduced = predict({ ...baseCtx, calibration: { faltas: { lambda_mult: 0.80 } } });

  const baseOver = baseline.slots.find((s) => s.family === 'faltas' && s.direction === 'over');
  const baseUnder = baseline.slots.find((s) => s.family === 'faltas' && s.direction === 'under' && s.market_key === baseOver.market_key.replace('over', 'under'));
  const redOver = reduced.slots.find((s) => s.market_key === baseOver.market_key);
  const redUnder = reduced.slots.find((s) => s.market_key === baseUnder.market_key);

  assert.ok(redOver.fair_prob < baseOver.fair_prob, 'Over com lm<1 deve cair');
  assert.ok(redUnder.fair_prob > baseUnder.fair_prob, 'Under deve subir');
  assert.ok(Math.abs((redOver.fair_prob + redUnder.fair_prob) - 1) < 1e-6, 'soma=1');
});
