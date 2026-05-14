/**
 * Mesa de teste — contradiction.mjs
 * Verifica todas as regras de contradição pair-wise portadas do legado.
 *
 * Execução: node packages/strategy-engine/test/contradiction.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkContradiction } from '../src/lib/contradiction.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────
function slot(overrides) {
  return { family: 'gols', scope: 'total', period: 'FT', direction: 'over', line: 2.5, ...overrides };
}

describe('contradiction.mjs — pair-wise conflict detection', () => {

  it('over/under same line = conflict', () => {
    const a = slot({ direction: 'over', line: 2.5 });
    const b = slot({ direction: 'under', line: 2.5 });
    const r = checkContradiction(a, b);
    assert.equal(r.conflict, true);
    assert.match(r.reason, /over\/under/);
  });

  it('over/under different lines = no conflict', () => {
    const a = slot({ direction: 'over', line: 2.5 });
    const b = slot({ direction: 'under', line: 3.5 });
    assert.equal(checkContradiction(a, b).conflict, false);
  });

  it('over/over same line = no conflict', () => {
    const a = slot({ direction: 'over', line: 2.5 });
    const b = slot({ direction: 'over', line: 2.5 });
    assert.equal(checkContradiction(a, b).conflict, false);
  });

  it('different families = no conflict', () => {
    const a = slot({ family: 'gols', direction: 'over', line: 2.5 });
    const b = slot({ family: 'escanteios', direction: 'under', line: 2.5 });
    assert.equal(checkContradiction(a, b).conflict, false);
  });

  it('different periods = no conflict', () => {
    const a = slot({ period: 'FT', direction: 'over', line: 2.5 });
    const b = slot({ period: 'HT', direction: 'under', line: 2.5 });
    assert.equal(checkContradiction(a, b).conflict, false);
  });

  it('btts sim + nao = conflict', () => {
    const a = slot({ family: 'btts', scope: 'total', direction: 'sim', line: null });
    const b = slot({ family: 'btts', scope: 'total', direction: 'nao', line: null });
    const r = checkContradiction(a, b);
    assert.equal(r.conflict, true);
    assert.match(r.reason, /btts sim\/nao/);
  });

  it('btts yes + no = conflict', () => {
    const a = slot({ family: 'btts', scope: 'total', direction: 'yes', line: null });
    const b = slot({ family: 'btts', scope: 'total', direction: 'no', line: null });
    assert.equal(checkContradiction(a, b).conflict, true);
  });

  it('btts sim + sim = no conflict', () => {
    const a = slot({ family: 'btts', scope: 'total', direction: 'sim', line: null });
    const b = slot({ family: 'btts', scope: 'total', direction: 'sim', line: null });
    assert.equal(checkContradiction(a, b).conflict, false);
  });

  it('btts_sim + gols_equipe_under_0.5 = contradiction (BTTS exige ≥1 gol)', () => {
    const a = slot({ family: 'btts', scope: 'total', period: 'FT', direction: 'sim', line: null });
    const b = slot({ family: 'gols', scope: 'equipe_casa', period: 'FT', direction: 'under', line: 0.5 });
    const r = checkContradiction(a, b);
    assert.equal(r.conflict, true);
    assert.match(r.reason, /contraditório/);
  });

  it('btts_sim + gols_equipe_over_0.5 = redundant (equipe já garantida)', () => {
    const a = slot({ family: 'btts', scope: 'total', period: 'FT', direction: 'sim', line: null });
    const b = slot({ family: 'gols', scope: 'equipe_casa', period: 'FT', direction: 'over', line: 0.5 });
    const r = checkContradiction(a, b);
    assert.equal(r.conflict, true);
    assert.match(r.reason, /redundante/);
  });

  it('btts_sim + gols_total_under_1.5 = contradiction (BTTS exige ≥2 gols)', () => {
    const a = slot({ family: 'btts', scope: 'total', period: 'FT', direction: 'sim', line: null });
    const b = slot({ family: 'gols', scope: 'total', period: 'FT', direction: 'under', line: 1.5 });
    const r = checkContradiction(a, b);
    assert.equal(r.conflict, true);
    assert.match(r.reason, /contraditório/);
  });

  it('btts_sim + gols_total_under_2.5 = no conflict (≥2.5 is fine)', () => {
    const a = slot({ family: 'btts', scope: 'total', period: 'FT', direction: 'sim', line: null });
    const b = slot({ family: 'gols', scope: 'total', period: 'FT', direction: 'under', line: 2.5 });
    assert.equal(checkContradiction(a, b).conflict, false);
  });

  it('btts_sim HT + gols_equipe_under_0.5 FT = no conflict (different periods)', () => {
    const a = slot({ family: 'btts', scope: 'total', period: 'HT', direction: 'sim', line: null });
    const b = slot({ family: 'gols', scope: 'equipe_casa', period: 'FT', direction: 'under', line: 0.5 });
    assert.equal(checkContradiction(a, b).conflict, false);
  });

  it('mais/menos same line = conflict', () => {
    const a = slot({ direction: 'mais', line: 8.5 });
    const b = slot({ direction: 'menos', line: 8.5 });
    assert.equal(checkContradiction(a, b).conflict, true);
  });
});
