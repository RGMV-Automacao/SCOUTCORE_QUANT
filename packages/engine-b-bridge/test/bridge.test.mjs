// engine-b-bridge test — fallbacks honestos quando sidecar offline
import test from 'node:test';
import assert from 'node:assert/strict';
import { predictBatch, ENGINE_B_VERSION } from '../src/index.mjs';

test('ENGINE_B_VERSION exported', () => {
  assert.equal(typeof ENGINE_B_VERSION, 'string');
});

test('predictBatch sem keys → available:false missing_match_keys', async () => {
  const r = await predictBatch({});
  assert.equal(r.available, false);
  assert.equal(r.reason, 'missing_match_keys');
  assert.deepEqual(r.slots, []);
});

test('predictBatch com sidecar offline → available:false network', async () => {
  process.env.ENGINE_B_URL = 'http://127.0.0.1:1'; // porta inválida
  process.env.ENGINE_B_TIMEOUT_MS = '300';
  const { predictBatch: pb } = await import('../src/index.mjs?bust1');
  const r = await pb({ liga: 'l', home: 'h', away: 'a', data: '2025-01-01' });
  assert.equal(r.available, false);
  assert.match(r.reason, /network|timeout|http_/);
});

test('ping sidecar offline → available:false', async () => {
  process.env.ENGINE_B_URL = 'http://127.0.0.1:1';
  process.env.ENGINE_B_TIMEOUT_MS = '300';
  const { ping: p2 } = await import('../src/index.mjs?bust2');
  const r = await p2();
  assert.equal(r.available, false);
});
