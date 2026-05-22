import { applyExtractionMigrations, auditExtractionSchema } from './lib/extraction-db.mjs';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/extraction-migrate.mjs [--db=data/scout_extraction.db] [--json]');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const result = applyExtractionMigrations({ dbPath: args.dbPath });
  const audit = auditExtractionSchema({ dbPath: result.dbPath });

  if (args.json) {
    console.log(JSON.stringify({ migration: result, audit }, null, 2));
  } else {
    console.log(`[extraction:migrate] db=${result.dbPath}`);
    console.log(`[extraction:migrate] aplicadas=${result.applied.length} ignoradas=${result.skipped.length}`);
    console.log(`[extraction:migrate] journal_mode=${result.pragmas.journal_mode} foreign_keys=${result.pragmas.foreign_keys}`);
    console.log(`[extraction:migrate] auditoria=${audit.ok ? 'aprovada' : 'reprovada'} checks=${audit.summary.passed}/${audit.summary.total}`);
  }

  process.exit(audit.ok ? 0 : 1);
} catch (err) {
  console.error(`[extraction:migrate] fatal: ${err.message}`);
  process.exit(1);
}
