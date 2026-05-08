// SCOUTCORE_QUANT — Setup script: aplica migrations SQL em scout.db

import 'dotenv/config';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DST = process.env.SCOUT_DB;
if (!DST || !existsSync(DST)) {
  console.error(`[migrate] scout.db não encontrado: ${DST}`);
  process.exit(1);
}

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

const db = new Database(DST);

// Garantir tabela de versão
db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);

const applied = new Set(db.prepare('SELECT version FROM schema_version').all().map(r => r.version));

for (const f of files) {
  const version = parseInt(f.match(/^(\d+)/)?.[1] ?? '0', 10);
  if (applied.has(version)) {
    console.log(`[migrate]   ${f}: skip (já aplicada)`);
    continue;
  }
  console.log(`[migrate]   ${f}: aplicando...`);
  const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
  const tx = db.transaction(() => {
    db.exec(sql);
    db.prepare('INSERT OR REPLACE INTO schema_version(version) VALUES (?)').run(version);
  });
  tx();
  console.log(`[migrate]   ${f}: OK (v${version})`);
}

db.close();
console.log('[migrate] OK. Próximo passo: npm run setup:replay (~10 dias)');
