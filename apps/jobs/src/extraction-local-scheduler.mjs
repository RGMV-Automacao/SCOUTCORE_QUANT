import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractStatslineScheduleAll } from './extract-statsline-schedule.mjs';
import { extractStatslineMatchstats } from './extract-statsline-matchstats.mjs';
import { extractBooklineOdds } from './extract-bookline-odds.mjs';

const DEFAULT_INTERVAL_MIN = 60;
const DEFAULT_STATS_LIMIT_PER_TICK = 50;
const DEFAULT_ODDS_LIMIT_PER_TICK = 25;
// Janela default: hoje + 3 dias (4 dias inclusivos), espelhando o legado bookline.
// Mantida pequena para evitar carregar a base com partidas distantes que ainda nao tem mercado.
const DEFAULT_ODDS_WINDOW_DAYS = 4;
// Cap rigido: nenhuma extracao live pode pedir janela maior que 4 dias.
const MAX_ODDS_WINDOW_DAYS = 4;

export function parseSchedulerArgs(argv = process.argv.slice(2), env = process.env) {
  const out = {
    dryRun: false,
    once: false,
    noImmediate: false,
    intervalMin: Number.parseFloat(env.SCOUT_EXTRACTION_SCHEDULE_INTERVAL_MIN || env.STATSLINE_SCHEDULE_INTERVAL_MIN || DEFAULT_INTERVAL_MIN),
    statsLimit: Number.parseInt(env.SCOUT_EXTRACTION_STATS_LIMIT_PER_TICK || DEFAULT_STATS_LIMIT_PER_TICK, 10),
    oddsLimit: Number.parseInt(env.SCOUT_EXTRACTION_ODDS_LIMIT_PER_TICK || DEFAULT_ODDS_LIMIT_PER_TICK, 10),
    oddsConcurrency: Number.parseInt(env.SCOUT_BOOKLINE_FETCH_CONCURRENCY || '6', 10),
    oddsWindowDays: Number.parseInt(env.SCOUT_EXTRACTION_ODDS_WINDOW_DAYS || DEFAULT_ODDS_WINDOW_DAYS, 10),
    noOdds: String(env.SCOUT_EXTRACTION_ODDS_ENABLED || 'true').toLowerCase() === 'false',
    profileRebuild: String(env.SCOUT_EXTRACTION_REBUILD_PROFILES_ENABLED || 'true').toLowerCase() !== 'false',
  };

  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--once') out.once = true;
    else if (arg === '--no-immediate') out.noImmediate = true;
    else if (arg === '--json') out.json = true;
    else if (arg.startsWith('--interval-min=')) out.intervalMin = Number.parseFloat(arg.slice(15));
    else if (arg.startsWith('--stats-limit=')) out.statsLimit = Number.parseInt(arg.slice(14), 10);
    else if (arg === '--schedule-only') out.scheduleOnly = true;
    else if (arg === '--stats-only') out.statsOnly = true;
    else if (arg === '--odds-only') out.oddsOnly = true;
    else if (arg === '--profiles-only') out.profilesOnly = true;
    else if (arg === '--profiles-all') out.profileAll = true;
    else if (arg === '--no-profiles') out.profileRebuild = false;
    else if (arg === '--no-odds') out.noOdds = true;
    else if (arg.startsWith('--liga=')) out.liga = arg.slice(7);
    else if (arg.startsWith('--temporada=')) out.temporada = arg.slice(12);
    else if (arg.startsWith('--odds-limit=')) out.oddsLimit = Number.parseInt(arg.slice(13), 10);
    else if (arg.startsWith('--odds-concurrency=')) out.oddsConcurrency = Number.parseInt(arg.slice(19), 10);
    else if (arg.startsWith('--odds-window-days=')) out.oddsWindowDays = Number.parseInt(arg.slice(19), 10);
    else if (arg.startsWith('--odds-date=')) out.oddsDate = arg.slice(12);
    else if (arg.startsWith('--odds-from=')) out.oddsFrom = arg.slice(12);
    else if (arg.startsWith('--odds-to=')) out.oddsTo = arg.slice(10);
    else if (arg.startsWith('--db=')) out.dbPath = arg.slice(5);
    else if (arg === '--help' || arg === '-h') out.help = true;
  }

  if (!Number.isFinite(out.intervalMin) || out.intervalMin <= 0) out.intervalMin = DEFAULT_INTERVAL_MIN;
  if (!Number.isFinite(out.statsLimit) || out.statsLimit <= 0) out.statsLimit = DEFAULT_STATS_LIMIT_PER_TICK;
  if (!Number.isFinite(out.oddsLimit) || out.oddsLimit <= 0) out.oddsLimit = DEFAULT_ODDS_LIMIT_PER_TICK;
  if (!Number.isFinite(out.oddsConcurrency) || out.oddsConcurrency <= 0) out.oddsConcurrency = 6;
  if (!Number.isFinite(out.oddsWindowDays) || out.oddsWindowDays <= 0) out.oddsWindowDays = DEFAULT_ODDS_WINDOW_DAYS;
  if (out.oddsWindowDays > MAX_ODDS_WINDOW_DAYS) {
    console.warn(`[scheduler] oddsWindowDays=${out.oddsWindowDays} excede cap ${MAX_ODDS_WINDOW_DAYS}; aplicando MAX_ODDS_WINDOW_DAYS.`);
    out.oddsWindowDays = MAX_ODDS_WINDOW_DAYS;
  }
  return out;
}

function printHelp() {
  console.log('Uso: node apps/jobs/src/extraction-local-scheduler.mjs [--interval-min=60] [--stats-limit=50] [--odds-limit=25] [--odds-concurrency=6] [--odds-window-days=4] [--schedule-only|--stats-only|--odds-only|--profiles-only|--no-odds|--no-profiles] [--no-immediate] [--once] [--dry-run] [--liga=brasileirao]');
}

function formatLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysISO(dateISO, days) {
  const [year, month, day] = dateISO.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return formatLocalISODate(date);
}

function logScheduleSummary(prefix, summary) {
  console.log(`${prefix} targets=${summary.target_count} ok=${summary.ok} failed=${summary.failed} fetched=${summary.fetched} parsed=${summary.parsed} skipped=${summary.skipped} written=${summary.written}`);
  for (const failure of summary.results.filter((item) => item.status === 'failed')) {
    console.log(`${prefix} fail liga=${failure.liga} temporada=${failure.temporada} error=${failure.error}`);
  }
}

function logStatsSummary(prefix, summary) {
  console.log(`${prefix} stats_candidates=${summary.candidates} stats_processed=${summary.processed} stats_failed=${summary.failed} times=${summary.times_written} confronto=${summary.confronto_written} jogadores=${summary.jogadores_written} eventos_faixa=${summary.eventos_faixa_written}`);
  for (const target of summary.affected_league_seasons ?? []) {
    console.log(`${prefix} stats_affected liga=${target.liga} temporada=${target.temporada} processed=${target.processed}`);
  }
  for (const failure of summary.failures.slice(0, 10)) {
    console.log(`${prefix} stats_fail id=${failure.id_confronto} error=${failure.error}`);
  }
}

function logProfileSummary(prefix, summary) {
  if (!summary) return;
  if (summary.skipped) {
    console.log(`${prefix} profile_rebuild skipped=${summary.reason}`);
    return;
  }
  if (summary.mode === 'all') {
    console.log(`${prefix} profile_rebuild mode=all exit_code=${summary.exit_code}`);
    return;
  }
  console.log(`${prefix} profile_rebuild mode=targeted targets=${summary.targets.length} team_profile_ok=${summary.team_profile_ok} team_profile_err=${summary.team_profile_err} league_priors_ok=${summary.league_priors_ok} league_priors_err=${summary.league_priors_err}`);
}

function logOddsSummary(prefix, summary) {
  console.log(`${prefix} odds_matches=${summary.matches_checked} odds_events=${summary.events_matched} odds_failed=${summary.failed_matches} odds_written=${summary.odds_written} history=${summary.history_rows_written} raw_keys=${summary.raw_market_keys} cert=${summary.certification?.status ?? 'nao_avaliada'}`);
  for (const failure of summary.failures.slice(0, 10)) {
    console.log(`${prefix} odds_fail id=${failure.id_confronto} reason=${failure.reason}${failure.error ? ` error=${failure.error}` : ''}`);
  }
}

function buildOddsOptions(options) {
  const from = options.oddsFrom || options.oddsDate || formatLocalISODate(new Date());
  const to = options.oddsTo || options.oddsDate || addDaysISO(from, options.oddsWindowDays - 1);
  return {
    dbPath: options.dbPath,
    dryRun: options.dryRun,
    liga: options.liga,
    from,
    to,
    limit: options.oddsLimit,
    concurrency: options.oddsConcurrency,
  };
}

export function getProfileRebuildTargets(statsSummary, options = {}) {
  const targets = new Map();
  for (const item of statsSummary?.affected_league_seasons ?? []) {
    if (!item?.liga || !item?.temporada) continue;
    targets.set(`${item.liga}\u0000${item.temporada}`, { liga: item.liga, temporada: item.temporada });
  }
  if (targets.size === 0 && statsSummary?.processed > 0 && options.liga && options.temporada) {
    targets.set(`${options.liga}\u0000${options.temporada}`, { liga: options.liga, temporada: options.temporada });
  }
  return [...targets.values()].sort((a, b) => `${a.liga}\u0000${a.temporada}`.localeCompare(`${b.liga}\u0000${b.temporada}`));
}

function targetArgs(script, target) {
  return [script, `--liga=${target.liga}`, `--temporada=${target.temporada}`];
}

export function runProfileRebuild({ targets = null, dbPath = null, env = process.env, spawnImpl = spawnSync } = {}) {
  const childEnv = { ...env };
  if (dbPath) childEnv.SCOUT_DB = dbPath;
  if (!childEnv.SCOUT_DB) childEnv.SCOUT_DB = 'data/scout_extraction.db';

  if (targets == null) {
    const result = spawnImpl(process.execPath, ['scripts/rebuild-all-leagues.mjs'], { env: childEnv, stdio: 'inherit' });
    const exitCode = result.status ?? 1;
    return { mode: 'all', exit_code: exitCode };
  }
  if (targets.length === 0) {
    return { skipped: true, reason: 'no_affected_league_season' };
  }

  const out = {
    mode: 'targeted',
    targets,
    team_profile_ok: 0,
    team_profile_err: 0,
    league_priors_ok: 0,
    league_priors_err: 0,
  };
  for (const target of targets) {
    const tp = spawnImpl(process.execPath, targetArgs('apps/jobs/src/rebuild-team-profiles.mjs', target), { env: childEnv, stdio: 'inherit' });
    if (tp.status === 0) out.team_profile_ok += 1; else out.team_profile_err += 1;
    const lp = spawnImpl(process.execPath, targetArgs('apps/jobs/src/rebuild-league-priors.mjs', target), { env: childEnv, stdio: 'inherit' });
    if (lp.status === 0) out.league_priors_ok += 1; else out.league_priors_err += 1;
  }
  out.exit_code = out.team_profile_err > 0 || out.league_priors_err > 0 ? 1 : 0;
  return out;
}

export async function runSchedulerTick(options = {}) {
  const startedAt = new Date();
  console.log(`[extraction:scheduler] tick_start=${startedAt.toISOString()} dry_run=${options.dryRun === true}`);
  const summary = { schedule: null, stats: null, profile_rebuild: null, odds: null };
  const shouldRebuildProfiles = options.profileRebuild !== false && options.dryRun !== true;

  if (options.profilesOnly === true) {
    if (!shouldRebuildProfiles) {
      summary.profile_rebuild = { skipped: true, reason: options.dryRun === true ? 'dry_run' : 'profile_rebuild_disabled' };
    } else {
      const targets = options.liga && options.temporada ? [{ liga: options.liga, temporada: options.temporada }] : null;
      summary.profile_rebuild = runProfileRebuild({ targets, dbPath: options.dbPath });
    }
    logProfileSummary('[extraction:scheduler]', summary.profile_rebuild);
    console.log(`[extraction:scheduler] tick_end=${new Date().toISOString()} duration_ms=${Date.now() - startedAt.getTime()}`);
    return summary;
  }

  if (options.statsOnly !== true && options.oddsOnly !== true) {
    summary.schedule = await extractStatslineScheduleAll(options);
    logScheduleSummary('[extraction:scheduler]', summary.schedule);
  }
  if (options.scheduleOnly !== true && options.oddsOnly !== true) {
    summary.stats = await extractStatslineMatchstats({
      ...options,
      limit: options.statsLimit,
      all: true,
    });
    logStatsSummary('[extraction:scheduler]', summary.stats);
  }
  if (shouldRebuildProfiles && summary.stats?.processed > 0) {
    const targets = options.profileAll === true ? null : getProfileRebuildTargets(summary.stats, options);
    summary.profile_rebuild = runProfileRebuild({ targets, dbPath: options.dbPath });
    logProfileSummary('[extraction:scheduler]', summary.profile_rebuild);
  }
  if (options.scheduleOnly !== true && options.statsOnly !== true && options.noOdds !== true) {
    summary.odds = await extractBooklineOdds(buildOddsOptions(options));
    logOddsSummary('[extraction:scheduler]', summary.odds);
  }
  console.log(`[extraction:scheduler] tick_end=${new Date().toISOString()} duration_ms=${Date.now() - startedAt.getTime()}`);
  return summary;
}

async function main() {
  const args = parseSchedulerArgs();
  if (args.help) {
    printHelp();
    return;
  }

  let running = false;
  const run = async () => {
    if (running) {
      console.log('[extraction:scheduler] previous_tick_still_running skipped=true');
      return null;
    }
    running = true;
    try {
      return await runSchedulerTick(args);
    } finally {
      running = false;
    }
  };

  if (!args.noImmediate || args.once) {
    const summary = await run();
    if (args.once) {
      if (args.json) console.log(JSON.stringify(summary, null, 2));
      const oddsFailed = summary?.odds && summary.odds.failed_matches > 0 && summary.odds.events_matched === 0;
      const profileFailed = summary?.profile_rebuild?.exit_code > 0;
      process.exitCode = (summary?.schedule?.failed > 0 || summary?.stats?.failed > 0 || oddsFailed || profileFailed) ? 1 : 0;
      return;
    }
  }

  const intervalMs = Math.max(1, args.intervalMin) * 60 * 1000;
  console.log(`[extraction:scheduler] running interval_min=${args.intervalMin} no_immediate=${args.noImmediate}`);
  setInterval(() => {
    run().catch((err) => {
      console.error(`[extraction:scheduler] tick_fatal=${err.message}`);
    });
  }, intervalMs);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[extraction:scheduler] fatal=${err.message}`);
    process.exitCode = 1;
  });
}
