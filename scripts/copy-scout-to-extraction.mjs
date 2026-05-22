import {
  COPY_TABLES,
  MIGRATION_TABLES,
  defaultMigrationAuditPath,
  ensureFileExists,
  getTableCount,
  openDb,
  resolveSourceDbPath,
  resolveTargetDbPath,
  tableExists,
  timestampForFile,
  writeJsonReport,
} from './lib/single-db-migration.mjs';

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg.startsWith('--source-db=')) out.sourceDbPath = arg.slice(12);
    else if (arg.startsWith('--target-db=')) out.targetDbPath = arg.slice(12);
    else if (arg.startsWith('--out=')) out.outPath = arg.slice(6);
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/copy-scout-to-extraction.mjs [--source-db=data/scout.db] [--target-db=data/scout_extraction.db] [--dry-run] [--out=audit/migration/copy-report.json] [--json]');
}

function sqliteQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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
  const targetDb = openDb(targetDbPath);
  targetDb.pragma('journal_mode = WAL');
  targetDb.pragma('foreign_keys = ON');

  try {
    for (const table of MIGRATION_TABLES) {
      if (!tableExists(targetDb, table)) throw new Error(`target_schema_incompleto:${table}`);
    }

    targetDb.exec(`ATTACH DATABASE ${sqliteQuote(sourceDbPath)} AS src`);
    const report = {
      generated_at: new Date().toISOString(),
      run_id: `copy-${timestampForFile()}`,
      source_db: sourceDbPath,
      target_db: targetDbPath,
      dry_run: args.dryRun,
      skipped_tables: ['team_profiles'],
      tables: [],
    };

    for (const table of COPY_TABLES) {
      const sourceCount = getTableCount(sourceDb, table);
      const beforeCount = getTableCount(targetDb, table);
      let inserted = 0;

      if (!args.dryRun) {
        const tx = targetDb.transaction(() => {
          const result = targetDb.prepare(`
            INSERT OR IGNORE INTO ${table}
            SELECT * FROM src.${table}
          `).run();
          return Number(result.changes || 0);
        });
        inserted = tx();
      }

      const afterCount = args.dryRun ? beforeCount : getTableCount(targetDb, table);
      report.tables.push({
        table,
        source_count: sourceCount,
        target_before: beforeCount,
        inserted,
        target_after: afterCount,
      });
    }

    if (!args.dryRun) {
      report.checkpoint = targetDb.pragma('wal_checkpoint(TRUNCATE)');
    }

    report.summary = {
      total_tables: report.tables.length,
      inserted_rows: report.tables.reduce((sum, row) => sum + row.inserted, 0),
      source_rows: report.tables.reduce((sum, row) => sum + row.source_count, 0),
      target_rows_after: report.tables.reduce((sum, row) => sum + row.target_after, 0),
    };

    const outPath = args.outPath || defaultMigrationAuditPath('copy-report');
    writeJsonReport(outPath, report);
    report.report_path = outPath;

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`[copy-scout-to-extraction] report=${outPath}`);
      console.log(`[copy-scout-to-extraction] dry_run=${args.dryRun} inserted_rows=${report.summary.inserted_rows}`);
    }
  } finally {
    try { targetDb.exec('DETACH DATABASE src'); } catch { /* noop */ }
    sourceDb.close();
    targetDb.close();
  }
} catch (err) {
  console.error(`[copy-scout-to-extraction] fatal: ${err.message}`);
  process.exit(1);
}
