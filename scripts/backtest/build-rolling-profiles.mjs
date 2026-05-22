#!/usr/bin/env node
// scripts/backtest/build-rolling-profiles.mjs
//
// Constrói perfis rolling pré-jogo (sem leakage) para cada partida.
//
// Algoritmo single-pass:
//   1. Itera partidas em ordem cronológica
//   2. Antes de processar partida P:
//        - Snapshot do estado atual {team, liga, side} → backtest_team_profiles
//        - Snapshot do estado da liga                  → backtest_league_priors
//   3. Depois: incorpora os outcomes de P aos acumuladores
//
// Estado mantido em memória:
//   - teamStats[liga][team][side] = { n, gols_marcados, gols_sofridos, escanteios, ... }
//   - ligaStats[liga][period]     = { n, gols_total, btts_count, over25_count, ... }
//
// Uso:
//   node scripts/backtest/build-rolling-profiles.mjs            # rebuild full
//   node scripts/backtest/build-rolling-profiles.mjs --liga brasileirao
//   node scripts/backtest/build-rolling-profiles.mjs --limit 100

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SCOUT_DB
  ? path.resolve(process.env.SCOUT_DB)
  : path.resolve(__dirname, '..', '..', 'data', 'scout_extraction.db');

const args = parseArgs(process.argv.slice(2));
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Sempre limpa antes (single-pass exige consistência)
console.log('[rolling-profiles] limpando tabelas...');
db.exec('DELETE FROM backtest_team_profiles');
db.exec('DELETE FROM backtest_league_priors');

const stmt = db.prepare(`
  SELECT id_confronto, liga, temporada, data_partida, home_team, away_team,
         gols_ft_home, gols_ft_away, gols_ft_total, gols_ht_home, gols_ht_away, gols_ht_total,
         escanteios_ft_home, escanteios_ft_away, escanteios_ft_total,
         chutes_ft_home, chutes_ft_away, chutes_ft_total,
         sot_ft_home, sot_ft_away, sot_ft_total,
         ca_ft_home, ca_ft_away, ca_ft_total,
         cv_ft_home, cv_ft_away, cv_ft_total,
         imp_ft_home, imp_ft_away, imp_ft_total,
         faltas_ft_home, faltas_ft_away, faltas_ft_total,
         btts_ft
  FROM backtest_outcomes
  WHERE data_partida IS NOT NULL
    ${args.liga ? `AND liga = @liga` : ''}
  ORDER BY data_partida ASC, id_confronto ASC
  ${args.limit ? `LIMIT @limit` : ''}
`);
const partidas = stmt.all({ liga: args.liga, limit: args.limit });
console.log(`[rolling-profiles] partidas: ${partidas.length}`);

const insertProfile = db.prepare(`
  INSERT INTO backtest_team_profiles (id_confronto, team, liga, side, n_events, payload)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertPrior = db.prepare(`
  INSERT INTO backtest_league_priors (id_confronto, liga, period, n_events, payload)
  VALUES (?, ?, ?, ?, ?)
`);

// teamStats[liga][team][side] = accumulator
// ligaStats[liga][period]     = accumulator
const teamStats = new Map();
const ligaStats = new Map();

function tk(liga, team, side) { return `${liga}\u0001${team}\u0001${side}`; }
function lk(liga, period)    { return `${liga}\u0001${period}`; }

function getTeam(liga, team, side) {
  const k = tk(liga, team, side);
  let s = teamStats.get(k);
  if (!s) {
    s = { n: 0, gols_marc: 0, gols_sof: 0, escanteios: 0, escanteios_sof: 0,
          chutes: 0, chutes_sof: 0, sot: 0, sot_sof: 0,
          ca: 0, cv: 0, imp: 0, faltas: 0 };
    teamStats.set(k, s);
  }
  return s;
}

function getLiga(liga, period) {
  const k = lk(liga, period);
  let s = ligaStats.get(k);
  if (!s) {
    s = { n: 0, gols_total: 0, btts: 0, over25: 0,
          escanteios_total: 0, chutes_total: 0, sot_total: 0,
          cartoes_total: 0, faltas_total: 0, imp_total: 0 };
    ligaStats.set(k, s);
  }
  return s;
}

function snapshotTeam(s) {
  if (s.n === 0) return { n_events: 0, payload: { n_events: 0 } };
  const p = {
    avg_gols_marcados:   s.gols_marc / s.n,
    avg_gols_sofridos:   s.gols_sof  / s.n,
    avg_gols_total:      (s.gols_marc + s.gols_sof) / s.n,
    avg_escanteios:      s.escanteios / s.n,
    avg_escanteios_sofridos: s.escanteios_sof / s.n,
    avg_chutes:          s.chutes / s.n,
    avg_chutes_no_alvo:  s.sot / s.n,
    avg_cartoes_amarelos:s.ca / s.n,
    avg_cartoes_vermelhos:s.cv / s.n,
    avg_faltas_cometidas:s.faltas / s.n,
    avg_impedimentos:    s.imp / s.n,
    n_events:            s.n,
  };
  return { n_events: s.n, payload: p };
}

function snapshotLiga(s) {
  if (s.n === 0) return { n_events: 0, payload: { n: 0, n_events: 0 } };
  const p = {
    n: s.n,
    n_events: s.n,
    avg_goals_total:        s.gols_total / s.n,
    btts_rate:              s.btts / s.n,
    over_25_rate:           s.over25 / s.n,
    avg_escanteios_total:   s.escanteios_total / s.n,
    avg_chutes_total:       s.chutes_total / s.n,
    avg_chutes_alvo_total:  s.sot_total / s.n,
    avg_cartoes_total:      s.cartoes_total / s.n,
    avg_faltas_total:       s.faltas_total / s.n,
    avg_impedimentos_total: s.imp_total / s.n,
  };
  return { n_events: s.n, payload: p };
}

let count = 0;
const insertBatch = db.transaction((batch) => {
  for (const job of batch) {
    if (job.kind === 'profile') {
      insertProfile.run(job.id, job.team, job.liga, job.side, job.snap.n_events, JSON.stringify(job.snap.payload));
    } else {
      insertPrior.run(job.id, job.liga, job.period, job.snap.n_events, JSON.stringify(job.snap.payload));
    }
  }
});

let buffer = [];
const FLUSH = 5000;

for (const p of partidas) {
  const liga = p.liga;
  const homeS = getTeam(liga, p.home_team, 'home');
  const awayS = getTeam(liga, p.away_team, 'away');

  // 1) snapshot pré-jogo
  buffer.push({ kind:'profile', id:p.id_confronto, team:p.home_team, liga, side:'home', snap:snapshotTeam(homeS) });
  buffer.push({ kind:'profile', id:p.id_confronto, team:p.away_team, liga, side:'away', snap:snapshotTeam(awayS) });
  buffer.push({ kind:'prior',   id:p.id_confronto, liga, period:'FT', snap:snapshotLiga(getLiga(liga, 'FT')) });
  buffer.push({ kind:'prior',   id:p.id_confronto, liga, period:'HT', snap:snapshotLiga(getLiga(liga, 'HT')) });

  // 2) atualizar acumuladores com outcomes desta partida
  // home perspectivo (home_team jogando em casa)
  homeS.n++;
  homeS.gols_marc      += n(p.gols_ft_home);
  homeS.gols_sof       += n(p.gols_ft_away);
  homeS.escanteios     += n(p.escanteios_ft_home);
  homeS.escanteios_sof += n(p.escanteios_ft_away);
  homeS.chutes         += n(p.chutes_ft_home);
  homeS.chutes_sof     += n(p.chutes_ft_away);
  homeS.sot            += n(p.sot_ft_home);
  homeS.sot_sof        += n(p.sot_ft_away);
  homeS.ca             += n(p.ca_ft_home);
  homeS.cv             += n(p.cv_ft_home);
  homeS.imp            += n(p.imp_ft_home);
  homeS.faltas         += n(p.faltas_ft_home);

  // away perspectivo (away_team jogando fora)
  awayS.n++;
  awayS.gols_marc      += n(p.gols_ft_away);
  awayS.gols_sof       += n(p.gols_ft_home);
  awayS.escanteios     += n(p.escanteios_ft_away);
  awayS.escanteios_sof += n(p.escanteios_ft_home);
  awayS.chutes         += n(p.chutes_ft_away);
  awayS.chutes_sof     += n(p.chutes_ft_home);
  awayS.sot            += n(p.sot_ft_away);
  awayS.sot_sof        += n(p.sot_ft_home);
  awayS.ca             += n(p.ca_ft_away);
  awayS.cv             += n(p.cv_ft_away);
  awayS.imp            += n(p.imp_ft_away);
  awayS.faltas         += n(p.faltas_ft_away);

  // liga
  const lFt = getLiga(liga, 'FT');
  lFt.n++;
  lFt.gols_total       += n(p.gols_ft_total);
  lFt.btts             += p.btts_ft === 1 ? 1 : 0;
  lFt.over25           += n(p.gols_ft_total) > 2.5 ? 1 : 0;
  lFt.escanteios_total += n(p.escanteios_ft_total);
  lFt.chutes_total     += n(p.chutes_ft_total);
  lFt.sot_total        += n(p.sot_ft_total);
  lFt.cartoes_total    += n(p.ca_ft_total) + 2 * n(p.cv_ft_total);
  lFt.faltas_total     += n(p.faltas_ft_total);
  lFt.imp_total        += n(p.imp_ft_total);

  const lHt = getLiga(liga, 'HT');
  lHt.n++;
  lHt.gols_total       += n(p.gols_ht_total);
  lHt.btts             += (n(p.gols_ht_home) > 0 && n(p.gols_ht_away) > 0) ? 1 : 0;
  // over25 HT raramente faz sentido — mantemos zerado

  count++;
  if (buffer.length >= FLUSH) { insertBatch(buffer); buffer = []; }
  if (count % 2000 === 0) console.log(`  ${count}/${partidas.length}`);
}
if (buffer.length) insertBatch(buffer);

console.log(`[rolling-profiles] gravadas ${db.prepare('SELECT COUNT(*) n FROM backtest_team_profiles').get().n} linhas team_profiles, ${db.prepare('SELECT COUNT(*) n FROM backtest_league_priors').get().n} linhas league_priors`);

// sanity: distribuição de n_events
const dist = db.prepare(`
  SELECT
    SUM(CASE WHEN n_events = 0  THEN 1 ELSE 0 END) zero,
    SUM(CASE WHEN n_events BETWEEN 1 AND 4  THEN 1 ELSE 0 END) low,
    SUM(CASE WHEN n_events BETWEEN 5 AND 14 THEN 1 ELSE 0 END) mid,
    SUM(CASE WHEN n_events >= 15 THEN 1 ELSE 0 END) high
  FROM backtest_team_profiles
`).get();
console.log('Distribuição n_events team_profiles:', dist);

db.close();

function n(v) { return v == null ? 0 : Number(v) || 0; }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--liga')  out.liga  = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
  }
  return out;
}
