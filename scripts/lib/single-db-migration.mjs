import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const MOTOR_TABLES = [
  'prediction',
  'runs',
  'calib_state',
  'isotonic_blob',
  'yankee_submissions',
  'clv_history',
  'run_slots',
  'league_priors',
  'team_profile_v2',
  'motor_run',
  'team_profiles',
];

export const BACKTEST_TABLES = [
  'backtest_outcomes',
  'backtest_predictions',
  'backtest_eval',
  'backtest_team_profiles',
  'backtest_league_priors',
];

export const MIGRATION_TABLES = [...MOTOR_TABLES, ...BACKTEST_TABLES];
export const COPY_TABLES = MIGRATION_TABLES.filter((table) => table !== 'team_profiles');

function resolveDbPath(inputPath, fallbackPath) {
  const raw = inputPath || fallbackPath;
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

export function resolveSourceDbPath(inputPath = process.env.SCOUT_DB || join('data', 'scout.db')) {
  return resolveDbPath(inputPath, join('data', 'scout.db'));
}

export function resolveTargetDbPath(inputPath = process.env.SCOUT_DB || process.env.SCOUT_EXTRACTION_DB || join('data', 'scout_extraction.db')) {
  return resolveDbPath(inputPath, join('data', 'scout_extraction.db'));
}

export function resolveStatsLegacyDbPath(inputPath = process.env.STATSLINE_LEGACY_DB || process.env.OPTA_LEGACY_DB || '') {
  if (!inputPath) return null;
  return resolveDbPath(inputPath, inputPath);
}

export function openDb(dbPath, opts = {}) {
  return new Database(dbPath, { readonly: opts.readonly === true });
}

export function ensureFileExists(filePath, label = 'arquivo') {
  if (!existsSync(filePath)) throw new Error(`${label}_nao_encontrado:${filePath}`);
}

export function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function writeJsonReport(outPath, payload) {
  ensureParentDir(outPath);
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
}

export function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

export function tableExists(db, table) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type='table' AND name=?
  `).get(table));
}

export function listUserTables(db) {
  return db.prepare(`
    SELECT name
      FROM sqlite_master
     WHERE type='table'
       AND name NOT LIKE 'sqlite_%'
     ORDER BY name
  `).all().map((row) => row.name);
}

export function getTableCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
}

export function getExplicitIndexes(db, table) {
  return db.prepare(`
    SELECT name, sql
      FROM sqlite_master
     WHERE type='index'
       AND tbl_name=?
       AND sql IS NOT NULL
     ORDER BY name
  `).all(table).map((row) => ({
    name: row.name,
    sql: normalizeSql(row.sql),
  }));
}

export function getForeignKeys(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map((row) => ({
    id: row.id,
    seq: row.seq,
    table: row.table,
    from: row.from,
    to: row.to,
    on_update: row.on_update,
    on_delete: row.on_delete,
    match: row.match,
  }));
}

export function getColumns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => ({
    cid: row.cid,
    name: row.name,
    type: row.type,
    notnull: row.notnull,
    dflt_value: row.dflt_value,
    pk: row.pk,
  }));
}

export function getTableSchema(db, table) {
  if (!tableExists(db, table)) {
    return {
      table,
      exists: false,
      sql: null,
      columns: [],
      indexes: [],
      foreignKeys: [],
    };
  }

  const row = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type='table' AND name=?
  `).get(table);

  return {
    table,
    exists: true,
    sql: normalizeSql(row?.sql || ''),
    columns: getColumns(db, table),
    indexes: getExplicitIndexes(db, table),
    foreignKeys: getForeignKeys(db, table),
  };
}

export function compareSchema(sourceSchema, targetSchema) {
  if (!sourceSchema.exists) {
    return { status: 'source_missing', mismatches: ['source_table_missing'] };
  }
  if (!targetSchema.exists) {
    return { status: 'target_missing', mismatches: ['target_table_missing'] };
  }

  const mismatches = [];
  if (JSON.stringify(sourceSchema.columns) !== JSON.stringify(targetSchema.columns)) {
    mismatches.push('columns');
  }
  if (JSON.stringify(sourceSchema.indexes) !== JSON.stringify(targetSchema.indexes)) {
    mismatches.push('indexes');
  }
  if (JSON.stringify(sourceSchema.foreignKeys) !== JSON.stringify(targetSchema.foreignKeys)) {
    mismatches.push('foreign_keys');
  }

  return {
    status: mismatches.length === 0 ? 'ok' : 'mismatch',
    mismatches,
  };
}

export function defaultMigrationAuditPath(prefix) {
  return resolve(process.cwd(), 'audit', 'migration', `${prefix}-${timestampForFile()}.json`);
}
