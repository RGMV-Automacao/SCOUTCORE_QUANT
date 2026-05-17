// SCOUTCORE_QUANT — Sync-check job
// Cron diário 03:00. Compara COUNT(*) e MAX(criado_em) entre opta.db e scout.db
// Alerta se drift > SYNC_DRIFT_THRESHOLD em qualquer tabela.

import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

const LEG = process.env.OPTA_LEGACY_DB;
const SCT = process.env.SCOUT_DB;
const THRESHOLD = Number(process.env.SYNC_DRIFT_THRESHOLD ?? 5);

if (!existsSync(LEG) || !existsSync(SCT)) {
  console.error('[sync-check] DB(s) não encontrado(s)');
  process.exit(1);
}

const legacy = new Database(LEG, { readonly: true });
const scout  = new Database(SCT);
legacy.pragma('query_only = ON');

const TABLES = ['partidas', 'team_profiles', 'eventos_faixa', 'odds', 'odds_historico'];
const drift = {};
let hasDrift = false;

for (const t of TABLES) {
  try {
    const cLeg   = legacy.prepare(`SELECT COUNT(*) c, MAX(criado_em) m FROM ${t}`).get();
    const cScout = scout.prepare(`SELECT COUNT(*) c, MAX(criado_em) m FROM ${t}`).get();
    const delta = cLeg.c - cScout.c;
    drift[t] = { legacy: cLeg, scout: cScout, delta };
    if (Math.abs(delta) > THRESHOLD) {
      hasDrift = true;
      console.warn(`[sync-check] DRIFT ${t}: ${delta} linhas (legacy=${cLeg.c}, scout=${cScout.c})`);
    } else {
      console.log(`[sync-check] OK    ${t}: delta=${delta}`);
    }
  } catch (e) {
    console.error(`[sync-check] ERR   ${t}: ${e.message}`);
    drift[t] = { error: e.message };
    hasDrift = true;
  }
}

scout.prepare(`
  INSERT INTO sync_check_log (run_at, payload, has_drift)
  VALUES (?, ?, ?)
`).run(new Date().toISOString(), JSON.stringify(drift), hasDrift ? 1 : 0);

legacy.close();
scout.close();
process.exit(hasDrift ? 2 : 0);
