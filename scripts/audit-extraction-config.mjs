import { auditExtractionConfig } from './lib/extraction-config.mjs';

function parseArgs(argv) {
  const out = { requireEnv: false };
  for (const arg of argv) {
    if (arg.startsWith('--config=')) out.configPath = arg.slice(9);
    else if (arg === '--require-env') out.requireEnv = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node scripts/audit-extraction-config.mjs [--config=config/extraction-leagues.json] [--require-env] [--json]');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const audit = auditExtractionConfig({ configPath: args.configPath, requireEnv: args.requireEnv });

if (args.json) {
  console.log(JSON.stringify(audit, null, 2));
} else {
  console.log(`[extraction:audit:config] config=${audit.configPath}`);
  console.log(`[extraction:audit:config] status=${audit.ok ? 'aprovada' : 'reprovada'} checks=${audit.summary.passed}/${audit.summary.total}`);
  console.log(`[extraction:audit:config] ligas=${audit.counts.leagues} temporadas=${audit.counts.seasons} require_env=${audit.requireEnv}`);
  for (const check of audit.checks.filter((item) => !item.ok)) {
    console.log(`[extraction:audit:config] fail ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  }
}

process.exit(audit.ok ? 0 : 1);
