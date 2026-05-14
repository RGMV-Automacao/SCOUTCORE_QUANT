/**
 * Mesa de teste — correlation.mjs
 * Verifica classificação e fatores de correlação BB para todos os cenários.
 *
 * Execução: node packages/strategy-engine/test/correlation.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { correlationFactor, comboCorrelationFactor, DEFAULT_CORRELATION_PENALTIES } from '../src/lib/correlation.mjs';

function leg(overrides) {
  return { family: 'escanteios', scope: 'total', period: 'FT', direction: 'under', ...overrides };
}

describe('correlation.mjs — Bet Builder correlation penalties', () => {

  it('CAT-A: same family, same dir, cross period → 0.73', () => {
    const a = leg({ period: 'HT', direction: 'under' });
    const b = leg({ period: 'FT', direction: 'under' });
    assert.equal(correlationFactor(a, b), 0.73);
  });

  it('CAT-B: same family, diff dir, cross period → 0.85', () => {
    const a = leg({ period: 'HT', direction: 'over' });
    const b = leg({ period: 'FT', direction: 'under' });
    assert.equal(correlationFactor(a, b), 0.85);
  });

  it('CAT-C: same family, same period, diff scope → 0.87', () => {
    const a = leg({ scope: 'home', period: 'FT' });
    const b = leg({ scope: 'away', period: 'FT' });
    assert.equal(correlationFactor(a, b), 0.87);
  });

  it('CAT-D: diff family, same period → 0.885', () => {
    const a = leg({ family: 'escanteios', period: 'FT' });
    const b = leg({ family: 'gols', period: 'FT' });
    assert.equal(correlationFactor(a, b), 0.885);
  });

  it('CAT-E: diff family, cross period → 0.97', () => {
    const a = leg({ family: 'escanteios', period: 'HT' });
    const b = leg({ family: 'gols', period: 'FT' });
    assert.equal(correlationFactor(a, b), 0.97);
  });

  it('same family, same period, same scope → 1.0 (fallback)', () => {
    const a = leg({ family: 'gols', scope: 'total', period: 'FT', direction: 'over' });
    const b = leg({ family: 'gols', scope: 'total', period: 'FT', direction: 'under' });
    assert.equal(correlationFactor(a, b), 1.0);
  });

  it('comboCorrelationFactor: 2 legs CAT-D', () => {
    const legs = [
      leg({ family: 'escanteios', period: 'FT' }),
      leg({ family: 'gols', period: 'FT' }),
    ];
    const f = comboCorrelationFactor(legs);
    assert.equal(f, 0.885);
  });

  it('comboCorrelationFactor: 3 legs = product of 3 pairs', () => {
    const legs = [
      leg({ family: 'escanteios', scope: 'total', period: 'FT', direction: 'under' }),
      leg({ family: 'gols', scope: 'total', period: 'FT', direction: 'over' }),
      leg({ family: 'cartoes', scope: 'total', period: 'FT', direction: 'over' }),
    ];
    // 3 pairs, all CAT-D (diff family, same period FT): 0.885^3
    const expected = 0.885 * 0.885 * 0.885;
    const actual = comboCorrelationFactor(legs);
    assert.ok(Math.abs(actual - expected) < 1e-10,
      `expected ${expected}, got ${actual}`);
  });

  it('comboCorrelationFactor: 1 leg → 1.0', () => {
    assert.equal(comboCorrelationFactor([leg()]), 1.0);
  });

  it('comboCorrelationFactor: 0 legs → 1.0', () => {
    assert.equal(comboCorrelationFactor([]), 1.0);
  });

  it('desk test: Esc Under HT @1.87 + Esc Under FT @1.42 → factor 0.73', () => {
    // Empirical: raw 2.655 → BB 1.95 → fator ≈ 0.734 (rounded to 0.73)
    const a = leg({ period: 'HT', direction: 'under' });
    const b = leg({ period: 'FT', direction: 'under' });
    const f = correlationFactor(a, b);
    assert.equal(f, 0.73);
    // Simulated: 1.87 * 1.42 * 0.73 = 1.939...  ≈ BB 1.95 ✓
    const simulated = 1.87 * 1.42 * f;
    assert.ok(Math.abs(simulated - 1.94) < 0.05,
      `simulated ${simulated} should be ≈ 1.94 (BB gave 1.95)`);
  });
});
