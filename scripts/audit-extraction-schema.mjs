import { auditExtractionSchema } from './lib/extraction-db.mjs';

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
  console.log('Uso: node scripts/audit-extraction-schema.mjs [--db=data/scout_extraction.db] [--json]');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const audit = auditExtractionSchema({ dbPath: args.dbPath });

if (args.json) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  const summary = audit.summary ?? {
    total: audit.checks.length,
    passed: audit.checks.filter((check) => check.ok).length,
    failed: audit.checks.filter((check) => !check.ok).length,
  };
  console.log(`[extraction:audit:schema] db=${audit.dbPath}`);
  console.log(`[extraction:audit:schema] status=${audit.ok ? 'aprovada' : 'reprovada'} checks=${summary.passed}/${summary.total}`);
  for (const check of audit.checks.filter((item) => !item.ok)) {
    console.log(`[extraction:audit:schema] fail ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
}

process.exit(audit.ok ? 0 : 1);
