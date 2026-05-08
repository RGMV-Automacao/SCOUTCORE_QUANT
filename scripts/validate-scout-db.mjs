// Quick validate: scout.db opens, has expected raw tables with data
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

const path = resolve(process.cwd(), 'data', 'scout.db');
console.log('[validate] DB:', path);

const db = new Database(path);
db.pragma('journal_mode = WAL');

const expected = [
  'partidas', 'team_profiles', 'eventos_faixa', 'odds', 'odds_historico',
  'predictions', 'calibration_states', 'motor_runs',
];

console.log('\n[validate] Tabelas (raw + state-to-wipe):');
for (const t of expected) {
  try {
    const c = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    console.log(`  ${t.padEnd(22)} ${c.toLocaleString('pt-BR').padStart(10)} linhas`);
  } catch (e) {
    console.log(`  ${t.padEnd(22)} ERRO: ${e.message}`);
  }
}

const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('\n[validate] Integrity:', integrity.integrity_check);

db.close();
console.log('[validate] OK');
