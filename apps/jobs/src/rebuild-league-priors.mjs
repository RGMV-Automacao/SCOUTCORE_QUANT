// rebuild-league-priors.mjs — calcula league_priors a partir de partidas processadas.
//
// Uso: node apps/jobs/src/rebuild-league-priors.mjs --liga=brasileirao --temporada=2025 [--as-of=YYYY-MM-DD]
//
// Payload por period:
//   gols    : { n, avg_goals_total, btts_rate, over_25_rate }
//   eventos : { n_events, avg_escanteios_total, avg_chutes_total, avg_chutes_alvo_total,
//               avg_cartoes_total, avg_faltas_total,
//               avg_impedimentos_total, avg_defesas_total, avg_desarmes_total }
// (eventos só preenche em FT — para HT/2T não temos splits no nível de partida sem
// agregar bandas individualmente; fica como TODO honesto.)

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
  SELECT id_confronto, home_goals, away_goals, home_goals_ht, away_goals_ht
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

// Agrega `times` (modo='FT') por partida → médias da liga.
// Inclui impedimentos/defesas direto da tabela times, e desarmes via jogadores.
function aggEventsFT() {
  if (partidas.length === 0) return null;
  const ids = partidas.map((p) => p.id_confronto);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id_confronto,
           SUM(escanteios) AS escanteios,
           SUM(chutes) AS chutes,
           SUM(chutes_no_alvo) AS chutes_alvo,
           SUM(cartoes_amarelos) AS cartoes_amarelos,
           SUM(cartoes_vermelhos) AS cartoes_vermelhos,
           SUM(faltas) AS faltas,
           SUM(impedimentos) AS impedimentos,
           SUM(defesas) AS defesas,
           SUM(desarmes) AS desarmes
      FROM times
     WHERE modo = 'FT' AND id_confronto IN (${placeholders})
     GROUP BY id_confronto`).all(...ids);
  if (rows.length === 0) return null;
  const desMap = new Map(rows.map((r) => [r.id_confronto, r.desarmes]));
  let sumEsc = 0, sumChu = 0, sumChuAlvo = 0, sumCart = 0, sumFal = 0;
  let sumImp = 0, sumDef = 0;
  let sumDes = 0, nDes = 0;
  for (const r of rows) {
    sumEsc += r.escanteios ?? 0;
    sumChu += r.chutes ?? 0;
    sumChuAlvo += r.chutes_alvo ?? 0;
    sumCart += (r.cartoes_amarelos ?? 0) + (r.cartoes_vermelhos ?? 0);
    sumFal += r.faltas ?? 0;
    sumImp += r.impedimentos ?? 0;
    sumDef += r.defesas ?? 0;
    const d = desMap.get(r.id_confronto);
    if (d != null) { sumDes += d; nDes += 1; }
  }
  const n = rows.length;
  return {
    n_events: n,
    avg_escanteios_total: sumEsc / n,
    avg_chutes_total: sumChu / n,
    avg_chutes_alvo_total: sumChuAlvo / n,
    avg_cartoes_total: sumCart / n,
    avg_faltas_total: sumFal / n,
    avg_impedimentos_total: sumImp / n,
    avg_defesas_total: sumDef / n,
    avg_desarmes_total: nDes > 0 ? sumDes / nDes : null,
  };
}

const ft = aggPeriod((p) => p.home_goals, (p) => p.away_goals);
const ht = aggPeriod((p) => p.home_goals_ht, (p) => p.away_goals_ht);
const t2 = ft && ht && {
  n: Math.min(ft.n, ht.n),
  avg_goals_total: ft.avg_goals_total - ht.avg_goals_total,
  btts_rate: null, over_25_rate: null,
};
const eventsFT = aggEventsFT();

// Anexa eventos_FT em ft (mesmo period). Mantém HT/2T sem para sermos honestos
// (split de eventos por banda exige agregação adicional não disponível aqui).
if (ft && eventsFT) Object.assign(ft, eventsFT);

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
console.log('[priors] FT:', ft);
console.log('[priors] HT:', ht);
console.log('[priors] eventos:', eventsFT);
db.close();
