import {
  MIGRATION_TABLES,
  compareSchema,
  defaultMigrationAuditPath,
  ensureFileExists,
  getTableSchema,
  openDb,
  resolveSourceDbPath,
  resolveTargetDbPath,
  timestampForFile,
  writeJsonReport,
} from './lib/single-db-migration.mjs';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith('--source-db=')) out.sourceDbPath = arg.slice(12);
    else if (arg.startsWith('--target-db=')) out.targetDbPath = arg.slice(12);
    else if (arg.startsWith('--out=')) out.outPath = arg.slice(6);
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/validate-pre-migration.mjs [--source-db=data/scout.db] [--target-db=data/scout_extraction.db] [--out=audit/migration/pre-check.json] [--json]');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const sourceDbPath = resolveSourceDbPath(args.sourceDbPath);
  const targetDbPath = resolveTargetDbPath(args.targetDbPath);
  ensureFileExists(sourceDbPath, 'source_db');
  ensureFileExists(targetDbPath, 'target_db');

  const sourceDb = openDb(sourceDbPath, { readonly: true });
  const targetDb = openDb(targetDbPath, { readonly: true });

  try {
    const tables = MIGRATION_TABLES.map((table) => {
      const source = getTableSchema(sourceDb, table);
      const target = getTableSchema(targetDb, table);
      const comparison = compareSchema(source, target);
      return {
        table,
        status: comparison.status,
        mismatches: comparison.mismatches,
        source,
        target,
      };
    });

    const summary = {
      total: tables.length,
      ok: tables.filter((item) => item.status === 'ok').length,
      source_missing: tables.filter((item) => item.status === 'source_missing').length,
      target_missing: tables.filter((item) => item.status === 'target_missing').length,
      mismatch: tables.filter((item) => item.status === 'mismatch').length,
    };

    const report = {
      generated_at: new Date().toISOString(),
      run_id: `pre-check-${timestampForFile()}`,
      source_db: sourceDbPath,
      target_db: targetDbPath,
      summary,
      tables,
    };
    const outPath = args.outPath || defaultMigrationAuditPath('pre-check');
    writeJsonReport(outPath, report);
    report.report_path = outPath;

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`[validate-pre-migration] report=${outPath}`);
      console.log(`[validate-pre-migration] ok=${summary.ok}/${summary.total} source_missing=${summary.source_missing} target_missing=${summary.target_missing} mismatch=${summary.mismatch}`);
    }

    process.exit(summary.source_missing + summary.target_missing + summary.mismatch === 0 ? 0 : 1);
  } finally {
    sourceDb.close();
    targetDb.close();
  }
} catch (err) {
  console.error(`[validate-pre-migration] fatal: ${err.message}`);
  process.exit(1);
}
