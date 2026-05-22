#!/usr/bin/env node
// scripts/backtest/eval-markets.mjs
//
// Para cada (id_confronto, market_key) em backtest_predictions, computa o
// outcome real via settle() usando backtest_outcomes. Persiste em backtest_eval.
//
// O mapeamento backtest_outcomes → result-shape do settle() é feito por buildResult().
//
// Uso:
//   node scripts/backtest/eval-markets.mjs            # rebuild full

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { settle } from '@scoutcore/markets';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SCOUT_DB
  ? path.resolve(process.env.SCOUT_DB)
  : path.resolve(__dirname, '..', '..', 'data', 'scout_extraction.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

console.log('[eval-markets] limpando backtest_eval...');
db.exec('DELETE FROM backtest_eval');

// 1. carregar outcomes em memória (15k partidas, ~70 cols cada — ~10MB, ok)
console.log('[eval-markets] carregando outcomes...');
const outRows = db.prepare(`SELECT * FROM backtest_outcomes`).all();
const outcomes = new Map();
for (const o of outRows) outcomes.set(o.id_confronto, o);
console.log(`  ${outcomes.size} partidas carregadas`);

const insertStmt = db.prepare(`
  INSERT INTO backtest_eval (id_confronto, market_key, fair_prob, observed, outcome, reason)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stats = { total: 0, green: 0, red: 0, push: 0, void: 0, voidReasons: {} };

// 2. iterar por id_confronto (lote pequeno por partida = ~550 slots)
const ids = db.prepare('SELECT DISTINCT id_confronto FROM backtest_predictions').all();
console.log(`[eval-markets] ${ids.length} partidas com predictions`);

const slotsStmt = db.prepare('SELECT market_key, fair_prob FROM backtest_predictions WHERE id_confronto = ?');

const processPartida = db.transaction((id, result, slots) => {
  for (const s of slots) {
    const res = settle(s.market_key, result);
    let observed = null;
    if (res.outcome === 'green') observed = 1;
    else if (res.outcome === 'red') observed = 0;
    insertStmt.run(id, s.market_key, s.fair_prob, observed, res.outcome, res.reason ?? null);
    stats[res.outcome]++;
    if (res.outcome === 'void') {
      stats.voidReasons[res.reason || 'unknown'] = (stats.voidReasons[res.reason || 'unknown'] || 0) + 1;
    }
    stats.total++;
  }
});

const t0 = Date.now();
let processed = 0;
for (const { id_confronto } of ids) {
  const o = outcomes.get(id_confronto);
  if (!o) { processed++; continue; }
  const result = buildResult(o);
  const slots = slotsStmt.all(id_confronto);
  processPartida(id_confronto, result, slots);
  processed++;
  if (processed % 1000 === 0) {
    const el = (Date.now() - t0) / 1000;
    console.log(`  ${processed}/${ids.length} | ${Math.round(stats.total / el)} slots/s | g=${stats.green} r=${stats.red} p=${stats.push} v=${stats.void}`);
  }
}

console.log(`\n[eval-markets] resumo:`);
console.log(`  total:  ${stats.total}`);
console.log(`  green:  ${stats.green} (${(100*stats.green/stats.total).toFixed(1)}%)`);
console.log(`  red:    ${stats.red} (${(100*stats.red/stats.total).toFixed(1)}%)`);
console.log(`  push:   ${stats.push} (${(100*stats.push/stats.total).toFixed(1)}%)`);
console.log(`  void:   ${stats.void} (${(100*stats.void/stats.total).toFixed(1)}%)`);
console.log(`  tempo:  ${((Date.now()-t0)/1000).toFixed(1)}s`);

if (Object.keys(stats.voidReasons).length) {
  console.log('\nTop void reasons:');
  Object.entries(stats.voidReasons).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
}

db.close();

// ===== mapping backtest_outcomes → settle.result =====
function buildResult(o) {
  // Apollo/settle.mjs trabalha com FT, HT e 2T (segundo tempo). 2T = FT - HT.
  return {
    home_goals_ft: o.gols_ft_home,
    away_goals_ft: o.gols_ft_away,
    home_goals_ht: o.gols_ht_home,
    away_goals_ht: o.gols_ht_away,
    home_goals_2t: sub(o.gols_ft_home, o.gols_ht_home),
    away_goals_2t: sub(o.gols_ft_away, o.gols_ht_away),

    home_corners:    o.escanteios_ft_home,
    away_corners:    o.escanteios_ft_away,
    home_corners_ht: o.escanteios_ht_home,
    away_corners_ht: o.escanteios_ht_away,

    home_shots: o.chutes_ft_home,
    away_shots: o.chutes_ft_away,
    home_shots_ht: o.chutes_ht_home,
    away_shots_ht: o.chutes_ht_away,

    home_shots_on_target: o.sot_ft_home,
    away_shots_on_target: o.sot_ft_away,
    home_shots_on_target_ht: o.sot_ht_home,
    away_shots_on_target_ht: o.sot_ht_away,

    home_yc: o.ca_ft_home,
    away_yc: o.ca_ft_away,
    home_rc: o.cv_ft_home,
    away_rc: o.cv_ft_away,
    home_yc_ht: o.ca_ht_home,
    away_yc_ht: o.ca_ht_away,
    home_rc_ht: o.cv_ht_home,
    away_rc_ht: o.cv_ht_away,

    home_fouls: o.faltas_ft_home,
    away_fouls: o.faltas_ft_away,
    home_fouls_ht: o.faltas_ht_home,
    away_fouls_ht: o.faltas_ht_away,

    home_offsides: o.imp_ft_home,
    away_offsides: o.imp_ft_away,
    home_offsides_ht: o.imp_ht_home,
    away_offsides_ht: o.imp_ht_away,

    // marca_primeiro / marca_ultimo — não temos timestamp do gol em backtest_outcomes
    first_goal_team: null,
    last_goal_team:  null,
  };
}

function sub(a, b) {
  if (a == null || b == null) return null;
  return Number(a) - Number(b);
}
