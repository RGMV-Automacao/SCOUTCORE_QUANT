// Itera (liga, temporada) reais e dispara rebuild-team-profiles + rebuild-league-priors.
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const db = new Database(process.env.SCOUT_DB || 'data/scout_extraction.db', { readonly: true });
const rows = db.prepare(`
  SELECT liga, temporada, COUNT(*) n
  FROM partidas
  WHERE processado = 1 AND home_goals IS NOT NULL
  GROUP BY liga, temporada
  HAVING n >= 30
  ORDER BY liga, temporada
`).all();
db.close();

const env = { ...process.env };
let okTp = 0, errTp = 0, okLp = 0, errLp = 0;
const t0 = Date.now();

for (const { liga, temporada, n } of rows) {
  console.log(`\n──── ${liga} / ${temporada} (${n} partidas) ────`);
  const r1 = spawnSync(process.execPath,
    ['apps/jobs/src/rebuild-team-profiles.mjs', `--liga=${liga}`, `--temporada=${temporada}`],
    { env, stdio: 'inherit' });
  if (r1.status === 0) okTp++; else errTp++;

  const r2 = spawnSync(process.execPath,
    ['apps/jobs/src/rebuild-league-priors.mjs', `--liga=${liga}`, `--temporada=${temporada}`],
    { env, stdio: 'inherit' });
  if (r2.status === 0) okLp++; else errLp++;
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n[rebuild-all] team_profile: ok=${okTp} err=${errTp} | league_priors: ok=${okLp} err=${errLp} | ${elapsed}s`);
