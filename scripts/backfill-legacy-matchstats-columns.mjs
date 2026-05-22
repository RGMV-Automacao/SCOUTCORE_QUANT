#!/usr/bin/env node
import Database from 'better-sqlite3';
import { applyExtractionMigrations, resolveExtractionDbPath } from './lib/extraction-db.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
  }
  return out;
}

function parsePayloadStats(payloadRaw) {
  try {
    const payload = JSON.parse(payloadRaw || '{}');
    const map = new Map();
    for (const stat of payload?.stat || []) {
      if (stat?.type) map.set(stat.type, Number.parseFloat(stat.value));
    }
    return map;
  } catch {
    return new Map();
  }
}

function getInt(stats, key) {
  const value = stats.get(key);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function getFloat(stats, key) {
  const value = stats.get(key);
  return Number.isFinite(value) ? value : null;
}

const args = parseArgs();
const dbPath = resolveExtractionDbPath(args.dbPath);
applyExtractionMigrations({ dbPath });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const timeRows = db.prepare(`
  SELECT t.id_confronto, t.time, t.side, t.modo,
         t.gols, t.escanteios, t.chutes, t.chutes_no_alvo, t.faltas,
         t.defesas, t.payload_raw,
         p.id_liga, p.confronto, p.rodada, p.status
    FROM times t
    LEFT JOIN partidas p ON p.id_confronto = t.id_confronto
   WHERE t.modo IN ('FT', 'HT')
   ORDER BY t.id_confronto, t.modo, t.side
`).all();

const groupedTimes = new Map();
for (const row of timeRows) {
  const key = `${row.id_confronto}::${row.modo}`;
  const entry = groupedTimes.get(key) || [];
  entry.push(row);
  groupedTimes.set(key, entry);
}

const updateTime = db.prepare(`
  UPDATE times
     SET id_liga = @id_liga,
         confronto = @confronto,
         rodada = @rodada,
         status = @status,
         assistencias = COALESCE(@assistencias, assistencias),
         chutes_bloqueados = COALESCE(@chutes_bloqueados, chutes_bloqueados),
         passes = COALESCE(@passes, passes),
         cruzamentos = COALESCE(@cruzamentos, cruzamentos),
         desarmes = COALESCE(@desarmes, desarmes),
         faltas_cometidas = COALESCE(@faltas_cometidas, faltas_cometidas, faltas),
         faltas_sofridas = COALESCE(@faltas_sofridas, faltas_sofridas),
         escanteios_sofridos = COALESCE(@escanteios_sofridos, escanteios_sofridos),
         chutes_sofridos = COALESCE(@chutes_sofridos, chutes_sofridos),
         chutes_noalvo_sofridos = COALESCE(@chutes_noalvo_sofridos, chutes_noalvo_sofridos),
         posse = COALESCE(@posse, posse),
         passes_certos = COALESCE(@passes_certos, passes_certos),
         desarmes_certos = COALESCE(@desarmes_certos, desarmes_certos),
         clean_sheet = COALESCE(@clean_sheet, clean_sheet),
         atualizado_em = datetime('now')
   WHERE id_confronto = @id_confronto
     AND time = @time
     AND modo = @modo
`);

const updateConfronto = db.prepare(`
  UPDATE confronto
     SET id_liga = @id_liga,
         confronto = @confronto,
         rodada = @rodada,
         status = @status,
         gols = @gols,
         assistencias = COALESCE(@assistencias, assistencias),
         cartoes_vermelhos = @cartoes_vermelhos,
         cartoes_amarelos = @cartoes_amarelos,
         escanteios = @escanteios,
         chutes = @chutes,
         chutes_no_alvo = @chutes_no_alvo,
         chutes_bloqueados = COALESCE(@chutes_bloqueados, chutes_bloqueados),
         passes = COALESCE(@passes, passes),
         cruzamentos = COALESCE(@cruzamentos, cruzamentos),
         desarmes = COALESCE(@desarmes, desarmes),
         impedimentos = @impedimentos,
         faltas_cometidas = COALESCE(@faltas_cometidas, total_faltas),
         faltas_sofridas = COALESCE(@faltas_sofridas, total_faltas),
         defesas = COALESCE(@defesas, defesas),
         atualizado_em = datetime('now')
   WHERE id_confronto = @id_confronto
     AND modo = @modo
`);

const selectTeamAggRows = db.prepare(`
  SELECT id_confronto, modo,
         SUM(assistencias) AS assistencias,
         SUM(chutes_bloqueados) AS chutes_bloqueados,
         SUM(passes) AS passes,
         SUM(cruzamentos) AS cruzamentos,
         SUM(desarmes) AS desarmes,
         SUM(faltas_cometidas) AS faltas_cometidas,
         SUM(faltas_sofridas) AS faltas_sofridas,
         SUM(defesas) AS defesas
    FROM times
   GROUP BY id_confronto, modo
`);

const confrontoRows = db.prepare(`
  SELECT c.id_confronto, c.modo,
         c.total_gols, c.total_escanteios, c.total_chutes, c.total_chutes_no_alvo,
         c.total_faltas, c.total_cartoes_amarelos, c.total_cartoes_vermelhos,
         c.total_impedimentos,
         p.id_liga, p.confronto, p.rodada, p.status
    FROM confronto c
    LEFT JOIN partidas p ON p.id_confronto = c.id_confronto
   WHERE c.modo IN ('FT', 'HT')
`).all();

let timesUpdated = 0;
let confrontoUpdated = 0;

const tx = db.transaction(() => {
  for (const rows of groupedTimes.values()) {
    for (const row of rows) {
      const opponent = rows.find((candidate) => candidate.time !== row.time) || null;
      const payloadStats = row.modo === 'FT' ? parsePayloadStats(row.payload_raw) : new Map();
      const update = {
        id_confronto: row.id_confronto,
        time: row.time,
        modo: row.modo,
        id_liga: row.id_liga ?? null,
        confronto: row.confronto ?? null,
        rodada: row.rodada ?? null,
        status: row.status ?? null,
        assistencias: row.modo === 'FT' ? (getInt(payloadStats, 'goalAssist') ?? 0) : null,
        chutes_bloqueados: row.modo === 'FT' ? (getInt(payloadStats, 'blockedScoringAtt') ?? 0) : null,
        passes: row.modo === 'FT' ? (getInt(payloadStats, 'totalPass') ?? 0) : null,
        cruzamentos: 0,
        desarmes: row.modo === 'FT' ? (getInt(payloadStats, 'totalTackle') ?? 0) : null,
        faltas_cometidas: row.modo === 'FT' ? (getInt(payloadStats, 'fkFoulLost') ?? row.faltas ?? 0) : (row.faltas ?? null),
        faltas_sofridas: row.modo === 'FT' ? (getInt(payloadStats, 'fkFoulWon') ?? 0) : null,
        escanteios_sofridos: opponent?.escanteios ?? null,
        chutes_sofridos: opponent?.chutes ?? null,
        chutes_noalvo_sofridos: opponent?.chutes_no_alvo ?? null,
        posse: row.modo === 'FT' ? getFloat(payloadStats, 'possessionPercentage') : null,
        passes_certos: row.modo === 'FT' ? getInt(payloadStats, 'accuratePass') : null,
        desarmes_certos: row.modo === 'FT' ? getInt(payloadStats, 'wonTackle') : null,
        clean_sheet: row.modo === 'FT'
          ? (getInt(payloadStats, 'cleanSheet') ?? (opponent?.gols != null ? (Number(opponent.gols) === 0 ? 1 : 0) : null))
          : null,
      };
      updateTime.run(update);
      timesUpdated += 1;
    }
  }

  const teamAggRows = selectTeamAggRows.all();
  const teamAgg = new Map(teamAggRows.map((row) => [`${row.id_confronto}::${row.modo}`, row]));

  for (const row of confrontoRows) {
    const agg = teamAgg.get(`${row.id_confronto}::${row.modo}`) || {};
    updateConfronto.run({
      ...row,
      gols: row.total_gols,
      cartoes_vermelhos: row.total_cartoes_vermelhos,
      cartoes_amarelos: row.total_cartoes_amarelos,
      escanteios: row.total_escanteios,
      chutes: row.total_chutes,
      chutes_no_alvo: row.total_chutes_no_alvo,
      impedimentos: row.total_impedimentos,
      assistencias: agg.assistencias ?? null,
      chutes_bloqueados: agg.chutes_bloqueados ?? null,
      passes: agg.passes ?? null,
      cruzamentos: agg.cruzamentos ?? null,
      desarmes: agg.desarmes ?? null,
      faltas_cometidas: agg.faltas_cometidas ?? row.total_faltas,
      faltas_sofridas: agg.faltas_sofridas ?? row.total_faltas,
      defesas: agg.defesas ?? null,
    });
    confrontoUpdated += 1;
  }
});

if (!args.dryRun) tx();

const coverage = db.prepare(`
  SELECT
    SUM(CASE WHEN modo = 'FT' AND desarmes IS NOT NULL THEN 1 ELSE 0 END) AS ft_desarmes,
    SUM(CASE WHEN modo = 'HT' AND desarmes IS NOT NULL THEN 1 ELSE 0 END) AS ht_desarmes,
    SUM(CASE WHEN modo = 'FT' AND posse IS NOT NULL THEN 1 ELSE 0 END) AS ft_posse,
    SUM(CASE WHEN modo = 'HT' AND posse IS NOT NULL THEN 1 ELSE 0 END) AS ht_posse
  FROM times
`).get();

console.log(`[backfill-legacy-matchstats-columns] db=${dbPath}`);
console.log(`[backfill-legacy-matchstats-columns] dry_run=${args.dryRun ? '1' : '0'} times_updated=${timesUpdated} confronto_updated=${confrontoUpdated}`);
console.log(`[backfill-legacy-matchstats-columns] coverage ft_desarmes=${coverage.ft_desarmes} ht_desarmes=${coverage.ht_desarmes} ft_posse=${coverage.ft_posse} ht_posse=${coverage.ht_posse}`);

db.close();