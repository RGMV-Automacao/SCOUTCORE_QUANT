// Auto-migrations runner — aplica arquivos *.sql de migrations/ em ordem.
// Idempotente via tabela schema_migrations (filename PK).
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Database } from '@scoutcore/data-access';

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');
const LEGACY_BOOTSTRAP_RE = /^00[1-6]_/;
const SINGLE_DB_BOOTSTRAP_RE = /^(00[1-9]|01[0-4])_/;

function tableExists(db, name) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type='table' AND name=?
  `).get(name));
}

function markMigrationsApplied(db, applied, files, matcher, log, reason) {
  const selected = files.filter((f) => matcher.test(f) && !applied.has(f));
  if (selected.length === 0) return [];

  const insert = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
  const tx = db.transaction(() => {
    for (const filename of selected) {
      insert.run(filename);
      applied.add(filename);
    }
  });
  tx();
  log.info?.(`[migrate] bootstrap(${reason}): ${selected.length} migrations marcadas como aplicadas`);
  return selected;
}

function isConsolidatedExtractionDb(db, dbPath) {
  const fileName = basename(dbPath).toLowerCase();
  return tableExists(db, 'extraction_schema_version')
    || tableExists(db, 'partidas')
    || fileName === 'scout_extraction.db';
}

export function runMigrations(dbPath, log = console) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations').all().map((r) => r.filename),
  );

  let files;
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    log.warn?.(`[migrate] migrations/ não encontrado em ${MIGRATIONS_DIR}: ${err.message}`);
    db.close();
    return { applied: [], skipped: [] };
  }

  // Bootstrap: se DB existente já tem tabelas core (team_profile_v2 existe via mig 002)
  // mas schema_migrations está vazio, marca todas as migrations <= ultima detectada
  // como aplicadas para não tentar re-rodá-las (que falhariam por "column exists").
  if (applied.size === 0) {
    const coreExists = tableExists(db, 'team_profile_v2');
    if (coreExists) {
      markMigrationsApplied(db, applied, files, LEGACY_BOOTSTRAP_RE, log, 'legacy-db-preexistente');
    } else if (isConsolidatedExtractionDb(db, dbPath)) {
      // No banco único consolidado, as migrations 001-014 pertencem ao mundo
      // antigo do scout.db. Elas não devem ser reexecutadas aqui porque criam
      // tabelas legadas/mortas que o plano de migração explicitamente descarta.
      markMigrationsApplied(db, applied, files, SINGLE_DB_BOOTSTRAP_RE, log, 'single-db-extraction');
    }
  }

  const justApplied = [];
  const skipped = [];
  const adopted = [];

  for (const f of files) {
    if (applied.has(f)) { skipped.push(f); continue; }
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(f);
    });
    try {
      tx();
      justApplied.push(f);
      log.info?.(`[migrate] applied ${f}`);
    } catch (err) {
      // Schema já modificado por aplicação manual prévia: adota a migration
      // (marca como aplicada) ao invés de quebrar o boot. Isso só vale para
      // erros de "já existe" — qualquer outro erro propaga.
      const msg = err.message || '';
      const alreadyApplied = /duplicate column|already exists/i.test(msg);
      if (alreadyApplied) {
        db.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)').run(f);
        adopted.push(f);
        log.warn?.(`[migrate] adopted ${f} (schema pré-existente: ${msg})`);
        continue;
      }
      log.error?.(`[migrate] FAILED ${f}: ${msg}`);
      db.close();
      throw new Error(`migration_failed:${f}:${msg}`);
    }
  }

  db.close();
  return { applied: justApplied, adopted, skipped };
}
