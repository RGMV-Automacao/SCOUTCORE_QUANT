// Testes de mesa do @scoutcore/calibration — sem dependência de DB real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  loadCalibrationMap, getCalib, saveCalibrationBatch, updateEwma,
  applyCalibrationToSlot, computeSuggestions,
} from '../src/index.mjs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE calib_state (
      engine TEXT NOT NULL, family TEXT NOT NULL, direction TEXT NOT NULL, liga TEXT NOT NULL,
      lambda_mult REAL NOT NULL DEFAULT 1.0, confidence_factor REAL NOT NULL DEFAULT 1.0,
      line_shift REAL NOT NULL DEFAULT 0.0, ewma_hr REAL NOT NULL DEFAULT 0.5,
      ewma_brier REAL, clv_score REAL, isotonic_blob BLOB, isotonic_version TEXT,
      sample_size INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (engine, family, direction, liga)
    );
    CREATE TABLE prediction (
      run_id TEXT NOT NULL, match_id TEXT NOT NULL, match_date TEXT NOT NULL,
      liga TEXT NOT NULL, family TEXT NOT NULL, scope TEXT NOT NULL, period TEXT NOT NULL,
      direction TEXT NOT NULL, line REAL, market_key TEXT NOT NULL,
      fair_prob REAL NOT NULL, market_odd REAL, edge_pct REAL,
      confidence REAL NOT NULL, certified INTEGER NOT NULL DEFAULT 0,
      result TEXT, settled_at TEXT, provenance TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (run_id, market_key)
    );
  `);
  return db;
}

test('updateEwma: seed null retorna obs', () => {
  assert.equal(updateEwma(null, 0.7, 0.15), 0.7);
});

test('updateEwma: seed 0.5 retorna obs (primeira observação real)', () => {
  assert.equal(updateEwma(0.5, 0.8, 0.15), 0.8);
});

test('updateEwma: pondera corretamente α=0.15', () => {
  // ewma_new = 0.15*0.6 + 0.85*0.4 = 0.09 + 0.34 = 0.43
  const v = updateEwma(0.4, 0.6, 0.15);
  assert.ok(Math.abs(v - 0.43) < 1e-9, `got ${v}`);
});

test('save+load: round-trip por chave canônica', () => {
  const db = makeDb();
  saveCalibrationBatch(db, [
    { family: 'gols', direction: 'over', liga: 'brasileirao',
      lambda_mult: 1.12, confidence_factor: 0.85, ewma_hr: 0.62, sample_size: 25 },
    { family: 'escanteios', direction: 'over', liga: 'brasileirao',
      lambda_mult: 1.05, confidence_factor: 1.10, ewma_hr: 0.71, sample_size: 18 },
  ]);
  const map = loadCalibrationMap(db);
  assert.equal(map.size, 2);
  const c = getCalib(map, { family: 'gols', direction: 'over', liga: 'brasileirao' });
  assert.equal(c.lambda_mult, 1.12);
  assert.equal(c.confidence_factor, 0.85);
  assert.equal(c.sample_size, 25);
});

test('getCalib: retorna defaults quando inexistente', () => {
  const map = new Map();
  const c = getCalib(map, { family: 'cartoes', direction: 'over', liga: 'serie-b' });
  assert.equal(c.lambda_mult, 1.0);
  assert.equal(c.confidence_factor, 1.0);
  assert.equal(c.sample_size, 0);
});

test('applyCalibrationToSlot: sem amostras não modifica confidence', () => {
  const slot = { confidence: 0.5, market_key: 'x' };
  const calib = { lambda_mult: 1.5, confidence_factor: 0.7, sample_size: 0 };
  applyCalibrationToSlot(slot, calib);
  assert.equal(slot.confidence, 0.5);
  assert.equal(slot.provenance.calib.applied, false);
});

test('applyCalibrationToSlot: com amostras multiplica confidence', () => {
  const slot = { confidence: 0.5, market_key: 'x' };
  const calib = { lambda_mult: 1.0, confidence_factor: 0.8, sample_size: 20, ewma_hr: 0.55 };
  applyCalibrationToSlot(slot, calib);
  assert.equal(slot.confidence, 0.4);
  assert.equal(slot.provenance.calib.applied, true);
  assert.equal(slot.provenance.calib.n, 20);
});

test('computeSuggestions: detecta overconfidence', () => {
  const db = makeDb();
  // 20 predictions de gols/over/brasileirao, expected ~0.65, actual 50% (red 10x)
  const ins = db.prepare(`INSERT INTO prediction (run_id, match_id, match_date, liga, family, scope, period, direction, market_key, fair_prob, confidence, result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 20; i++) {
    ins.run(`r${i}`, `m${i}`, '2026-04-01', 'brasileirao', 'gols', 'total', 'FT', 'over',
      `gols_total_ft_over_2_5#${i}`, 0.65, 0.5, i < 10 ? 'green' : 'red');
  }
  const s = computeSuggestions(db, { minSamples: 10 });
  assert.equal(s.length, 1);
  assert.equal(s[0].bias, 'overconfident');     // 0.50 / 0.65 ≈ 0.77 < 0.85
  assert.equal(s[0].lambda_action, 'lower_lambda'); // over com actual < expected
  assert.ok(s[0].suggested_lambda_mult < 1.0);
  assert.ok(s[0].suggested_confidence_factor < 1.0);
});

test('computeSuggestions: detecta underconfidence (under acertando demais)', () => {
  const db = makeDb();
  const ins = db.prepare(`INSERT INTO prediction (run_id, match_id, match_date, liga, family, scope, period, direction, market_key, fair_prob, confidence, result) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  // expected 0.40, actual 16/20 = 0.80 → under acertando muito → λ real abaixo do predito → lower_lambda
  for (let i = 0; i < 20; i++) {
    ins.run(`u${i}`, `m${i}`, '2026-04-01', 'brasileirao', 'gols', 'total', 'FT', 'under',
      `gols_total_ft_under_2_5#${i}`, 0.40, 0.5, i < 16 ? 'green' : 'red');
  }
  const s = computeSuggestions(db, { minSamples: 10 });
  assert.equal(s[0].bias, 'underconfident');
  assert.equal(s[0].lambda_action, 'lower_lambda');
});
