import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  applyExtractionMigrations,
  openExtractionDb,
  resolveExtractionDbPath,
} from '../../../scripts/lib/extraction-db.mjs';
import { buildStatslineHeaders } from './extract-statsline-schedule.mjs';
import { resolveToOriginal } from './statsline-team-resolver.mjs';

const SOURCE_VERSION = 'matchstats-v2';
const FAIXAS = [
  { label: '0-10', min: 0, max: 10 },
  { label: '11-20', min: 11, max: 20 },
  { label: '21-30', min: 21, max: 30 },
  { label: '31-45', min: 31, max: 45 },
  { label: '46-55', min: 46, max: 55 },
  { label: '56-65', min: 56, max: 65 },
  { label: '66-75', min: 66, max: 75 },
  { label: '76-90', min: 76, max: 99 },
];
const EVT = {
  PASS: 1,
  OFFSIDE_PASS: 2,
  FOUL: 4,
  CORNER: 6,
  TACKLE: 7,
  SAVE: 10,
  MISS: 13,
  POST: 14,
  ATTEMPT_SAVED: 15,
  GOAL: 16,
  CARD: 17,
  OFFSIDE: 51,
};

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false, force: false };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--force') out.force = true;
    else if (arg === '--all') out.all = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--liga=')) out.liga = arg.slice(7);
    else if (arg.startsWith('--temporada=')) out.temporada = arg.slice(12);
    else if (arg.startsWith('--match-id=')) out.matchId = arg.slice(11);
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg.startsWith('--limit=')) out.limit = Number(arg.slice(8));
    else if (arg.startsWith('--concurrency=')) out.concurrency = Number(arg.slice(14));
    else if (arg === '--help' || arg === '-h') out.help = true;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node apps/jobs/src/extract-statsline-matchstats.mjs --liga=brasileirao --temporada=2025 [--limit=N] [--concurrency=N] [--force] [--dry-run]');
  console.log('     node apps/jobs/src/extract-statsline-matchstats.mjs --all [--limit=N] [--concurrency=N]');
}

function resolveConcurrency(options) {
  const envVal = Number.parseInt(process.env.STATSLINE_MATCHSTATS_CONCURRENCY ?? '', 10);
  const raw = Number.isFinite(options?.concurrency) && options.concurrency > 0
    ? options.concurrency
    : Number.isFinite(envVal) && envVal > 0 ? envVal : 8;
  return Math.max(1, Math.min(32, raw));
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function getStat(stats, type) {
  if (!Array.isArray(stats)) return 0;
  const item = stats.find((stat) => stat.type === type);
  return item ? Number.parseFloat(item.value) || 0 : 0;
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventSucceeded(event) {
  return event?.outcome === 1 || event?.outcome === '1';
}

function countSuccessfulEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  if (!events.some((event) => event?.outcome != null)) return null;
  return events.filter((event) => eventSucceeded(event)).length;
}

function sumStats(...values) {
  let total = 0;
  let hasValue = false;
  for (const value of values) {
    if (value == null) continue;
    hasValue = true;
    total += Number(value) || 0;
  }
  return hasValue ? total : null;
}

function safeJson(value) {
  return JSON.stringify(value ?? {});
}

function inferApiBaseFromScheduleUrls(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('STATSLINE_URL_') || !value) continue;
    try {
      const parsed = new URL(value);
      const marker = parsed.pathname.match(/^(.*)\/match\/[^/]+\/?$/);
      if (marker) return `${parsed.origin}${marker[1]}`;
    } catch {
      // Ignore malformed env values; audit config already owns that validation.
    }
  }
  return null;
}

function buildApiUrl(kind, matchId, env = process.env) {
  const base = env.STATSLINE_API_BASE || inferApiBaseFromScheduleUrls(env);
  const token = env.STATSLINE_TOKEN;
  if (!base) throw new Error('statsline_api_base_not_configured');
  if (!token) throw new Error('statsline_token_not_configured');

  const url = new URL(`${String(base).replace(/\/+$/, '')}/${kind}/${token}/`);
  url.searchParams.set('_rt', 'c');
  url.searchParams.set('fx', matchId);
  url.searchParams.set('_fmt', 'json');
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxRetries = Number.isFinite(options.retries) ? options.retries : 2;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: buildStatslineHeaders(options.env) });
      if (!response?.ok) throw new Error(`http_${response?.status ?? 'unknown'}`);
      const payload = await response.json();
      if (payload?.httpStatus && String(payload.httpStatus) !== '200') {
        const code = payload.errorCode ? `_${payload.errorCode}` : '';
        throw new Error(`provider_${payload.httpStatus}${code}`);
      }
      return payload;
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) break;
      const delayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 750 * (attempt + 1);
      await delay(delayMs);
    }
  }

  throw new Error(`statsline_fetch_failed:${lastError?.message || 'unknown'}`);
}

export async function fetchMatchStats(matchId, options = {}) {
  return fetchJson(buildApiUrl('matchstats', matchId, options.env), options);
}

export async function fetchMatchEvents(matchId, options = {}) {
  return fetchJson(buildApiUrl('matchevent', matchId, options.env), options);
}

function mapTeamStats(teamStats) {
  return {
    gols: getStat(teamStats, 'goals'),
    assistencias: getStat(teamStats, 'goalAssist'),
    cartoes_vermelhos: 0,
    cartoes_amarelos: getStat(teamStats, 'totalYellowCard'),
    escanteios: getStat(teamStats, 'cornerTaken') || getStat(teamStats, 'wonCorners'),
    chutes: getStat(teamStats, 'totalScoringAtt'),
    chutes_no_alvo: getStat(teamStats, 'ontargetScoringAtt'),
    chutes_bloqueados: getStat(teamStats, 'blockedScoringAtt'),
    passes: getStat(teamStats, 'totalPass'),
    cruzamentos: 0,
    desarmes: getStat(teamStats, 'totalTackle'),
    impedimentos: getStat(teamStats, 'totalOffside'),
    faltas_cometidas: getStat(teamStats, 'fkFoulLost'),
    faltas_sofridas: getStat(teamStats, 'fkFoulWon'),
    defesas: getStat(teamStats, 'saves'),
    posse: getStat(teamStats, 'possessionPercentage'),
    passes_certos: getStat(teamStats, 'accuratePass'),
    desarmes_certos: getStat(teamStats, 'wonTackle'),
    clean_sheet: toInteger(getStat(teamStats, 'cleanSheet')),
  };
}

function mapPlayerStats(playerStats) {
  return {
    gols: getStat(playerStats, 'goals'),
    assistencias: getStat(playerStats, 'goalAssist'),
    cartoes_amarelos: getStat(playerStats, 'yellowCard'),
    cartoes_vermelhos: 0,
    escanteios: getStat(playerStats, 'cornerTaken'),
    chutes: getStat(playerStats, 'totalScoringAtt'),
    chutes_no_alvo: getStat(playerStats, 'ontargetScoringAtt'),
    chutes_bloqueados: getStat(playerStats, 'blockedScoringAtt'),
    passes: getStat(playerStats, 'totalPass'),
    cruzamentos: 0,
    desarmes: getStat(playerStats, 'totalTackle'),
    impedimentos: getStat(playerStats, 'totalOffside'),
    faltas_cometidas: getStat(playerStats, 'fouls'),
    faltas_sofridas: getStat(playerStats, 'wasFouled'),
    defesas: getStat(playerStats, 'saves'),
    minutos: getStat(playerStats, 'minsPlayed'),
    titular: getStat(playerStats, 'gameStarted'),
  };
}

function countRedCards(cards, contestantId, periodId = null) {
  if (!Array.isArray(cards)) return 0;
  return cards.filter((card) => {
    const periodOk = periodId == null || card.periodId === periodId || String(card.periodId) === String(periodId);
    return periodOk && card.contestantId === contestantId && (card.type === 'RC' || card.type === 'Y2C');
  }).length;
}

function hasQualifier(event, qualifierId) {
  return event.qualifier?.some((qualifier) => Number.parseInt(qualifier.qualifierId, 10) === qualifierId) || false;
}

function isPeriod(event, periodId) {
  return event.periodId === periodId || String(event.periodId) === String(periodId);
}

function deriveHTStats(events, contestantId, opponentId) {
  const htEvents = events.filter((event) => isPeriod(event, 1) && event.contestantId === contestantId);
  const htPasses = events.filter((event) => Number.parseInt(event.typeId, 10) === EVT.PASS && isPeriod(event, 1));
  const teamPassEvents = htPasses.filter((event) => event.contestantId === contestantId);
  const opponentPassEvents = htPasses.filter((event) => event.contestantId === opponentId);
  const teamPasses = teamPassEvents.length;
  const opponentPasses = opponentPassEvents.length;
  const teamTackleEvents = htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.TACKLE);
  const onTarget = htEvents.filter((event) => {
    const typeId = Number.parseInt(event.typeId, 10);
    if (typeId === EVT.GOAL) return true;
    if (typeId === EVT.ATTEMPT_SAVED) return !hasQualifier(event, 82);
    return false;
  }).length;

  return {
    gols: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.GOAL).length,
    assistencias: 0,
    cartoes_vermelhos: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.CARD && (event.cardType === 'RC' || event.cardType === 'Y2C')).length,
    cartoes_amarelos: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.CARD).length,
    escanteios: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.CORNER && (event.outcome === 1 || event.outcome === '1')).length,
    chutes: htEvents.filter((event) => [EVT.MISS, EVT.POST, EVT.ATTEMPT_SAVED, EVT.GOAL].includes(Number.parseInt(event.typeId, 10))).length,
    chutes_no_alvo: onTarget,
    chutes_bloqueados: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.ATTEMPT_SAVED && hasQualifier(event, 82)).length,
    passes: teamPasses,
    cruzamentos: 0,
    desarmes: teamTackleEvents.length,
    impedimentos: htEvents.filter((event) => [EVT.OFFSIDE, EVT.OFFSIDE_PASS].includes(Number.parseInt(event.typeId, 10))).length,
    faltas_cometidas: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.FOUL && (event.outcome === 0 || event.outcome === '0')).length,
    faltas_sofridas: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.FOUL && (event.outcome === 1 || event.outcome === '1')).length,
    defesas: htEvents.filter((event) => Number.parseInt(event.typeId, 10) === EVT.SAVE).length,
    passes_certos: countSuccessfulEvents(teamPassEvents),
    posse: teamPasses + opponentPasses > 0 ? (teamPasses / (teamPasses + opponentPasses)) * 100 : null,
    desarmes_certos: countSuccessfulEvents(teamTackleEvents),
    clean_sheet: 0,
  };
}

function enrichTeamStats(teamStats, opponentStats, mode) {
  return {
    ...teamStats,
    faltas: teamStats.faltas_cometidas ?? 0,
    escanteios_sofridos: opponentStats?.escanteios ?? null,
    chutes_sofridos: opponentStats?.chutes ?? null,
    chutes_noalvo_sofridos: opponentStats?.chutes_no_alvo ?? null,
    clean_sheet: teamStats.clean_sheet ?? (mode === 'FT' && opponentStats?.gols != null ? (opponentStats.gols === 0 ? 1 : 0) : 0),
  };
}

function deriveFaixas(events, contestantId) {
  const teamEvents = events.filter((event) => event.contestantId === contestantId);
  return FAIXAS.map((faixa) => {
    const inRange = teamEvents.filter((event) => event.timeMin >= faixa.min && event.timeMin <= faixa.max);
    return {
      faixa: faixa.label,
      minuto_inicio: faixa.min,
      minuto_fim: faixa.max,
      escanteios: inRange.filter((event) => Number.parseInt(event.typeId, 10) === EVT.CORNER && (event.outcome === 1 || event.outcome === '1')).length,
      chutes: inRange.filter((event) => [EVT.MISS, EVT.POST, EVT.ATTEMPT_SAVED, EVT.GOAL].includes(Number.parseInt(event.typeId, 10))).length,
      chutes_no_alvo: inRange.filter((event) => [EVT.ATTEMPT_SAVED, EVT.GOAL].includes(Number.parseInt(event.typeId, 10))).length,
      faltas: inRange.filter((event) => Number.parseInt(event.typeId, 10) === EVT.FOUL && (event.outcome === 0 || event.outcome === '0')).length,
      cartoes_amarelos: inRange.filter((event) => Number.parseInt(event.typeId, 10) === EVT.CARD).length,
      cartoes_vermelhos: inRange.filter((event) => Number.parseInt(event.typeId, 10) === EVT.CARD && (event.cardType === 'RC' || event.cardType === 'Y2C')).length,
      gols: inRange.filter((event) => Number.parseInt(event.typeId, 10) === EVT.GOAL).length,
      impedimentos: inRange.filter((event) => [EVT.OFFSIDE, EVT.OFFSIDE_PASS].includes(Number.parseInt(event.typeId, 10))).length,
    };
  });
}

function totalStats(home, away) {
  const totalFaltasCometidas = sumStats(home.faltas_cometidas, away.faltas_cometidas);
  const totalFaltasSofridas = sumStats(home.faltas_sofridas, away.faltas_sofridas);
  return {
    total_gols: sumStats(home.gols, away.gols),
    total_escanteios: sumStats(home.escanteios, away.escanteios),
    total_chutes: sumStats(home.chutes, away.chutes),
    total_chutes_no_alvo: sumStats(home.chutes_no_alvo, away.chutes_no_alvo),
    total_faltas: totalFaltasCometidas,
    total_cartoes_amarelos: sumStats(home.cartoes_amarelos, away.cartoes_amarelos),
    total_cartoes_vermelhos: sumStats(home.cartoes_vermelhos, away.cartoes_vermelhos),
    total_impedimentos: sumStats(home.impedimentos, away.impedimentos),
    gols: sumStats(home.gols, away.gols),
    assistencias: sumStats(home.assistencias, away.assistencias),
    cartoes_vermelhos: sumStats(home.cartoes_vermelhos, away.cartoes_vermelhos),
    cartoes_amarelos: sumStats(home.cartoes_amarelos, away.cartoes_amarelos),
    escanteios: sumStats(home.escanteios, away.escanteios),
    chutes: sumStats(home.chutes, away.chutes),
    chutes_no_alvo: sumStats(home.chutes_no_alvo, away.chutes_no_alvo),
    chutes_bloqueados: sumStats(home.chutes_bloqueados, away.chutes_bloqueados),
    passes: sumStats(home.passes, away.passes),
    cruzamentos: sumStats(home.cruzamentos, away.cruzamentos),
    desarmes: sumStats(home.desarmes, away.desarmes),
    impedimentos: sumStats(home.impedimentos, away.impedimentos),
    faltas_cometidas: totalFaltasCometidas,
    faltas_sofridas: totalFaltasSofridas,
    defesas: sumStats(home.defesas, away.defesas),
  };
}

function playerName(player) {
  return player.matchName || player.knownName || [player.shortFirstName, player.shortLastName].filter(Boolean).join(' ').trim() || String(player.playerId || '').trim();
}

function insertRunLog(db, { runId, liga, temporada, params }) {
  db.prepare(`
    INSERT INTO extracoes_log(run_id, job_name, source_system, source_version, liga, temporada, status, params_json)
    VALUES (?, 'extract-statsline-matchstats', 'statsline', ?, ?, ?, 'running', ?)
  `).run(runId, SOURCE_VERSION, liga ?? null, temporada ?? null, JSON.stringify(params ?? {}));
}

function finishRunLog(db, { runId, status, rowsRead, rowsWritten, rowsSkipped, warningsCount = 0, errorMessage = null, summary = {} }) {
  db.prepare(`
    UPDATE extracoes_log
       SET status = ?,
           finished_at = datetime('now'),
           rows_read = ?,
           rows_written = ?,
           rows_skipped = ?,
           warnings_count = ?,
           error_message = ?,
           summary_json = ?,
           status_certificacao = ?
     WHERE run_id = ?
  `).run(
    status,
    rowsRead,
    rowsWritten,
    rowsSkipped,
    warningsCount,
    errorMessage,
    JSON.stringify(summary),
    status === 'ok' ? 'aprovada' : status === 'partial' ? 'parcial' : 'reprovada',
    runId,
  );
}

function selectCandidateMatches(db, options = {}) {
  const where = ['status = ?'];
  const params = ['Played'];
  if (options.force !== true) where.push('processado_stats = 0');
  if (options.liga) {
    where.push('liga = ?');
    params.push(options.liga);
  }
  if (options.temporada) {
    where.push('temporada = ?');
    params.push(options.temporada);
  }
  if (options.matchId) {
    where.push('id_confronto = ?');
    params.push(options.matchId);
  }

  const limit = Number.isFinite(options.limit) && options.limit > 0 ? ' LIMIT ?' : '';
  if (limit) params.push(options.limit);
  return db.prepare(`
    SELECT *
      FROM partidas
     WHERE ${where.join(' AND ')}
     ORDER BY data_partida, hora_partida, id_confronto
     ${limit}
  `).all(...params);
}

export async function processMatchStats(db, partida, options = {}) {
  const [statsData, eventsData] = await Promise.all([
    fetchMatchStats(partida.id_confronto, options),
    fetchMatchEvents(partida.id_confronto, options),
  ]);

  const lineUp = statsData.liveData?.lineUp;
  if (!Array.isArray(lineUp) || lineUp.length < 2) throw new Error('matchstats_missing_lineup');

  const cards = statsData.liveData?.card || [];
  const contestants = statsData.matchInfo?.contestant || [];
  const homeContestant = contestants.find((item) => item.position === 'home') || contestants[0] || {};
  const awayContestant = contestants.find((item) => item.position === 'away') || contestants[1] || {};
  const homeLineup = lineUp.find((item) => item.contestantId === homeContestant.id) || lineUp[0];
  const awayLineup = lineUp.find((item) => item.contestantId === awayContestant.id) || lineUp[1];
  const homeName = resolveToOriginal(partida.home_team || homeContestant.name || homeLineup.teamName || 'Home');
  const awayName = resolveToOriginal(partida.away_team || awayContestant.name || awayLineup.teamName || 'Away');
  const events = eventsData.liveData?.event || [];

  const homeStatsFTRaw = mapTeamStats(homeLineup.stat);
  const awayStatsFTRaw = mapTeamStats(awayLineup.stat);
  homeStatsFTRaw.cartoes_vermelhos = countRedCards(cards, homeContestant.id);
  awayStatsFTRaw.cartoes_vermelhos = countRedCards(cards, awayContestant.id);

  const homeStatsHTRaw = deriveHTStats(events, homeContestant.id, awayContestant.id);
  const awayStatsHTRaw = deriveHTStats(events, awayContestant.id, homeContestant.id);
  homeStatsHTRaw.cartoes_vermelhos = countRedCards(cards, homeContestant.id, 1);
  awayStatsHTRaw.cartoes_vermelhos = countRedCards(cards, awayContestant.id, 1);
  homeStatsHTRaw.cartoes_amarelos = cards.filter((card) => card.contestantId === homeContestant.id && card.type === 'YC' && isPeriod(card, 1)).length;
  awayStatsHTRaw.cartoes_amarelos = cards.filter((card) => card.contestantId === awayContestant.id && card.type === 'YC' && isPeriod(card, 1)).length;

  const homeStatsFT = enrichTeamStats(homeStatsFTRaw, awayStatsFTRaw, 'FT');
  const awayStatsFT = enrichTeamStats(awayStatsFTRaw, homeStatsFTRaw, 'FT');
  const homeStatsHT = enrichTeamStats(homeStatsHTRaw, awayStatsHTRaw, 'HT');
  const awayStatsHT = enrichTeamStats(awayStatsHTRaw, homeStatsHTRaw, 'HT');

  const htScores = statsData.liveData?.matchDetails?.scores?.ht;
  const ftScores = statsData.liveData?.matchDetails?.scores?.ft || statsData.liveData?.matchDetails?.scores?.total;

  const upsertTime = db.prepare(`
    INSERT INTO times(
      id_confronto, liga, id_liga, temporada, confronto, time, rodada, side, modo, status,
      gols, assistencias, cartoes_vermelhos, cartoes_amarelos, escanteios,
      chutes, chutes_no_alvo, chutes_bloqueados, passes, cruzamentos,
      desarmes, impedimentos, faltas, faltas_cometidas, faltas_sofridas,
      defesas, escanteios_sofridos, chutes_sofridos, chutes_noalvo_sofridos,
      posse, passes_certos, desarmes_certos, clean_sheet,
      run_id, source_system, source_version, payload_raw, atualizado_em
    ) VALUES (
      @id_confronto, @liga, @id_liga, @temporada, @confronto, @time, @rodada, @side, @modo, @status,
      @gols, @assistencias, @cartoes_vermelhos, @cartoes_amarelos, @escanteios,
      @chutes, @chutes_no_alvo, @chutes_bloqueados, @passes, @cruzamentos,
      @desarmes, @impedimentos, @faltas, @faltas_cometidas, @faltas_sofridas,
      @defesas, @escanteios_sofridos, @chutes_sofridos, @chutes_noalvo_sofridos,
      @posse, @passes_certos, @desarmes_certos, @clean_sheet,
      @run_id, 'statsline', @source_version, @payload_raw, datetime('now')
    )
    ON CONFLICT(id_confronto, time, modo) DO UPDATE SET
      liga = excluded.liga,
      id_liga = excluded.id_liga,
      temporada = excluded.temporada,
      confronto = excluded.confronto,
      rodada = excluded.rodada,
      side = excluded.side,
      status = excluded.status,
      gols = excluded.gols,
      assistencias = excluded.assistencias,
      cartoes_vermelhos = excluded.cartoes_vermelhos,
      cartoes_amarelos = excluded.cartoes_amarelos,
      escanteios = excluded.escanteios,
      chutes = excluded.chutes,
      chutes_no_alvo = excluded.chutes_no_alvo,
      chutes_bloqueados = excluded.chutes_bloqueados,
      passes = excluded.passes,
      cruzamentos = excluded.cruzamentos,
      desarmes = excluded.desarmes,
      faltas = excluded.faltas,
      impedimentos = excluded.impedimentos,
      faltas_cometidas = excluded.faltas_cometidas,
      faltas_sofridas = excluded.faltas_sofridas,
      defesas = excluded.defesas,
      escanteios_sofridos = excluded.escanteios_sofridos,
      chutes_sofridos = excluded.chutes_sofridos,
      chutes_noalvo_sofridos = excluded.chutes_noalvo_sofridos,
      posse = excluded.posse,
      passes_certos = excluded.passes_certos,
      desarmes_certos = excluded.desarmes_certos,
      clean_sheet = excluded.clean_sheet,
      run_id = excluded.run_id,
      source_version = excluded.source_version,
      payload_raw = excluded.payload_raw,
      atualizado_em = excluded.atualizado_em
  `);
  const upsertConfronto = db.prepare(`
    INSERT INTO confronto(
      id_confronto, liga, id_liga, temporada, confronto, rodada, modo, status,
      total_gols, home_goals, away_goals, total_escanteios, total_chutes,
      total_chutes_no_alvo, total_faltas, total_cartoes_amarelos,
      total_cartoes_vermelhos, total_impedimentos,
      gols, assistencias, cartoes_vermelhos, cartoes_amarelos, escanteios,
      chutes, chutes_no_alvo, chutes_bloqueados, passes, cruzamentos,
      desarmes, impedimentos, faltas_cometidas, faltas_sofridas, defesas,
      run_id, source_system, source_version, payload_raw, atualizado_em
    ) VALUES (
      @id_confronto, @liga, @id_liga, @temporada, @confronto, @rodada, @modo, @status,
      @total_gols, @home_goals, @away_goals, @total_escanteios, @total_chutes,
      @total_chutes_no_alvo, @total_faltas, @total_cartoes_amarelos,
      @total_cartoes_vermelhos, @total_impedimentos,
      @gols, @assistencias, @cartoes_vermelhos, @cartoes_amarelos, @escanteios,
      @chutes, @chutes_no_alvo, @chutes_bloqueados, @passes, @cruzamentos,
      @desarmes, @impedimentos, @faltas_cometidas, @faltas_sofridas, @defesas,
      @run_id, 'derived', @source_version, @payload_raw, datetime('now')
    )
    ON CONFLICT(id_confronto, modo) DO UPDATE SET
      liga = excluded.liga,
      id_liga = excluded.id_liga,
      temporada = excluded.temporada,
      confronto = excluded.confronto,
      rodada = excluded.rodada,
      status = excluded.status,
      total_gols = excluded.total_gols,
      home_goals = excluded.home_goals,
      away_goals = excluded.away_goals,
      total_escanteios = excluded.total_escanteios,
      total_chutes = excluded.total_chutes,
      total_chutes_no_alvo = excluded.total_chutes_no_alvo,
      total_faltas = excluded.total_faltas,
      total_cartoes_amarelos = excluded.total_cartoes_amarelos,
      total_cartoes_vermelhos = excluded.total_cartoes_vermelhos,
      total_impedimentos = excluded.total_impedimentos,
      gols = excluded.gols,
      assistencias = excluded.assistencias,
      cartoes_vermelhos = excluded.cartoes_vermelhos,
      cartoes_amarelos = excluded.cartoes_amarelos,
      escanteios = excluded.escanteios,
      chutes = excluded.chutes,
      chutes_no_alvo = excluded.chutes_no_alvo,
      chutes_bloqueados = excluded.chutes_bloqueados,
      passes = excluded.passes,
      cruzamentos = excluded.cruzamentos,
      desarmes = excluded.desarmes,
      impedimentos = excluded.impedimentos,
      faltas_cometidas = excluded.faltas_cometidas,
      faltas_sofridas = excluded.faltas_sofridas,
      defesas = excluded.defesas,
      run_id = excluded.run_id,
      source_version = excluded.source_version,
      payload_raw = excluded.payload_raw,
      atualizado_em = excluded.atualizado_em
  `);
  const upsertPlayer = db.prepare(`
    INSERT INTO jogadores(
      id_confronto, liga, temporada, id_liga, confronto, time, jogador, rodada, modo, status,
      gols, assistencias, cartoes_vermelhos, cartoes_amarelos, escanteios,
      chutes, chutes_no_alvo, chutes_bloqueados, passes, cruzamentos,
      desarmes, impedimentos, faltas_cometidas, faltas_sofridas, defesas,
      minutos, titular, player_id, posicao, posicao_lado, formacao_posicao,
      numero_camisa, run_id, source_system, source_version, payload_raw, atualizado_em
    ) VALUES (
      @id_confronto, @liga, @temporada, @id_liga, @confronto, @time, @jogador, @rodada, 'FT', 'Played',
      @gols, @assistencias, @cartoes_vermelhos, @cartoes_amarelos, @escanteios,
      @chutes, @chutes_no_alvo, @chutes_bloqueados, @passes, @cruzamentos,
      @desarmes, @impedimentos, @faltas_cometidas, @faltas_sofridas, @defesas,
      @minutos, @titular, @player_id, @posicao, @posicao_lado, @formacao_posicao,
      @numero_camisa, @run_id, 'statsline', @source_version, @payload_raw, datetime('now')
    )
    ON CONFLICT(id_confronto, jogador, time, modo) DO UPDATE SET
      gols = excluded.gols,
      assistencias = excluded.assistencias,
      cartoes_vermelhos = excluded.cartoes_vermelhos,
      cartoes_amarelos = excluded.cartoes_amarelos,
      escanteios = excluded.escanteios,
      chutes = excluded.chutes,
      chutes_no_alvo = excluded.chutes_no_alvo,
      chutes_bloqueados = excluded.chutes_bloqueados,
      passes = excluded.passes,
      cruzamentos = excluded.cruzamentos,
      desarmes = excluded.desarmes,
      impedimentos = excluded.impedimentos,
      faltas_cometidas = excluded.faltas_cometidas,
      faltas_sofridas = excluded.faltas_sofridas,
      defesas = excluded.defesas,
      minutos = excluded.minutos,
      titular = excluded.titular,
      player_id = excluded.player_id,
      posicao = excluded.posicao,
      posicao_lado = excluded.posicao_lado,
      formacao_posicao = excluded.formacao_posicao,
      numero_camisa = excluded.numero_camisa,
      run_id = excluded.run_id,
      source_version = excluded.source_version,
      payload_raw = excluded.payload_raw,
      atualizado_em = excluded.atualizado_em
  `);
  const upsertFaixa = db.prepare(`
    INSERT INTO eventos_faixa(
      id_confronto, liga, temporada, time, side, faixa, minuto_inicio, minuto_fim,
      gols, escanteios, chutes, chutes_no_alvo, faltas, cartoes_amarelos,
      cartoes_vermelhos, impedimentos, run_id, source_system, source_version,
      payload_raw, atualizado_em
    ) VALUES (
      @id_confronto, @liga, @temporada, @time, @side, @faixa, @minuto_inicio, @minuto_fim,
      @gols, @escanteios, @chutes, @chutes_no_alvo, @faltas, @cartoes_amarelos,
      @cartoes_vermelhos, @impedimentos, @run_id, 'statsline', @source_version,
      @payload_raw, datetime('now')
    )
    ON CONFLICT(id_confronto, time, faixa) DO UPDATE SET
      liga = excluded.liga,
      temporada = excluded.temporada,
      side = excluded.side,
      minuto_inicio = excluded.minuto_inicio,
      minuto_fim = excluded.minuto_fim,
      gols = excluded.gols,
      escanteios = excluded.escanteios,
      chutes = excluded.chutes,
      chutes_no_alvo = excluded.chutes_no_alvo,
      faltas = excluded.faltas,
      cartoes_amarelos = excluded.cartoes_amarelos,
      cartoes_vermelhos = excluded.cartoes_vermelhos,
      impedimentos = excluded.impedimentos,
      run_id = excluded.run_id,
      source_version = excluded.source_version,
      payload_raw = excluded.payload_raw,
      atualizado_em = excluded.atualizado_em
  `);

  const runId = options.runId;
  const base = {
    id_confronto: partida.id_confronto,
    liga: partida.liga,
    id_liga: partida.id_liga ?? null,
    temporada: partida.temporada,
    confronto: partida.confronto ?? null,
    rodada: partida.rodada ?? null,
    status: partida.status ?? null,
    run_id: runId,
    source_version: SOURCE_VERSION,
  };
  const timeRows = [
    { ...base, time: homeName, side: 'home', modo: 'FT', ...homeStatsFT, payload_raw: safeJson(homeLineup) },
    { ...base, time: awayName, side: 'away', modo: 'FT', ...awayStatsFT, payload_raw: safeJson(awayLineup) },
    {
      ...base,
      time: homeName,
      side: 'home',
      modo: 'HT',
      ...homeStatsHT,
      payload_raw: safeJson({
        source: 'events',
        modo: 'HT',
        derived_metrics: {
          passes: 'event:type=PASS',
          passes_certos: 'event:type=PASS,outcome=1',
          posse: 'share_of_pass_events',
          desarmes: 'event:type=TACKLE',
          desarmes_certos: 'event:type=TACKLE,outcome=1',
        },
      }),
    },
    {
      ...base,
      time: awayName,
      side: 'away',
      modo: 'HT',
      ...awayStatsHT,
      payload_raw: safeJson({
        source: 'events',
        modo: 'HT',
        derived_metrics: {
          passes: 'event:type=PASS',
          passes_certos: 'event:type=PASS,outcome=1',
          posse: 'share_of_pass_events',
          desarmes: 'event:type=TACKLE',
          desarmes_certos: 'event:type=TACKLE,outcome=1',
        },
      }),
    },
  ];
  for (const row of timeRows) upsertTime.run(row);

  const totalsFT = totalStats(homeStatsFT, awayStatsFT);
  const totalsHT = totalStats(homeStatsHT, awayStatsHT);
  upsertConfronto.run({ ...base, modo: 'FT', ...totalsFT, home_goals: homeStatsFT.gols, away_goals: awayStatsFT.gols, payload_raw: safeJson({ source: 'matchstats', mode: 'FT' }) });
  upsertConfronto.run({ ...base, modo: 'HT', ...totalsHT, home_goals: homeStatsHT.gols, away_goals: awayStatsHT.gols, payload_raw: safeJson({ source: 'matchevent', mode: 'HT' }) });

  let playersWritten = 0;
  for (const [teamName, teamLineup] of [[homeName, homeLineup], [awayName, awayLineup]]) {
    for (const player of teamLineup.player || []) {
      const mapped = mapPlayerStats(player.stat);
      mapped.cartoes_vermelhos = Array.isArray(cards)
        ? cards.filter((card) => card.playerId === player.playerId && (card.type === 'RC' || card.type === 'Y2C')).length
        : 0;
      const name = playerName(player);
      if (!name) continue;
      upsertPlayer.run({
        ...base,
        id_liga: partida.id_liga,
        confronto: partida.confronto,
        time: teamName,
        jogador: name,
        rodada: partida.rodada,
        ...mapped,
        minutos: toInteger(mapped.minutos),
        titular: toInteger(mapped.titular) > 0 ? 1 : 0,
        player_id: player.playerId ? String(player.playerId) : null,
        posicao: player.position || null,
        posicao_lado: player.positionSide || null,
        formacao_posicao: player.formationPlace != null ? String(player.formationPlace) : null,
        numero_camisa: player.shirtNumber != null ? toInteger(player.shirtNumber) : null,
        payload_raw: safeJson(player),
      });
      playersWritten++;
    }
  }

  let faixasWritten = 0;
  for (const [teamName, side, contestantId] of [[homeName, 'home', homeContestant.id], [awayName, 'away', awayContestant.id]]) {
    for (const faixa of deriveFaixas(events, contestantId)) {
      upsertFaixa.run({
        ...base,
        time: teamName,
        side,
        ...faixa,
        payload_raw: safeJson({ contestantId, faixa: faixa.faixa }),
      });
      faixasWritten++;
    }
  }

  db.prepare(`
    UPDATE partidas
       SET home_goals = COALESCE(?, home_goals),
           away_goals = COALESCE(?, away_goals),
           home_goals_ht = COALESCE(?, home_goals_ht),
           away_goals_ht = COALESCE(?, away_goals_ht),
           formacao_casa = COALESCE(?, formacao_casa),
           formacao_fora = COALESCE(?, formacao_fora),
           processado = 1,
           processado_stats = 1,
           run_id = ?,
           source_version = ?,
           atualizado_em = datetime('now')
     WHERE id_confronto = ?
  `).run(
    ftScores?.home != null ? toInteger(ftScores.home) : null,
    ftScores?.away != null ? toInteger(ftScores.away) : null,
    htScores?.home != null ? toInteger(htScores.home) : null,
    htScores?.away != null ? toInteger(htScores.away) : null,
    homeLineup.formationUsed || null,
    awayLineup.formationUsed || null,
    runId,
    SOURCE_VERSION,
    partida.id_confronto,
  );

  return {
    match_id: partida.id_confronto,
    times_written: timeRows.length,
    confronto_written: 2,
    jogadores_written: playersWritten,
    eventos_faixa_written: faixasWritten,
  };
}

export async function extractStatslineMatchstats(options = {}) {
  const dbPath = resolveExtractionDbPath(options.dbPath);
  applyExtractionMigrations({ dbPath });
  const db = openExtractionDb(dbPath);
  const runId = options.runId ?? `statsline-matchstats-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const candidates = selectCandidateMatches(db, options);
  const summary = {
    run_id: options.dryRun === true ? null : runId,
    dry_run: options.dryRun === true,
    liga: options.liga ?? null,
    temporada: options.temporada ?? null,
    candidates: candidates.length,
    processed: 0,
    failed: 0,
    times_written: 0,
    confronto_written: 0,
    jogadores_written: 0,
    eventos_faixa_written: 0,
    affected_league_seasons: [],
    failures: [],
    successes: [],
  };

  if (options.dryRun === true) {
    db.close();
    return summary;
  }

  insertRunLog(db, { runId, liga: options.liga, temporada: options.temporada, params: options });
  const concurrency = resolveConcurrency(options);
  const affected = new Map();
  const markAffected = (partida) => {
    if (!partida?.liga || !partida?.temporada) return;
    const key = `${partida.liga}\u0000${partida.temporada}`;
    const row = affected.get(key) ?? { liga: partida.liga, temporada: partida.temporada, processed: 0 };
    row.processed += 1;
    affected.set(key, row);
  };
  const flushAffected = () => {
    summary.affected_league_seasons = [...affected.values()]
      .sort((a, b) => `${a.liga}\u0000${a.temporada}`.localeCompare(`${b.liga}\u0000${b.temporada}`));
  };
  const progressEvery = Number.isFinite(options.progressEvery) && options.progressEvery > 0
    ? options.progressEvery
    : Math.max(25, Math.floor(candidates.length / 50) || 25);
  const startedAt = Date.now();
  let cursor = 0;
  let completed = 0;
  const total = candidates.length;
  const logProgress = (force = false) => {
    if (!force && completed % progressEvery !== 0) return;
    if (options.json) return;
    const elapsedMs = Date.now() - startedAt;
    const rate = completed > 0 ? (completed / (elapsedMs / 1000)).toFixed(2) : '0.00';
    const remaining = total - completed;
    const etaSec = completed > 0 ? Math.round((elapsedMs / completed) * remaining / 1000) : null;
    console.log(`[extract-statsline-matchstats] progress=${completed}/${total} ok=${summary.processed} fail=${summary.failed} rate=${rate}/s eta=${etaSec ?? '?'}s concurrency=${concurrency}`);
  };
  try {
    const runWorker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= total) return;
        const partida = candidates[index];
        try {
          const result = await processMatchStats(db, partida, { ...options, runId });
          summary.processed++;
          summary.times_written += result.times_written;
          summary.confronto_written += result.confronto_written;
          summary.jogadores_written += result.jogadores_written;
          summary.eventos_faixa_written += result.eventos_faixa_written;
          markAffected(partida);
          summary.successes.push({
            id_confronto: partida.id_confronto,
            confronto: partida.confronto || `${partida.home_team} x ${partida.away_team}`,
            data: partida.data_brasil || partida.data_partida,
            liga: partida.liga,
          });
        } catch (err) {
          summary.failed++;
          summary.failures.push({
            id_confronto: partida.id_confronto,
            confronto: partida.confronto || `${partida.home_team} x ${partida.away_team}`,
            data: partida.data_brasil || partida.data_partida,
            liga: partida.liga,
            error: err.message,
          });
        } finally {
          completed++;
          logProgress(false);
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, total) }, () => runWorker());
    await Promise.all(workers);
    logProgress(true);
    flushAffected();

    const status = summary.failed > 0 ? (summary.processed > 0 ? 'partial' : 'failed') : 'ok';
    finishRunLog(db, {
      runId,
      status,
      rowsRead: candidates.length,
      rowsWritten: summary.processed,
      rowsSkipped: summary.failed,
      warningsCount: summary.failed,
      summary,
    });
    return summary;
  } catch (err) {
    flushAffected();
    finishRunLog(db, {
      runId,
      status: 'failed',
      rowsRead: candidates.length,
      rowsWritten: summary.processed,
      rowsSkipped: summary.failed,
      warningsCount: summary.failed,
      errorMessage: err.message,
      summary,
    });
    throw err;
  } finally {
    db.close();
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.all && !args.liga && !args.matchId) throw new Error('missing_required_args:liga_or_all_or_match_id');

  const summary = await extractStatslineMatchstats(args);
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`[extract-statsline-matchstats] liga=${summary.liga ?? '*'} temporada=${summary.temporada ?? '*'} dry_run=${summary.dry_run}`);
    console.log(`[extract-statsline-matchstats] candidates=${summary.candidates} processed=${summary.processed} failed=${summary.failed} times=${summary.times_written} confronto=${summary.confronto_written} jogadores=${summary.jogadores_written} eventos_faixa=${summary.eventos_faixa_written}`);
    if (summary.successes?.length > 0) {
      console.log('');
      for (const s of summary.successes) {
        console.log(`[extract-statsline-matchstats]  OK  ${s.confronto} (${s.data}) [${s.liga}]`);
      }
    }
    if (summary.failures.length > 0) {
      console.log('');
      for (const f of summary.failures) {
        const name = f.confronto || f.id_confronto;
        console.log(`[extract-statsline-matchstats]  NOK ${name} (${f.data || '?'}) [${f.liga || '?'}] -> ${f.error}`);
      }
    }
  }
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[extract-statsline-matchstats] fatal: ${err.message}`);
    process.exitCode = 1;
  });
}
