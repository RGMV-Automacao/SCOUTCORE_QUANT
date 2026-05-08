// SCOUTCORE_QUANT — Setup script: apaga tabelas de motor antigo do scout.db
// Decisão "tudo novo": motor não herda calibração nem predições do legado.
// Mantém apenas dados crus (partidas, team_profiles, eventos_faixa, odds, odds_historico).

import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

const DST = process.env.SCOUT_DB;
if (!DST || !existsSync(DST)) {
  console.error(`[wipe] scout.db não encontrado: ${DST}`);
  console.error('Rode antes: npm run setup:copy-legacy');
  process.exit(1);
}

const db = new Database(DST);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

// Tabelas a apagar (estado de motor antigo / Apollo)
const TABLES_TO_WIPE = [
  'predictions',
  'ml_predictions',
  'calibration_states',
  'motor_runs',
  'motor_boards',
  'motor_yankee_tickets',
  'banca_apostas',
  'tips',
];

console.log('[wipe] Iniciando wipe de tabelas de motor antigo...');
const tx = db.transaction(() => {
  for (const t of TABLES_TO_WIPE) {
    try {
      const before = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      db.prepare(`DELETE FROM ${t}`).run();
      console.log(`[wipe]   ${t}: ${before} -> 0`);
    } catch (e) {
      console.log(`[wipe]   ${t}: skip (${e.message.split('\n')[0]})`);
    }
  }
});
tx();

console.log('[wipe] Compactando (VACUUM)...');
db.exec('VACUUM');
db.close();

console.log('[wipe] OK. Próximo passo: npm run setup:migrate');
