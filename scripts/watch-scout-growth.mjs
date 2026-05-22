// Watcher de crescimento do scout.db por liga.
// Imprime delta a cada INTERVAL_MS para partidas, eventos_faixa, odds, odds_historico.
//
// Uso:
//   $env:SCOUT_DB='...\\scout.db'
//   node scripts/watch-scout-growth.mjs brasileirao 30
//
// Args: [liga] [intervalo_segundos]

import Database from 'better-sqlite3';
import { resolve } from 'path';

const liga = process.argv[2] || 'brasileirao';
const intervalSec = Number(process.argv[3] || 30);
const SCOUT = process.env.SCOUT_DB || 'data/scout_extraction.db';

// odds usa apelidos diferentes para algumas ligas
const ODDS_ALIASES = {
  brasileirao: ['brasileirao', 'brasileiro'],
  'brasileirao-b': ['brasileirao-b', 'brasileirob'],
  'la-liga': ['la-liga', 'laliga'],
  'la-liga-2': ['la-liga-2', 'laliga2'],
  'serie-a': ['serie-a', 'seriea'],
  'serie-b-italia': ['serie-b-italia', 'serieb'],
  'ligue-1': ['ligue-1', 'ligue1'],
  'liga-mx': ['liga-mx', 'ligamx'],
  'premier-league': ['premier-league', 'premier'],
  'primeira-liga': ['primeira-liga', 'liga-portugal', 'ligaportugal'],
  'superliga-argentina': ['superliga-argentina', 'argentina'],
};
const oddsLigas = ODDS_ALIASES[liga] || [liga];
const placeholders = oddsLigas.map(() => '?').join(',');

const db = new Database(resolve(SCOUT), { readonly: true });
db.pragma('journal_mode'); // só p/ permitir leitura paralela em wal

const Q = {
  partidas: db.prepare('SELECT count(*) c, MAX(criado_em) m FROM partidas WHERE liga = ?'),
  faixas:   db.prepare('SELECT count(*) c, MAX(criado_em) m FROM eventos_faixa WHERE liga = ?'),
  odds:     db.prepare(`SELECT count(*) c, MAX(criado_em) m FROM odds WHERE liga IN (${placeholders})`),
  hist:     db.prepare(`SELECT count(*) c FROM odds_historico WHERE home_team IN (SELECT DISTINCT home_team FROM odds WHERE liga IN (${placeholders}))`),
};

function snapshot() {
  const p = Q.partidas.get(liga);
  const f = Q.faixas.get(liga);
  const o = Q.odds.all ? Q.odds.get(...oddsLigas) : Q.odds.get(...oddsLigas);
  const h = Q.hist.get(...oddsLigas);
  return {
    p: p.c, p_max: p.m,
    f: f.c, f_max: f.m,
    o: o.c, o_max: o.m,
    h: h.c,
  };
}

function fmt(n) { return String(n).padStart(7); }
function delta(now, prev) {
  const d = now - prev;
  if (d === 0) return '   .   ';
  const sign = d > 0 ? '+' : '';
  return (sign + d).padStart(7);
}

let prev = snapshot();
console.log(`[watch] liga=${liga} odds_in=[${oddsLigas.join(',')}] interval=${intervalSec}s scout=${SCOUT}`);
console.log('hora      | partidas    Δ  | faixas       Δ  | odds         Δ  | odds_hist    Δ  | last_partida_criado_em');
console.log('----------|-----------------|------------------|------------------|------------------|-----------------------');
console.log(`${new Date().toLocaleTimeString()} | ${fmt(prev.p)} ${'   .   '} | ${fmt(prev.f)} ${'   .   '} | ${fmt(prev.o)} ${'   .   '} | ${fmt(prev.h)} ${'   .   '} | ${prev.p_max || '-'}`);

const tick = () => {
  const cur = snapshot();
  const line = `${new Date().toLocaleTimeString()} | ${fmt(cur.p)} ${delta(cur.p, prev.p)} | ${fmt(cur.f)} ${delta(cur.f, prev.f)} | ${fmt(cur.o)} ${delta(cur.o, prev.o)} | ${fmt(cur.h)} ${delta(cur.h, prev.h)} | ${cur.p_max || '-'}`;
  console.log(line);
  prev = cur;
};

setInterval(tick, intervalSec * 1000);
process.on('SIGINT', () => { db.close(); process.exit(0); });
