import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfidenceMultiplier, getCuringaGovernance, getFamilyCap, getStrategyEngineGovernance } from '../src/index.mjs';

test('quality-gates maps shots and shots-on-target multipliers to the right families', () => {
  assert.equal(getConfidenceMultiplier({ family: 'chutes', scope: 'total', period: 'FT', direction: 'over' }), 0.78);
  assert.equal(getConfidenceMultiplier({ family: 'chutes_alvo', scope: 'total', period: 'FT', direction: 'over' }), 0.82);
});

test('quality-gates centraliza governança do strategy-engine', () => {
  const governance = getStrategyEngineGovernance();
  assert.equal(governance.trusted_families.has('1x2'), true);
  assert.equal(governance.trusted_families.has('dupla'), true);
  assert.equal(governance.family_reliability.dupla, 0.82);
});

test('quality-gates centraliza governança do Curinga e caps canônicos', () => {
  const governance = getCuringaGovernance();
  assert.equal(governance.a_only_confidence_factor, 0.85);
  assert.equal(governance.family_reliability.B.has('dupla'), true);
  assert.equal(getFamilyCap('1x2'), 4);
  assert.equal(getFamilyCap('dupla'), 4);
});