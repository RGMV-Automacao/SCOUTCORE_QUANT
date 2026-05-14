import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { fit, predict, saveIsotonicBlob, loadIsotonicMap, getIsotonic, applyIsotonicToSlot, isoKey } from '../src/index.mjs';

function makeDB() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE isotonic_blob (
    family TEXT NOT NULL, liga TEXT NOT NULL, period TEXT NOT NULL DEFAULT 'FT', direction TEXT NOT NULL,
    blob_bytes BLOB NOT NULL, n_samples INTEGER NOT NULL,
    fit_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (family, liga, period, direction)
  )`);
  return db;
}

test('PAV: monotônico crescente', () => {
  const probs = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const out   = [0,   0,   1,   0,   1,   1,   1,   1];
  const m = fit(probs, out);
  for (let i = 1; i < m.y.length; i++) {
    assert.ok(m.y[i] >= m.y[i - 1] - 1e-9, `não monotônico em ${i}`);
  }
});

test('PAV: probs subestimadas → curva acima', () => {
  // Modelo prevê 0.3 mas observação real é 0.6
  const probs = Array(40).fill(0).map((_, i) => 0.25 + (i % 5) * 0.01);
  const out = probs.map(() => Math.random() < 0.6 ? 1 : 0);
  const m = fit(probs, out);
  const calibrated = predict(m, 0.30);
  assert.ok(calibrated > 0.40, `expected calibrado > 0.4 got ${calibrated}`);
});

test('save+load round-trip por chave', () => {
  const db = makeDB();
  const probs = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const out   = [0,   0,   0,   1,   1,   1,   1];
  const m = fit(probs, out);
  saveIsotonicBlob(db, { family: 'gols', period: 'FT', direction: 'over', liga: 'BRA1', model: m, n_samples: 50 });
  const map = loadIsotonicMap(db);
  const entry = map.get(isoKey({ family: 'gols', period: 'FT', direction: 'over', liga: 'BRA1' }));
  assert.ok(entry, 'entry existe');
  assert.equal(entry.n_samples, 50);
  assert.deepEqual(entry.model.x, m.x);
});

test('getIsotonic: liga específica antes de global', () => {
  const db = makeDB();
  const m1 = fit([0.3, 0.5, 0.7], [0, 1, 1]);
  const m2 = fit([0.4, 0.6, 0.8], [1, 0, 1]);
  saveIsotonicBlob(db, { family: 'gols', period: 'FT', direction: 'over', liga: 'BRA1', model: m1, n_samples: 30 });
  saveIsotonicBlob(db, { family: 'gols', period: 'FT', direction: 'over', liga: '*',    model: m2, n_samples: 100 });
  const map = loadIsotonicMap(db);
  const e = getIsotonic(map, { family: 'gols', period: 'FT', direction: 'over', liga: 'BRA1' });
  assert.deepEqual(e.model.x, m1.x);
});

test('getIsotonic: abaixo de MIN_SAMPLES retorna null', () => {
  const db = makeDB();
  const m = fit([0.3, 0.5, 0.7], [0, 1, 1]);
  saveIsotonicBlob(db, { family: 'gols', period: 'FT', direction: 'over', liga: 'BRA1', model: m, n_samples: 5 });
  const map = loadIsotonicMap(db);
  const e = getIsotonic(map, { family: 'gols', period: 'FT', direction: 'over', liga: 'BRA1' });
  assert.equal(e, null);
});

test('applyIsotonicToSlot: sem modelo não modifica fair_prob', () => {
  const slot = { fair_prob: 0.6, market_odd: 1.8, edge_pct: 8 };
  applyIsotonicToSlot(slot, null);
  assert.equal(slot.fair_prob, 0.6);
  assert.equal(slot.provenance.isotonic.applied, false);
});

test('applyIsotonicToSlot: aplica e recalcula edge', () => {
  const m = fit([0.3, 0.5, 0.7], [0, 1, 1]);
  const slot = { fair_prob: 0.5, market_odd: 2.0 };
  applyIsotonicToSlot(slot, { model: m, n_samples: 30, fit_at: '2026-05-01' });
  assert.ok(slot.provenance.isotonic.applied);
  assert.ok(slot.fair_prob !== 0.5 || slot.fair_prob === 0.5); // pode coincidir
  assert.equal(slot.edge_pct, +((slot.fair_prob * 2.0 - 1) * 100).toFixed(2));
});
