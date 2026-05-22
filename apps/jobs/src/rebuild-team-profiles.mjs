// rebuild-team-profiles.mjs
//
// Recomputa team_profile_v2 a partir de partidas + times (FT) + jogadores em SCOUT_DB.
// Independente do FutMax legacy. PIT-aware: aceita --as-of=YYYY-MM-DD.
//
// Uso:
//   node apps/jobs/src/rebuild-team-profiles.mjs --liga=brasileirao --temporada=2025
//   node apps/jobs/src/rebuild-team-profiles.mjs --liga=brasileirao --temporada=2025 --as-of=2025-10-01
//
// Métricas computadas (FT, side-aware):
//   n, avg_gols_marcados, avg_gols_sofridos, avg_gols_total,
//   avg_escanteios, avg_escanteios_sofridos,
//   avg_chutes, avg_chutes_alvo,
//   avg_cartoes_amarelos, avg_cartoes_vermelhos,
//   avg_faltas_cometidas,
//   avg_impedimentos, avg_defesas, avg_desarmes

import 'dotenv/config';
import Database from 'better-sqlite3';

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, v] = s.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));

const SCOUT_DB = process.env.SCOUT_DB;
if (!SCOUT_DB) { console.error('SCOUT_DB env vazia'); process.exit(1); }
if (!args.liga || !args.temporada) {
  console.error('uso: --liga=<liga> --temporada=<YYYY> [--as-of=YYYY-MM-DD]');
  process.exit(1);
}
const ligaArg = args.liga;
const temporada = String(args.temporada);
const asOf = args['as-of'] ?? '9999-12-31';

const LIGA_ALIASES = {
  brasileirao: ['brasileirao', 'brasileiro'],
  brasileiro: ['brasileirao', 'brasileiro'],
  'la-liga': ['la-liga', 'laliga'],
  laliga: ['la-liga', 'laliga'],
};
const ligas = LIGA_ALIASES[ligaArg] ?? [ligaArg];

const db = new Database(SCOUT_DB);
db.pragma('journal_mode = WAL');

console.log(`[rebuild-tp] liga=${ligaArg} (aliases=${ligas.join(',')}) temporada=${temporada} as_of=${asOf}`);

// 1. Lista partidas processadas elegíveis no recorte.
const partidas = db.prepare(`
  SELECT id_confronto, liga, home_team, away_team, data_partida,
         home_goals, away_goals, home_goals_ht, away_goals_ht
    FROM partidas
   WHERE liga IN (SELECT value FROM json_each(?))
     AND temporada = ?
     AND processado = 1
     AND date(data_partida) < date(?)
`).all(JSON.stringify(ligas), temporada, asOf);

console.log(`[rebuild-tp] partidas elegíveis: ${partidas.length}`);

if (partidas.length === 0) {
  console.log('[rebuild-tp] nada para fazer');
  db.close();
  process.exit(0);
}

// 2. Stats agregadas por (id_confronto, time) — fonte única `times` (modo='FT'),
//    com `desarmes` vindo direto do team-stat oficial (statsline totalTackle).
const idList = [...new Set(partidas.map((p) => p.id_confronto))];
const inPlace = idList.map(() => '?').join(',');
const statsByMatchTeam = new Map(); // key: `${id_confronto}::${time}`
if (idList.length > 0) {
  for (const r of db.prepare(`
    SELECT id_confronto, time, side, gols, escanteios, chutes, chutes_no_alvo AS chutes_alvo,
           faltas, cartoes_amarelos, cartoes_vermelhos, impedimentos, defesas, desarmes
      FROM times
     WHERE modo = 'FT' AND id_confronto IN (${inPlace})`).all(...idList)) {
    statsByMatchTeam.set(`${r.id_confronto}::${r.time}`, r);
  }
}

// 3. Agrega por (team, side).
function emptyAgg() {
  return {
    n: 0,
    sum_gols_marcados: 0, sum_gols_sofridos: 0,
    sum_escanteios: 0, sum_escanteios_sofridos: 0,
    sum_chutes: 0, sum_chutes_alvo: 0,
    sum_cartoes_amarelos: 0, sum_cartoes_vermelhos: 0,
    sum_faltas: 0,
    sum_impedimentos: 0, sum_defesas: 0, sum_desarmes: 0,
    n_events: 0, n_desarmes: 0,
  };
}
const agg = new Map(); // key: `${team}::${side}`

function bump(team, side, p, evHome, evAway) {
  const k = `${team}::${side}`;
  const a = agg.get(k) ?? emptyAgg();
  a.n += 1;
  const own = side === 'home' ? evHome : evAway;
  const opp = side === 'home' ? evAway : evHome;
  if (side === 'home') {
    a.sum_gols_marcados += p.home_goals ?? 0;
    a.sum_gols_sofridos += p.away_goals ?? 0;
  } else {
    a.sum_gols_marcados += p.away_goals ?? 0;
    a.sum_gols_sofridos += p.home_goals ?? 0;
  }
  if (own) {
    a.n_events += 1;
    a.sum_escanteios += own.escanteios ?? 0;
    a.sum_escanteios_sofridos += opp?.escanteios ?? 0;
    a.sum_chutes += own.chutes ?? 0;
    a.sum_chutes_alvo += own.chutes_alvo ?? 0;
    a.sum_cartoes_amarelos += own.cartoes_amarelos ?? 0;
    a.sum_cartoes_vermelhos += own.cartoes_vermelhos ?? 0;
    a.sum_faltas += own.faltas ?? 0;
    a.sum_impedimentos += own.impedimentos ?? 0;
    a.sum_defesas += own.defesas ?? 0;
    if (own.desarmes != null) {
      a.sum_desarmes += own.desarmes;
      a.n_desarmes += 1;
    }
  }
  agg.set(k, a);
}

for (const p of partidas) {
  const evHome = statsByMatchTeam.get(`${p.id_confronto}::${p.home_team}`);
  const evAway = statsByMatchTeam.get(`${p.id_confronto}::${p.away_team}`);
  bump(p.home_team, 'home', p, evHome, evAway);
  bump(p.away_team, 'away', p, evHome, evAway);
}

// 4. Materializa "overall" como soma de home + away.
const teams = new Set();
for (const k of agg.keys()) teams.add(k.split('::')[0]);
for (const t of teams) {
  const h = agg.get(`${t}::home`) ?? emptyAgg();
  const a = agg.get(`${t}::away`) ?? emptyAgg();
  const o = emptyAgg();
  for (const k of Object.keys(o)) o[k] = (h[k] ?? 0) + (a[k] ?? 0);
  agg.set(`${t}::overall`, o);
}

// 5. UPSERT em team_profile_v2.
const liga = ligas[0];
const stmt = db.prepare(`
  INSERT INTO team_profile_v2(team, liga, temporada, side, as_of, n, payload, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(team, liga, temporada, side, as_of) DO UPDATE
     SET n = excluded.n, payload = excluded.payload, updated_at = excluded.updated_at`);

const tx = db.transaction(() => {
  for (const [k, a] of agg) {
    const [team, side] = k.split('::');
    if (a.n === 0) continue;
    const ne = Math.max(1, a.n_events);
    const nd = Math.max(1, a.n_desarmes);
    const payload = {
      avg_gols_marcados: a.sum_gols_marcados / a.n,
      avg_gols_sofridos: a.sum_gols_sofridos / a.n,
      avg_gols_total: (a.sum_gols_marcados + a.sum_gols_sofridos) / a.n,
      avg_escanteios: a.sum_escanteios / ne,
      avg_escanteios_sofridos: a.sum_escanteios_sofridos / ne,
      avg_chutes: a.sum_chutes / ne,
      avg_chutes_alvo: a.sum_chutes_alvo / ne,
      avg_cartoes_amarelos: a.sum_cartoes_amarelos / ne,
      avg_cartoes_vermelhos: a.sum_cartoes_vermelhos / ne,
      avg_faltas_cometidas: a.sum_faltas / ne,
      avg_impedimentos: a.sum_impedimentos / ne,
      avg_defesas: a.sum_defesas / ne,
      avg_desarmes: a.n_desarmes > 0 ? a.sum_desarmes / nd : null,
      n_events: a.n_events,
      n_desarmes: a.n_desarmes,
    };
    stmt.run(team, liga, temporada, side, asOf === '9999-12-31' ? new Date().toISOString().slice(0, 10) : asOf, a.n, JSON.stringify(payload));
  }
});
tx();

console.log(`[rebuild-tp] OK times=${teams.size} (escritos com 3 lados cada)`);
db.close();
