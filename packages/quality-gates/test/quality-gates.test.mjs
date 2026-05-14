import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfidenceMultiplier } from '../src/index.mjs';

test('quality-gates maps shots and shots-on-target multipliers to the right families', () => {
  assert.equal(getConfidenceMultiplier({ family: 'chutes', scope: 'total', period: 'FT', direction: 'over' }), 0.78);
  assert.equal(getConfidenceMultiplier({ family: 'chutes_alvo', scope: 'total', period: 'FT', direction: 'over' }), 0.82);
});