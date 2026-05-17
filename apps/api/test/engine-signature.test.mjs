import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildSignature } from '../src/engine-signature.mjs';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE calib_state (
      engine TEXT NOT NULL,
      family TEXT NOT NULL,
      direction TEXT NOT NULL,
      liga TEXT NOT NULL,
      lambda_mult REAL NOT NULL DEFAULT 1.0,
      confidence_factor REAL NOT NULL DEFAULT 1.0,
      line_shift REAL NOT NULL DEFAULT 0.0,
      ewma_hr REAL NOT NULL DEFAULT 0.5,
      ewma_brier REAL,
      clv_score REAL,
      isotonic_version TEXT,
      sample_size INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (engine, family, direction, liga)
    );
    CREATE TABLE isotonic_blob (
      family TEXT NOT NULL,
      liga TEXT NOT NULL,
      direction TEXT NOT NULL,
      blob_bytes BLOB NOT NULL,
      n_samples INTEGER NOT NULL,
      fit_at TEXT NOT NULL,
      PRIMARY KEY (family, liga, direction)
    );
  `);
  db.prepare(`
    INSERT INTO calib_state
      (engine, family, direction, liga, lambda_mult, confidence_factor, line_shift,
       ewma_hr, ewma_brier, clv_score, isotonic_version, sample_size, updated_at)
    VALUES ('A', 'gols', 'over', 'brasileirao', 1.0, 1.0, 0.0, 0.55, 0.21, NULL, NULL, 21, '2026-05-11T10:00:00Z')
  `).run();
  db.prepare(`
    INSERT INTO isotonic_blob (family, liga, direction, blob_bytes, n_samples, fit_at)
    VALUES ('gols', 'brasileirao', 'over', ?, 25, '2026-05-11T10:00:00Z')
  `).run(Buffer.from('iso-v1'));
  return db;
}

test('engine signature changes with calibration snapshot and data snapshot', () => {
  const db = makeDb();
  const dataSnapshot = {
    match: { external_id: 'm1', home: 'Home', away: 'Away', liga: 'brasileirao', date: '2026-05-12' },
    inputs: { profile_home: { n: 12 }, profile_away: { n: 11 }, league_priors_ft: { avg_goals: 2.5 } },
  };

  const first = buildSignature({ db, dataSnapshot });
  const same = buildSignature({ db, dataSnapshot });
  assert.equal(first.calib_snapshot_id, same.calib_snapshot_id);
  assert.equal(first.data_snapshot_hash, same.data_snapshot_hash);
  assert.equal(first.hash, same.hash);

  const dataChanged = buildSignature({ db, dataSnapshot: { ...dataSnapshot, inputs: { ...dataSnapshot.inputs, league_priors_ft: { avg_goals: 2.7 } } } });
  assert.notEqual(first.data_snapshot_hash, dataChanged.data_snapshot_hash);
  assert.notEqual(first.hash, dataChanged.hash);

  db.prepare(`UPDATE calib_state SET ewma_brier = 0.18, updated_at = '2026-05-11T11:00:00Z' WHERE engine = 'A'`).run();
  const calibChanged = buildSignature({ db, dataSnapshot });
  assert.notEqual(first.calib_snapshot_id, calibChanged.calib_snapshot_id);
  assert.notEqual(first.hash, calibChanged.hash);
  db.close();
});