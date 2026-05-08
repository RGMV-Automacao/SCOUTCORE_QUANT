// rebuild-league-priors.mjs — calcula league_priors a partir de partidas processadas.
//
// Uso: node apps/jobs/src/rebuild-league-priors.mjs --liga=brasileirao --temporada=2025 [--as-of=YYYY-MM-DD]

import 'dotenv/config';
import Database from 'better-sqlite3';

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, v] = s.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
if (!process.env.SCOUT_DB) { console.error('SCOUT_DB env vazia'); process.exit(1); }
if (!args.liga || !args.temporada) {
  console.error('uso: --liga=<liga> --temporada=<YYYY> [--as-of=YYYY-MM-DD]');
  process.exit(1);
}
const ligaArg = args.liga;
const temporada = String(args.temporada);
const asOf = args['as-of'] ?? new Date().toISOString().slice(0, 10);

const LIGA_ALIASES = {
  brasileirao: ['brasileirao', 'brasileiro'], brasileiro: ['brasileirao', 'brasileiro'],
  'la-liga': ['la-liga', 'laliga'], laliga: ['la-liga', 'laliga'],
};
const ligas = LIGA_ALIASES[ligaArg] ?? [ligaArg];

const db = new Database(process.env.SCOUT_DB);
const partidas = db.prepare(`
  SELECT home_goals, away_goals, home_goals_ht, away_goals_ht
    FROM partidas
   WHERE liga IN (SELECT value FROM json_each(?))
     AND temporada = ?
     AND processado = 1
     AND date(data_partida) < date(?)`).all(JSON.stringify(ligas), temporada, asOf);

console.log(`[priors] ${ligaArg} ${temporada} as_of=${asOf} n=${partidas.length}`);
if (partidas.length === 0) { db.close(); process.exit(0); }

function aggPeriod(getH, getA) {
  let n = 0, sum = 0, btts = 0, over25 = 0;
  for (const p of partidas) {
    const h = getH(p), a = getA(p);
    if (h == null || a == null) continue;
    n++;
    sum += h + a;
    if (h > 0 && a > 0) btts++;
    if (h + a > 2.5) over25++;
  }
  return n === 0 ? null : {
    n,
    avg_goals_total: sum / n,
    btts_rate: btts / n,
    over_25_rate: over25 / n,
  };
}

const ft = aggPeriod((p) => p.home_goals, (p) => p.away_goals);
const ht = aggPeriod((p) => p.home_goals_ht, (p) => p.away_goals_ht);
const t2 = ft && ht && {
  n: Math.min(ft.n, ht.n),
  avg_goals_total: ft.avg_goals_total - ht.avg_goals_total,
  btts_rate: null, over_25_rate: null,
};

const liga = ligas[0];
const stmt = db.prepare(`
  INSERT INTO league_priors(liga, temporada, period, payload, as_of, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(liga, temporada, period, as_of) DO UPDATE
     SET payload = excluded.payload, updated_at = excluded.updated_at`);
const tx = db.transaction(() => {
  if (ft) stmt.run(liga, temporada, 'FT', JSON.stringify(ft), asOf);
  if (ht) stmt.run(liga, temporada, 'HT', JSON.stringify(ht), asOf);
  if (t2) stmt.run(liga, temporada, '2T', JSON.stringify(t2), asOf);
});
tx();
console.log('[priors] FT:', ft, 'HT:', ht);
db.close();
