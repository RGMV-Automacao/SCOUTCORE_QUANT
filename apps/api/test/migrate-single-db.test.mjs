import test from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '@scoutcore/data-access';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from '../src/migrate.mjs';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scq-single-db-'));
  const dbPath = join(dir, 'scout_extraction.db');
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readTableNames(db) {
  return new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table'
  `).all().map((row) => row.name));
}

function readColumnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

test('runMigrations bootstrapa scout_extraction sem recriar tabelas mortas do scout.db', () => withTempDb((dbPath) => {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE extraction_schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE partidas (
      id_confronto TEXT PRIMARY KEY
    );
  `);
  db.close();

  const log = { info() {}, warn() {}, error() {} };
  const first = runMigrations(dbPath, log);

  assert.deepEqual(first.applied, [
    '015_single_db_motor_state.sql',
    '016_single_db_backtest.sql',
    '017_yankee_submission_audit.sql',
  ]);
  assert.equal(first.adopted.length, 0);

  const migrated = new Database(dbPath, { readonly: true });
  const tables = readTableNames(migrated);

  assert.equal(tables.has('prediction'), true);
  assert.equal(tables.has('runs'), true);
  assert.equal(tables.has('backtest_outcomes'), true);
  assert.equal(tables.has('yankee_submission_audit'), true);
  assert.equal(tables.has('yankee_submission_tickets'), true);
  assert.equal(tables.has('match'), false);
  assert.equal(tables.has('team_stat'), false);
  assert.equal(tables.has('feature_snapshot'), false);
  assert.equal(tables.has('feature_snapshot_cache'), false);
  assert.equal(tables.has('replay_progress'), false);
  assert.equal(tables.has('sync_check_log'), false);
  assert.equal(tables.has('schema_version'), false);

  const runsColumns = readColumnNames(migrated, 'runs');
  assert.equal(runsColumns.includes('run_seq'), true);
  assert.equal(runsColumns.includes('run_label'), true);

  const predictionColumns = readColumnNames(migrated, 'prediction');
  assert.equal(predictionColumns.includes('actual_value'), true);

  const isotonicColumns = readColumnNames(migrated, 'isotonic_blob');
  assert.equal(isotonicColumns.includes('period'), true);

  const yankeeColumns = readColumnNames(migrated, 'yankee_submissions');
  assert.equal(yankeeColumns.includes('settled_at'), true);

  const appliedFiles = migrated.prepare(`
    SELECT filename FROM schema_migrations ORDER BY filename
  `).all().map((row) => row.filename);
  assert.equal(appliedFiles.includes('001_motor_tables.sql'), true);
  assert.equal(appliedFiles.includes('014_prediction_actual_value.sql'), true);
  assert.equal(appliedFiles.includes('015_single_db_motor_state.sql'), true);
  assert.equal(appliedFiles.includes('016_single_db_backtest.sql'), true);
  assert.equal(appliedFiles.includes('017_yankee_submission_audit.sql'), true);
  migrated.close();

  const second = runMigrations(dbPath, log);
  assert.equal(second.applied.length, 0);
  assert.equal(second.adopted.length, 0);
}));