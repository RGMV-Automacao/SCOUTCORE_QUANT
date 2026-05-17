// Scheduler in-process. Roda jobs como subprocessos do Node (spawn).
// Sem dependência externa — usa setInterval.
//
// Controlado pela env SCHEDULER_ENABLED=true.
//
// Dois tipos de schedule:
//   - cron-like horário fixo: { hour, minute, dow?, dom? }
//   - interval simples:       { intervalMin } — roda a cada N minutos a partir do boot.
//
// Jobs:
//   settle-results:         diário às 06:00  (resolve resultados D-1)
//   rebuild-team-profiles:  semanal segunda 04:00
//   rebuild-league-priors:  semanal segunda 04:30
//   refit-isotonic:         mensal dia 1 às 05:00
//   fetch-superbet-odds:    a cada SUPERBET_FETCH_INTERVAL_MIN minutos (default 10),
//                           gated por SUPERBET_FETCH_ENABLED=true.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const SUPERBET_INTERVAL = Math.max(1, Number(process.env.SUPERBET_FETCH_INTERVAL_MIN || 10));

const JOBS = [
  {
    name: 'settle-results',
    script: 'apps/jobs/src/settle-results.mjs',
    args: () => [`--date=${yesterdayISO()}`],
    hour: 6, minute: 0, dow: null, dom: null,
  },
  {
    name: 'rebuild-team-profiles',
    script: 'apps/jobs/src/rebuild-team-profiles.mjs',
    args: () => [],
    hour: 4, minute: 0, dow: 1, dom: null,
  },
  {
    name: 'rebuild-league-priors',
    script: 'apps/jobs/src/rebuild-league-priors.mjs',
    args: () => [],
    hour: 4, minute: 30, dow: 1, dom: null,
  },
  {
    name: 'refit-isotonic',
    script: 'apps/jobs/src/refit-isotonic.mjs',
    args: () => [],
    hour: 5, minute: 0, dow: null, dom: 1,
  },
  {
    name: 'fetch-superbet-odds',
    script: 'apps/jobs/src/fetch-superbet-odds.mjs',
    args: () => [`--date=${todayISO()}`],
    intervalMin: SUPERBET_INTERVAL,
    enabled: () => process.env.SUPERBET_FETCH_ENABLED === 'true',
  },
];

function todayISO()     { return new Date().toISOString().slice(0, 10); }
function yesterdayISO() { return new Date(Date.now() - 86400000).toISOString().slice(0, 10); }

function fireKey(job, now) {
  return `${job.name}:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${job.hour}-${job.minute}`;
}

function shouldFireCron(job, now) {
  if (now.getHours() !== job.hour) return false;
  if (now.getMinutes() !== job.minute) return false;
  if (job.dow != null && now.getDay() !== job.dow) return false;
  if (job.dom != null && now.getDate() !== job.dom) return false;
  return true;
}

import Database from 'better-sqlite3';
import { settleTickets } from './routes/settle-tickets.mjs';

function spawnJob(job, log) {
  const args = job.args();
  log.info?.({ job: job.name, args }, '[scheduler] firing');
  const child = spawn(process.execPath, [resolve(process.cwd(), job.script), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    log.info?.({ job: job.name, code }, '[scheduler] finished');
    if (job.name === 'settle-results' && code === 0) {
      try {
        const dbPath = process.env.SCOUT_DB || resolve(process.cwd(), 'data', 'scout.db');
        const db = new Database(dbPath);
        const ticketResult = settleTickets(db);
        log.info?.({ ticketResult }, '[scheduler] settleTickets concluído');
        db.close();
      } catch (err) {
        log.error?.({ err: err.message }, '[scheduler] settleTickets falhou');
      }
    }
  });
  child.on('error', (err) => log.error?.({ job: job.name, err: err.message }, '[scheduler] spawn_failed'));
}

export function startScheduler({ log = console } = {}) {
  if (process.env.SCHEDULER_ENABLED !== 'true') {
    log.info?.('[scheduler] desativado (set SCHEDULER_ENABLED=true para ligar)');
    return null;
  }

  const fired = new Set();
  const intervals = [];

  function tick() {
    const now = new Date();
    for (const job of JOBS) {
      if (job.intervalMin) continue;
      if (!shouldFireCron(job, now)) continue;
      const key = fireKey(job, now);
      if (fired.has(key)) continue;
      fired.add(key);
      spawnJob(job, log);
    }
    if (fired.size > 100) {
      const today = new Date().toISOString().slice(0, 10);
      for (const k of fired) if (!k.includes(today)) fired.delete(k);
    }
  }
  intervals.push(setInterval(tick, 60_000));

  let intervalJobs = 0;
  for (const job of JOBS) {
    if (!job.intervalMin) continue;
    if (job.enabled && !job.enabled()) {
      log.info?.(`[scheduler] ${job.name} pulado (flag desativada)`);
      continue;
    }
    intervalJobs += 1;
    const ms = job.intervalMin * 60_000;
    setImmediate(() => spawnJob(job, log));
    intervals.push(setInterval(() => spawnJob(job, log), ms));
    log.info?.(`[scheduler] ${job.name} ativo (a cada ${job.intervalMin}min)`);
  }

  const cronJobs = JOBS.filter((j) => !j.intervalMin).length;
  log.info?.(`[scheduler] ativo — ${cronJobs} cron jobs + ${intervalJobs} interval jobs`);
  return { stop: () => intervals.forEach(clearInterval) };
}
