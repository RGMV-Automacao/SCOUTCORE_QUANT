// SCOUTCORE_QUANT — Setup script: apaga o estado persistido do motor no scout.db.
// Decisão "tudo novo": motor não herda calibração, predições, runs nem tickets.
// Mantém apenas dados crus (partidas, team_profiles, eventos_faixa, odds, odds_historico).

import 'dotenv/config';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAW_DST = process.env.SCOUT_DB || 'data/scout_extraction.db';
const DST = isAbsolute(RAW_DST) ? RAW_DST : resolve(process.cwd(), RAW_DST);
if (!DST || !existsSync(DST)) {
  console.error(`[wipe] scout.db não encontrado: ${DST}`);
  console.error('Rode antes: npm run extraction:migrate e, em ambiente novo, npm run single-db:copy');
  process.exit(1);
}

const db = new DatabaseSync(DST);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = OFF');

// Tabelas a apagar (estado persistido do motor, legado e runtime atual)
const TABLES_TO_WIPE = [
  'yankee_submission_tickets',
  'yankee_submission_audit',
  'yankee_submissions',
  'run_slots',
  'runs',
  'prediction',
  'motor_run',
  'clv_history',
  'predictions',
  'ml_predictions',
  'calibration_states',
  'motor_runs',
  'motor_boards',
  'motor_yankee_tickets',
  'banca_apostas',
  'tips',
];

console.log('[wipe] Iniciando wipe de estado persistido do motor...');
db.exec('BEGIN');
try {
  for (const tableName of TABLES_TO_WIPE) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
    if (!exists) {
      console.log(`[wipe]   ${tableName}: skip (tabela ausente)`);
      continue;
    }
    const before = db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}`).get().c;
    db.prepare(`DELETE FROM ${tableName}`).run();
    console.log(`[wipe]   ${tableName}: ${before} -> 0`);
  }
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch { /* noop */ }
  throw error;
}

if (process.env.SCOUT_WIPE_VACUUM === '1') {
  console.log('[wipe] Compactando (VACUUM)...');
  db.exec('VACUUM');
} else {
  console.log('[wipe] VACUUM pulado (use SCOUT_WIPE_VACUUM=1 para compactar o arquivo do DB).');
}
db.close();

console.log('[wipe] OK. Próximo passo: subir API e gerar um novo /v1/run');
