/**
 * Mesa de teste — designs.mjs
 * Verifica propriedade BIBD: para N ∈ {10, 12} cada confronto aparece exatamente 4 vezes.
 * Para N ∈ {4..9} verifica que todos os índices são válidos e tickets têm 4 confrontos.
 *
 * Execução: node packages/strategy-engine/test/designs.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGNS, getDesign } from '../src/lib/designs.mjs';

describe('designs.mjs — BIBD tables', () => {

  it('supports N = 4..12', () => {
    for (let n = 4; n <= 12; n++) {
      const d = getDesign(n);
      assert.ok(d, `design for N=${n} should exist`);
      assert.ok(Array.isArray(d), `design for N=${n} should be array`);
    }
  });

  it('returns null for unsupported N', () => {
    assert.equal(getDesign(3), null);
    assert.equal(getDesign(13), null);
    assert.equal(getDesign(0), null);
  });

  it('every ticket has exactly 4 confrontos', () => {
    for (const [n, design] of Object.entries(DESIGNS)) {
      for (let i = 0; i < design.length; i++) {
        assert.equal(design[i].length, 4,
          `N=${n} ticket[${i}] has ${design[i].length} confrontos, expected 4`);
      }
    }
  });

  it('all indices are in range [0, N-1]', () => {
    for (const [n, design] of Object.entries(DESIGNS)) {
      const N = Number(n);
      for (let i = 0; i < design.length; i++) {
        for (const idx of design[i]) {
          assert.ok(idx >= 0 && idx < N,
            `N=${n} ticket[${i}] index ${idx} out of range [0, ${N - 1}]`);
        }
      }
    }
  });

  it('N=10: each confronto appears exactly 4 times', () => {
    const design = getDesign(10);
    const counts = new Array(10).fill(0);
    for (const ticket of design) {
      for (const idx of ticket) counts[idx]++;
    }
    for (let i = 0; i < 10; i++) {
      assert.equal(counts[i], 4,
        `N=10 confronto ${i} appears ${counts[i]} times, expected 4`);
    }
  });

  it('N=12: each confronto appears exactly 4 times', () => {
    const design = getDesign(12);
    const counts = new Array(12).fill(0);
    for (const ticket of design) {
      for (const idx of ticket) counts[idx]++;
    }
    for (let i = 0; i < 12; i++) {
      assert.equal(counts[i], 4,
        `N=12 confronto ${i} appears ${counts[i]} times, expected 4`);
    }
  });

  it('N=10: has exactly 10 tickets', () => {
    assert.equal(getDesign(10).length, 10);
  });

  it('N=12: has exactly 12 tickets', () => {
    assert.equal(getDesign(12).length, 12);
  });

  it('no duplicate indices within any ticket', () => {
    for (const [n, design] of Object.entries(DESIGNS)) {
      for (let i = 0; i < design.length; i++) {
        const unique = new Set(design[i]);
        assert.equal(unique.size, design[i].length,
          `N=${n} ticket[${i}] has duplicates: [${design[i]}]`);
      }
    }
  });
});
