import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB || 'data/scout_extraction.db', { readonly: true, fileMustExist: true });

// Contagens básicas
const counts = {
  partidas_total:      `SELECT count(*) c FROM partidas`,
  partidas_com_gols:   `SELECT count(*) c FROM partidas WHERE home_goals IS NOT NULL`,
  partidas_status_null:`SELECT count(*) c FROM partidas WHERE status IS NULL`,
  team_profile_v2:     `SELECT count(*) c FROM team_profile_v2`,
  league_priors:       `SELECT count(*) c FROM league_priors`,
  calib_state:         `SELECT count(*) c FROM calib_state`,
  clv_history:         `SELECT count(*) c FROM clv_history`,
  motor_run:           `SELECT count(*) c FROM motor_run`,
  prediction:          `SELECT count(*) c FROM prediction`,
};
for (const [label, sql] of Object.entries(counts)) {
  try { console.log(label.padEnd(28), db.prepare(sql).get().c); }
  catch (e) { console.log(label.padEnd(28), 'ERRO:', e.message); }
}

// Distribuição de status
const statuses = db.prepare(`SELECT status, count(*) c FROM partidas GROUP BY status ORDER BY c DESC`).all();
console.log('\nstatus values:');
statuses.forEach(r => console.log(' ', String(r.status ?? 'NULL').padEnd(20), r.c));

// Sample de uma partida com gols
const sample = db.prepare(`SELECT id_confronto, liga, home_team, away_team, home_goals, away_goals, status, data_partida FROM partidas WHERE home_goals IS NOT NULL LIMIT 3`).all();
console.log('\nsample com gols:', sample.length ? sample : 'NENHUMA');

// Sample de partida sem gols
const noGoals = db.prepare(`SELECT home_team, away_team, status, data_partida, processado FROM partidas WHERE home_goals IS NULL LIMIT 3`).all();
console.log('\nsample sem gols (3):', noGoals);

// Verificar se dados_json tem gols
const jsonSample = db.prepare(`SELECT dados_json FROM partidas WHERE dados_json IS NOT NULL LIMIT 1`).get();
if (jsonSample?.dados_json) {
  try {
    const parsed = JSON.parse(jsonSample.dados_json);
    const keys = Object.keys(parsed).slice(0, 15);
    console.log('\ndados_json keys (sample):', keys);
  } catch { console.log('\ndados_json: não é JSON válido'); }
} else { console.log('\ndados_json: sem dados'); }

// Data coverage para predict
const ligas = db.prepare(`SELECT liga, count(*) c FROM team_profile_v2 GROUP BY liga ORDER BY c DESC LIMIT 5`).all();
console.log('\nteam_profile_v2 por liga (top 5):');
ligas.forEach(r => console.log(' ', r.liga.padEnd(28), r.c));

const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('\nintegridade:', integrity.integrity_check);
db.close();
