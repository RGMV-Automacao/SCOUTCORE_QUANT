#!/usr/bin/env node
// scripts/backtest/build-outcomes.mjs
//
// Constrói `backtest_outcomes` (ground truth por partida) a partir de:
//  1) Primário: `times.modo` (FT/HT) por equipe + `confronto.modo` para totais
//  2) Fallback: `eventos_faixa` (soma faixas: HT = 0-10..31-45, FT = todas)
//
// Regras espelham ApolloFinalV2/product/resolver.cjs e settle-actuals.cjs.
// Booking points = amarelo + 2*vermelho.
//
// Uso:
//   node scripts/backtest/build-outcomes.mjs            # incremental
//   node scripts/backtest/build-outcomes.mjs --rebuild  # apaga e recria
//   node scripts/backtest/build-outcomes.mjs --liga brasileirao
//   node scripts/backtest/build-outcomes.mjs --limit 100 --verbose

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

const FAIXAS_HT = ['0-10', '11-20', '21-30', '31-45'];
// FT = todas as 8 faixas existentes em eventos_faixa (sem 90+ porque tabela não tem)

if (args.rebuild) {
  console.log('[build-outcomes] --rebuild: apagando linhas existentes');
  db.exec('DELETE FROM backtest_outcomes');
}

// 1. selecionar partidas elegíveis
const partidasStmt = db.prepare(`
  SELECT id_confronto, liga, temporada, data_partida, home_team, away_team,
         home_goals, away_goals, home_goals_ht, away_goals_ht
  FROM partidas
  WHERE home_goals IS NOT NULL
    AND away_goals IS NOT NULL
    AND id_confronto IS NOT NULL
    AND home_team IS NOT NULL
    AND away_team IS NOT NULL
    ${args.liga ? `AND liga = @liga` : ''}
  ${args.limit ? `LIMIT @limit` : ''}
`);
const partidas = partidasStmt.all({ liga: args.liga, limit: args.limit });
console.log(`[build-outcomes] partidas elegíveis: ${partidas.length}`);

// 2. statements auxiliares
const timesStmt = db.prepare(`
  SELECT modo, time, gols, escanteios, chutes, chutes_no_alvo,
         cartoes_amarelos, cartoes_vermelhos, impedimentos, faltas_cometidas
  FROM times
  WHERE id_confronto = ? AND modo IN ('FT', 'HT')
`);

const confrontoStmt = db.prepare(`
  SELECT modo, gols, escanteios, chutes, chutes_no_alvo,
         cartoes_amarelos, cartoes_vermelhos, impedimentos, faltas_cometidas
  FROM confronto
  WHERE id_confronto = ? AND modo IN ('FT', 'HT')
`);

const eventosStmt = db.prepare(`
  SELECT faixa, time,
         SUM(escanteios) escanteios, SUM(chutes) chutes,
         SUM(chutes_no_alvo) chutes_no_alvo, SUM(faltas) faltas,
         SUM(cartoes_amarelos) ca, SUM(cartoes_vermelhos) cv,
         SUM(gols) gols, SUM(impedimentos) impedimentos
  FROM eventos_faixa
  WHERE id_confronto = ?
  GROUP BY faixa, time
`);

const insertStmt = db.prepare(`
INSERT INTO backtest_outcomes (
  id_confronto, liga, temporada, data_partida, home_team, away_team,
  gols_ft_home, gols_ft_away, gols_ft_total, gols_ht_home, gols_ht_away, gols_ht_total,
  escanteios_ft_home, escanteios_ft_away, escanteios_ft_total,
  escanteios_ht_home, escanteios_ht_away, escanteios_ht_total,
  chutes_ft_home, chutes_ft_away, chutes_ft_total,
  chutes_ht_home, chutes_ht_away, chutes_ht_total,
  sot_ft_home, sot_ft_away, sot_ft_total, sot_ht_home, sot_ht_away, sot_ht_total,
  ca_ft_home, ca_ft_away, ca_ft_total, ca_ht_home, ca_ht_away, ca_ht_total,
  cv_ft_home, cv_ft_away, cv_ft_total, cv_ht_home, cv_ht_away, cv_ht_total,
  bp_ft_home, bp_ft_away, bp_ft_total, bp_ht_home, bp_ht_away, bp_ht_total,
  imp_ft_home, imp_ft_away, imp_ft_total, imp_ht_home, imp_ht_away, imp_ht_total,
  faltas_ft_home, faltas_ft_away, faltas_ft_total,
  faltas_ht_home, faltas_ht_away, faltas_ht_total,
  btts_ft, resultado_ft, btts_ht, resultado_ht,
  marca_home_ft, marca_away_ft, marca_home_ht, marca_away_ht,
  source_stats
) VALUES (
  @id_confronto, @liga, @temporada, @data_partida, @home_team, @away_team,
  @gols_ft_home, @gols_ft_away, @gols_ft_total, @gols_ht_home, @gols_ht_away, @gols_ht_total,
  @escanteios_ft_home, @escanteios_ft_away, @escanteios_ft_total,
  @escanteios_ht_home, @escanteios_ht_away, @escanteios_ht_total,
  @chutes_ft_home, @chutes_ft_away, @chutes_ft_total,
  @chutes_ht_home, @chutes_ht_away, @chutes_ht_total,
  @sot_ft_home, @sot_ft_away, @sot_ft_total, @sot_ht_home, @sot_ht_away, @sot_ht_total,
  @ca_ft_home, @ca_ft_away, @ca_ft_total, @ca_ht_home, @ca_ht_away, @ca_ht_total,
  @cv_ft_home, @cv_ft_away, @cv_ft_total, @cv_ht_home, @cv_ht_away, @cv_ht_total,
  @bp_ft_home, @bp_ft_away, @bp_ft_total, @bp_ht_home, @bp_ht_away, @bp_ht_total,
  @imp_ft_home, @imp_ft_away, @imp_ft_total, @imp_ht_home, @imp_ht_away, @imp_ht_total,
  @faltas_ft_home, @faltas_ft_away, @faltas_ft_total,
  @faltas_ht_home, @faltas_ht_away, @faltas_ht_total,
  @btts_ft, @resultado_ft, @btts_ht, @resultado_ht,
  @marca_home_ft, @marca_away_ft, @marca_home_ht, @marca_away_ht,
  @source_stats
)
ON CONFLICT(id_confronto) DO UPDATE SET
  built_at = datetime('now'),
  source_stats = excluded.source_stats,
  gols_ft_total = excluded.gols_ft_total,
  escanteios_ft_total = excluded.escanteios_ft_total,
  chutes_ft_total = excluded.chutes_ft_total,
  sot_ft_total = excluded.sot_ft_total
`);

// 3. processar
const stats = { total: 0, ok: 0, fallback: 0, mixed: 0, skipped: 0 };

const processBatch = db.transaction((rows) => {
  for (const p of rows) {
    try {
      const row = buildRow(p);
      if (!row) { stats.skipped++; continue; }
      insertStmt.run(row);
      if (row.source_stats === 'times') stats.ok++;
      else if (row.source_stats === 'eventos_faixa') stats.fallback++;
      else stats.mixed++;
    } catch (e) {
      stats.skipped++;
      if (args.verbose) console.error('skip', p.id_confronto, e.message);
    }
    stats.total++;
  }
});

const BATCH = 500;
for (let i = 0; i < partidas.length; i += BATCH) {
  processBatch(partidas.slice(i, i + BATCH));
  if (i % 2000 === 0 && i > 0) {
    console.log(`  ${i}/${partidas.length} processadas (ok=${stats.ok} fallback=${stats.fallback} skip=${stats.skipped})`);
  }
}

console.log('\n[build-outcomes] resumo:', stats);

// 4. validação rápida
const cov = db.prepare(`
  SELECT liga, COUNT(*) n, AVG(gols_ft_total) avg_gols_ft, AVG(escanteios_ft_total) avg_esc_ft, AVG(sot_ft_total) avg_sot_ft
  FROM backtest_outcomes GROUP BY liga ORDER BY n DESC LIMIT 15
`).all();
console.log('\nCobertura por liga (com médias sanity-check):');
cov.forEach(c => console.log(`  ${c.liga.padEnd(22)} n=${String(c.n).padEnd(5)} gols_ft=${(c.avg_gols_ft||0).toFixed(2)} esc_ft=${(c.avg_esc_ft||0).toFixed(2)} sot_ft=${(c.avg_sot_ft||0).toFixed(2)}`));

db.close();

// ===== helpers =====

function buildRow(p) {
  const timesRows = timesStmt.all(p.id_confronto);
  const confRows = confrontoStmt.all(p.id_confronto);

  const hasTimes = timesRows.some(r => r.time === p.home_team) && timesRows.some(r => r.time === p.away_team);
  const hasFtHt = timesRows.some(r => r.modo === 'FT') && timesRows.some(r => r.modo === 'HT');
  const hasConfFtHt = confRows.some(r => r.modo === 'FT') && confRows.some(r => r.modo === 'HT');

  let source = 'times';
  let agg;

  if (hasTimes && hasFtHt && hasConfFtHt) {
    agg = aggregateFromTimes(timesRows, confRows, p);
  } else {
    const eventosRows = eventosStmt.all(p.id_confronto);
    if (eventosRows.length === 0) return null;
    agg = aggregateFromEventos(eventosRows, p);
    source = (hasTimes ? 'mixed' : 'eventos_faixa');
  }

  // gols sempre de partidas (mais confiável)
  agg.gols_ft_home = p.home_goals;
  agg.gols_ft_away = p.away_goals;
  agg.gols_ft_total = (p.home_goals ?? 0) + (p.away_goals ?? 0);
  agg.gols_ht_home = p.home_goals_ht;
  agg.gols_ht_away = p.away_goals_ht;
  agg.gols_ht_total = (p.home_goals_ht ?? 0) + (p.away_goals_ht ?? 0);

  // booking points
  agg.bp_ft_home  = bp(agg.ca_ft_home, agg.cv_ft_home);
  agg.bp_ft_away  = bp(agg.ca_ft_away, agg.cv_ft_away);
  agg.bp_ft_total = bp(agg.ca_ft_total, agg.cv_ft_total);
  agg.bp_ht_home  = bp(agg.ca_ht_home, agg.cv_ht_home);
  agg.bp_ht_away  = bp(agg.ca_ht_away, agg.cv_ht_away);
  agg.bp_ht_total = bp(agg.ca_ht_total, agg.cv_ht_total);

  // labels
  agg.btts_ft = (p.home_goals > 0 && p.away_goals > 0) ? 1 : 0;
  agg.btts_ht = (p.home_goals_ht > 0 && p.away_goals_ht > 0) ? 1 : 0;
  agg.resultado_ft = result1x2(p.home_goals, p.away_goals);
  agg.resultado_ht = result1x2(p.home_goals_ht, p.away_goals_ht);
  agg.marca_home_ft = p.home_goals > 0 ? 1 : 0;
  agg.marca_away_ft = p.away_goals > 0 ? 1 : 0;
  agg.marca_home_ht = (p.home_goals_ht ?? 0) > 0 ? 1 : 0;
  agg.marca_away_ht = (p.away_goals_ht ?? 0) > 0 ? 1 : 0;

  return {
    id_confronto: p.id_confronto,
    liga: p.liga,
    temporada: p.temporada,
    data_partida: p.data_partida,
    home_team: p.home_team,
    away_team: p.away_team,
    source_stats: source,
    ...agg,
  };
}

function aggregateFromTimes(timesRows, confRows, p) {
  const out = {};
  const home = (modo) => timesRows.find(r => r.modo === modo && r.time === p.home_team) || {};
  const away = (modo) => timesRows.find(r => r.modo === modo && r.time === p.away_team) || {};
  const tot = (modo) => confRows.find(r => r.modo === modo) || {};

  for (const period of ['ft', 'ht']) {
    const modo = period.toUpperCase();
    const h = home(modo), a = away(modo), t = tot(modo);

    out[`escanteios_${period}_home`]  = num(h.escanteios);
    out[`escanteios_${period}_away`]  = num(a.escanteios);
    out[`escanteios_${period}_total`] = num(t.escanteios);

    out[`chutes_${period}_home`]  = num(h.chutes);
    out[`chutes_${period}_away`]  = num(a.chutes);
    out[`chutes_${period}_total`] = num(t.chutes);

    out[`sot_${period}_home`]  = num(h.chutes_no_alvo);
    out[`sot_${period}_away`]  = num(a.chutes_no_alvo);
    out[`sot_${period}_total`] = num(t.chutes_no_alvo);

    out[`ca_${period}_home`]  = num(h.cartoes_amarelos);
    out[`ca_${period}_away`]  = num(a.cartoes_amarelos);
    out[`ca_${period}_total`] = num(t.cartoes_amarelos);

    out[`cv_${period}_home`]  = num(h.cartoes_vermelhos);
    out[`cv_${period}_away`]  = num(a.cartoes_vermelhos);
    out[`cv_${period}_total`] = num(t.cartoes_vermelhos);

    out[`imp_${period}_home`]  = num(h.impedimentos);
    out[`imp_${period}_away`]  = num(a.impedimentos);
    out[`imp_${period}_total`] = num(t.impedimentos);

    out[`faltas_${period}_home`]  = num(h.faltas_cometidas);
    out[`faltas_${period}_away`]  = num(a.faltas_cometidas);
    out[`faltas_${period}_total`] = num(t.faltas_cometidas);
  }
  return out;
}

function aggregateFromEventos(rows, p) {
  // soma por (time, faixa∈HT) e (time, faixa∈qualquer)
  const out = {};
  const stats = ['escanteios', 'chutes', 'chutes_no_alvo', 'ca', 'cv', 'impedimentos', 'faltas'];
  const ALIAS = { escanteios:'escanteios', chutes:'chutes', chutes_no_alvo:'sot', ca:'ca', cv:'cv', impedimentos:'imp', faltas:'faltas' };

  for (const s of stats) out[`${ALIAS[s]}_ft_home`] = out[`${ALIAS[s]}_ft_away`] = out[`${ALIAS[s]}_ft_total`] = 0;
  for (const s of stats) out[`${ALIAS[s]}_ht_home`] = out[`${ALIAS[s]}_ht_away`] = out[`${ALIAS[s]}_ht_total`] = 0;

  for (const r of rows) {
    const isHt = FAIXAS_HT.includes(r.faixa);
    const isHome = r.time === p.home_team;
    const isAway = r.time === p.away_team;
    const period = ['ft']; if (isHt) period.push('ht');

    for (const per of period) {
      out[`escanteios_${per}_total`] += num(r.escanteios);
      out[`chutes_${per}_total`]     += num(r.chutes);
      out[`sot_${per}_total`]        += num(r.chutes_no_alvo);
      out[`ca_${per}_total`]         += num(r.ca);
      out[`cv_${per}_total`]         += num(r.cv);
      out[`imp_${per}_total`]        += num(r.impedimentos);
      out[`faltas_${per}_total`]     += num(r.faltas);
      if (isHome) {
        out[`escanteios_${per}_home`] += num(r.escanteios);
        out[`chutes_${per}_home`]     += num(r.chutes);
        out[`sot_${per}_home`]        += num(r.chutes_no_alvo);
        out[`ca_${per}_home`]         += num(r.ca);
        out[`cv_${per}_home`]         += num(r.cv);
        out[`imp_${per}_home`]        += num(r.impedimentos);
        out[`faltas_${per}_home`]     += num(r.faltas);
      } else if (isAway) {
        out[`escanteios_${per}_away`] += num(r.escanteios);
        out[`chutes_${per}_away`]     += num(r.chutes);
        out[`sot_${per}_away`]        += num(r.chutes_no_alvo);
        out[`ca_${per}_away`]         += num(r.ca);
        out[`cv_${per}_away`]         += num(r.cv);
        out[`imp_${per}_away`]        += num(r.impedimentos);
        out[`faltas_${per}_away`]     += num(r.faltas);
      }
    }
  }
  return out;
}

function bp(amar, verm) {
  if (amar == null && verm == null) return null;
  return (num(amar)) + 2 * (num(verm));
}

function num(v) { return v == null ? 0 : Number(v) || 0; }

function result1x2(h, a) {
  if (h == null || a == null) return null;
  if (h > a) return '1';
  if (h < a) return '2';
  return 'X';
}

function parseArgs(argv) {
  const out = { rebuild: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rebuild') out.rebuild = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--liga')  out.liga  = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
  }
  return out;
}
