import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_EXTRACTION_LEAGUES_CONFIG = 'config/extraction-leagues.json';

function resolveConfigPath(configPath = DEFAULT_EXTRACTION_LEAGUES_CONFIG) {
  return isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
}

export function loadExtractionLeaguesConfig(configPath = DEFAULT_EXTRACTION_LEAGUES_CONFIG) {
  const resolvedPath = resolveConfigPath(configPath);
  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  return { ...parsed, _path: resolvedPath };
}

export function listExtractionLeagues(config = loadExtractionLeaguesConfig()) {
  return config.leagues.map((league) => ({
    id: league.id,
    name: league.name,
    country: league.country,
    seasons: league.seasons.map((season) => ({ ...season })),
  }));
}

export function listExtractionSeasons(config = loadExtractionLeaguesConfig()) {
  return config.leagues.flatMap((league) => league.seasons.map((season) => ({
    league_id: league.id,
    league_name: league.name,
    country: league.country,
    season_label: season.label,
    env_key: season.env_key,
    legacy_env_key: season.legacy_env_key,
    enabled: season.enabled !== false,
    ignore_reason: season.ignore_reason ?? null,
  })));
}

function isSeasonEnabled(season) {
  return season.enabled !== false;
}

export function getExtractionSeason(leagueId, seasonLabel, config = loadExtractionLeaguesConfig()) {
  const league = config.leagues.find((item) => item.id === leagueId);
  if (!league) return null;
  const season = league.seasons.find((item) => item.label === seasonLabel);
  if (!season) return null;
  return { league, season };
}

export function getConfiguredSeasonUrl(leagueId, seasonLabel, env = process.env, config = loadExtractionLeaguesConfig()) {
  const found = getExtractionSeason(leagueId, seasonLabel, config);
  if (!found) return null;
  const { season } = found;
  return env[season.env_key] || env[season.legacy_env_key] || null;
}

export function extractTmclFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('tmcl') || null;
  } catch {
    const match = String(url).match(/[?&]tmcl=([a-z0-9]+)/i);
    return match ? match[1] : null;
  }
}

function addCheck(checks, name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
}

export function auditExtractionConfig(options = {}) {
  const config = loadExtractionLeaguesConfig(options.configPath);
  const checks = [];
  const leagues = Array.isArray(config.leagues) ? config.leagues : [];
  const expected = config.expected ?? {};
  const seasons = listExtractionSeasons(config);

  addCheck(checks, 'config.version', typeof config.version === 'string' && config.version.length > 0);
  addCheck(checks, 'leagues.array', Array.isArray(config.leagues));
  addCheck(checks, 'total_leagues', leagues.length === expected.total_leagues, `actual=${leagues.length} expected=${expected.total_leagues}`);
  addCheck(checks, 'total_seasons', seasons.length === expected.total_seasons, `actual=${seasons.length} expected=${expected.total_seasons}`);

  const leagueIds = new Set();
  const seasonKeys = new Set();
  const envKeys = new Set();
  const legacyEnvKeys = new Set();

  for (const league of leagues) {
    addCheck(checks, `league:${league.id}:id`, /^[a-z0-9-]+$/.test(league.id ?? ''), league.id);
    addCheck(checks, `league:${league.id}:unique`, !leagueIds.has(league.id), league.id);
    leagueIds.add(league.id);
    addCheck(checks, `league:${league.id}:name`, typeof league.name === 'string' && league.name.length > 0);
    addCheck(checks, `league:${league.id}:country`, typeof league.country === 'string' && league.country.length > 0);
    addCheck(checks, `league:${league.id}:seasons_array`, Array.isArray(league.seasons) && league.seasons.length > 0);

    const expectedCount = expected.seasons_by_league?.[league.id];
    addCheck(checks, `league:${league.id}:season_count`, league.seasons.length === expectedCount, `actual=${league.seasons.length} expected=${expectedCount}`);

    for (const season of league.seasons) {
      const seasonKey = `${league.id}:${season.label}`;
      addCheck(checks, `season:${seasonKey}:label`, /^\d{4}(\/\d{4})?$/.test(season.label ?? ''), season.label);
      addCheck(checks, `season:${seasonKey}:unique`, !seasonKeys.has(seasonKey), seasonKey);
      seasonKeys.add(seasonKey);

      addCheck(checks, `season:${seasonKey}:env_key`, /^STATSLINE_URL_[A-Z0-9_]+$/.test(season.env_key ?? ''), season.env_key);
      addCheck(checks, `season:${seasonKey}:env_key_unique`, !envKeys.has(season.env_key), season.env_key);
      envKeys.add(season.env_key);

      addCheck(checks, `season:${seasonKey}:legacy_env_key`, /^API_URL_[A-Z0-9_]+$/.test(season.legacy_env_key ?? ''), season.legacy_env_key);
      addCheck(checks, `season:${seasonKey}:legacy_env_key_unique`, !legacyEnvKeys.has(season.legacy_env_key), season.legacy_env_key);
      legacyEnvKeys.add(season.legacy_env_key);

      if (!isSeasonEnabled(season)) {
        addCheck(checks, `season:${seasonKey}:ignore_reason`, typeof season.ignore_reason === 'string' && season.ignore_reason.length > 0);
      }

      if (options.requireEnv === true && isSeasonEnabled(season)) {
        const configuredUrl = getConfiguredSeasonUrl(league.id, season.label, options.env ?? process.env, config);
        const tmcl = extractTmclFromUrl(configuredUrl);
        addCheck(checks, `season:${seasonKey}:configured_url`, typeof configuredUrl === 'string' && configuredUrl.length > 0);
        addCheck(checks, `season:${seasonKey}:tmcl`, typeof tmcl === 'string' && tmcl.length > 0);
      }
    }
  }

  for (const leagueId of Object.keys(expected.seasons_by_league ?? {})) {
    addCheck(checks, `expected_league:${leagueId}:present`, leagueIds.has(leagueId));
  }

  return {
    ok: checks.every((check) => check.ok),
    configPath: config._path,
    requireEnv: options.requireEnv === true,
    counts: {
      leagues: leagues.length,
      seasons: seasons.length,
    },
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.ok).length,
      failed: checks.filter((check) => !check.ok).length,
    },
  };
}
