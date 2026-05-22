import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProfileRebuildTargets,
  parseSchedulerArgs,
  runSchedulerTick,
  runProfileRebuild,
} from '../src/extraction-local-scheduler.mjs';

test('parseSchedulerArgs habilita rebuild de profiles por default e aceita flags', () => {
  const defaults = parseSchedulerArgs([], {});
  assert.equal(defaults.profileRebuild, true);
  assert.equal(defaults.profilesOnly, undefined);

  const disabled = parseSchedulerArgs(['--no-profiles'], {});
  assert.equal(disabled.profileRebuild, false);

  const profilesOnly = parseSchedulerArgs(['--profiles-only', '--liga=brasileirao', '--temporada=2026'], {});
  assert.equal(profilesOnly.profilesOnly, true);
  assert.equal(profilesOnly.profileRebuild, true);
  assert.equal(profilesOnly.liga, 'brasileirao');
  assert.equal(profilesOnly.temporada, '2026');
});

test('getProfileRebuildTargets deduplica ligas afetadas pelo matchstats', () => {
  const targets = getProfileRebuildTargets({
    processed: 3,
    affected_league_seasons: [
      { liga: 'premier-league', temporada: '2025/2026', processed: 2 },
      { liga: 'brasileirao', temporada: '2026', processed: 1 },
      { liga: 'premier-league', temporada: '2025/2026', processed: 1 },
    ],
  });
  assert.deepEqual(targets, [
    { liga: 'brasileirao', temporada: '2026' },
    { liga: 'premier-league', temporada: '2025/2026' },
  ]);
});

test('runProfileRebuild executa team_profile_v2 e league_priors para cada alvo', () => {
  const calls = [];
  const summary = runProfileRebuild({
    dbPath: 'custom.db',
    targets: [{ liga: 'brasileirao', temporada: '2026' }],
    spawnImpl(command, args, options) {
      calls.push({ command, args, scoutDb: options.env.SCOUT_DB });
      return { status: 0 };
    },
  });

  assert.equal(summary.exit_code, 0);
  assert.equal(summary.team_profile_ok, 1);
  assert.equal(summary.league_priors_ok, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0], 'apps/jobs/src/rebuild-team-profiles.mjs');
  assert.equal(calls[1].args[0], 'apps/jobs/src/rebuild-league-priors.mjs');
  assert.equal(calls.every((call) => call.scoutDb === 'custom.db'), true);
});

test('runProfileRebuild sem alvos roda rebuild-all-leagues', () => {
  const calls = [];
  const summary = runProfileRebuild({
    targets: null,
    spawnImpl(command, args) {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.equal(summary.mode, 'all');
  assert.equal(summary.exit_code, 0);
  assert.deepEqual(calls.map((call) => call.args[0]), ['scripts/rebuild-all-leagues.mjs']);
});

test('runSchedulerTick profiles-only respeita dry-run', async () => {
  const summary = await runSchedulerTick({ profilesOnly: true, dryRun: true });
  assert.deepEqual(summary.profile_rebuild, { skipped: true, reason: 'dry_run' });
});