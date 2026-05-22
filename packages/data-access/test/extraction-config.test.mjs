import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditExtractionConfig,
  extractTmclFromUrl,
  getConfiguredSeasonUrl,
  listExtractionSeasons,
  loadExtractionLeaguesConfig,
} from '../../../scripts/lib/extraction-config.mjs';

test('extraction league matrix matches certified legacy scope', () => {
  const audit = auditExtractionConfig();
  assert.equal(audit.ok, true);
  assert.equal(audit.counts.leagues, 13);
  assert.equal(audit.counts.seasons, 41);
  assert.equal(audit.summary.failed, 0);
});

test('extraction season resolver prefers codenamed env and falls back to legacy env', () => {
  const config = loadExtractionLeaguesConfig();
  const env = {
    API_URL_BRASILEIRAO_2026: 'https://example.test/feed?_rt=c&tmcl=legacy2026',
    STATSLINE_URL_BRASILEIRAO_2026: 'https://example.test/feed?_rt=c&tmcl=primary2026',
    API_URL_BRASILEIRAO_2025: 'https://example.test/feed?_rt=c&tmcl=unused',
    API_URL_BRASILEIRAO: 'https://example.test/feed?_rt=c&tmcl=legacy2025',
  };

  assert.equal(
    getConfiguredSeasonUrl('brasileirao', '2026', env, config),
    'https://example.test/feed?_rt=c&tmcl=primary2026',
  );
  assert.equal(
    getConfiguredSeasonUrl('brasileirao', '2025', env, config),
    'https://example.test/feed?_rt=c&tmcl=legacy2025',
  );
  assert.equal(getConfiguredSeasonUrl('brasileirao', '1900', env, config), null);
});

test('extraction config keeps all season identities unique', () => {
  const seasons = listExtractionSeasons();
  const seasonKeys = new Set(seasons.map((season) => `${season.league_id}:${season.season_label}`));
  const envKeys = new Set(seasons.map((season) => season.env_key));
  const legacyEnvKeys = new Set(seasons.map((season) => season.legacy_env_key));

  assert.equal(seasonKeys.size, 41);
  assert.equal(envKeys.size, 41);
  assert.equal(legacyEnvKeys.size, 41);
});

test('extraction config can disregard documented inactive seasons when env is required', () => {
  const config = loadExtractionLeaguesConfig();
  const env = Object.fromEntries(
    listExtractionSeasons(config)
      .filter((season) => season.enabled)
      .map((season) => [season.env_key, `https://example.test/feed?_rt=c&tmcl=${season.env_key.toLowerCase()}`]),
  );

  const audit = auditExtractionConfig({ env, configPath: config._path, requireEnv: true });
  assert.equal(audit.ok, true);
  assert.equal(audit.summary.failed, 0);
});

test('tmcl extractor accepts URL objects and raw strings', () => {
  assert.equal(extractTmclFromUrl('https://example.test/path?_rt=c&tmcl=abc123'), 'abc123');
  assert.equal(extractTmclFromUrl('not a url?tmcl=raw456&x=1'), 'raw456');
  assert.equal(extractTmclFromUrl('https://example.test/path?_rt=c'), null);
});
