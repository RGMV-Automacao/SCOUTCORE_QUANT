import { statSync } from 'node:fs';
import {
  defaultMigrationAuditPath,
  ensureFileExists,
  listUserTables,
  openDb,
  resolveSourceDbPath,
  resolveStatsLegacyDbPath,
  resolveTargetDbPath,
  timestampForFile,
  writeJsonReport,
  getTableCount,
} from './lib/single-db-migration.mjs';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith('--source-db=')) out.sourceDbPath = arg.slice(12);
    else if (arg.startsWith('--target-db=')) out.targetDbPath = arg.slice(12);
    else if (arg.startsWith('--stats-legacy-db=')) out.statsLegacyDbPath = arg.slice(18);
    else if (arg.startsWith('--out=')) out.outPath = arg.slice(6);
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/snapshot-row-counts.mjs [--source-db=data/scout.db] [--target-db=data/scout_extraction.db] [--stats-legacy-db=...] [--out=audit/migration/row-counts.json] [--json]');
}

function snapshotOne(label, dbPath) {
  ensureFileExists(dbPath, label);
  const db = openDb(dbPath, { readonly: true });
  try {
    const tables = listUserTables(db).map((table) => ({
      table,
      count: getTableCount(db, table),
    }));
    const integrityRow = db.prepare('PRAGMA integrity_check').get();
    const fileStat = statSync(dbPath);
    return {
      label,
      path: dbPath,
      file_bytes: Number(fileStat.size),
      modified_at: fileStat.mtime.toISOString(),
      integrity_check: integrityRow?.integrity_check ?? null,
      tables,
    };
  } finally {
    db.close();
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const sourceDbPath = resolveSourceDbPath(args.sourceDbPath);
  const targetDbPath = resolveTargetDbPath(args.targetDbPath);
  const statsLegacyDbPath = resolveStatsLegacyDbPath(args.statsLegacyDbPath);
  const outPath = args.outPath || defaultMigrationAuditPath('row-counts');

  const snapshots = [
    snapshotOne('source', sourceDbPath),
    snapshotOne('target', targetDbPath),
  ];
  if (statsLegacyDbPath) snapshots.push(snapshotOne('stats_legacy', statsLegacyDbPath));

  const report = {
    generated_at: new Date().toISOString(),
    run_id: `row-counts-${timestampForFile()}`,
    snapshots,
  };
  writeJsonReport(outPath, report);
  report.report_path = outPath;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[snapshot-row-counts] report=${outPath}`);
    for (const item of snapshots) {
      console.log(`[snapshot-row-counts] ${item.label} tables=${item.tables.length} integrity=${item.integrity_check} bytes=${item.file_bytes}`);
    }
  }
} catch (err) {
  console.error(`[snapshot-row-counts] fatal: ${err.message}`);
  process.exit(1);
}
