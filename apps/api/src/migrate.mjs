// Auto-migrations runner — aplica arquivos *.sql de migrations/ em ordem.
// Idempotente via tabela schema_migrations (filename PK).
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

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
    const coreExists = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_profile_v2'
    `).get();
    if (coreExists) {
      const insert = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
      const known = files.filter((f) => /^00[1-6]_/.test(f));
      const bootstrapTx = db.transaction(() => {
        for (const f of known) {
          insert.run(f);
          applied.add(f);
        }
      });
      bootstrapTx();
      log.info?.(`[migrate] bootstrap: ${known.length} migrations marcadas como aplicadas (DB pré-existente)`);
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
