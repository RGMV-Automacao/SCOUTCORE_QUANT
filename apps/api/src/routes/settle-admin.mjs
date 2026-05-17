// /v1/settle/:run_id e /v1/settle/batch — disparo do settler real (não só payout in-memory).
// O endpoint POST /v1/settle (já existente em index.mjs) faz settle in-memory de slots
// contra um result. Estes endpoints disparam o settle-results.mjs sobre prediction rows.

import { spawn } from 'node:child_process';
import { settle as settleJob } from '../../../jobs/src/settle-results.mjs';
import { settleTickets } from './settle-tickets.mjs';

function backfillPredictionsFromRunSlots(db, run_id) {
  const exists = db.prepare('SELECT 1 FROM prediction WHERE run_id = ? LIMIT 1').get(run_id);
  if (exists) return 0;

  const slotRows = db.prepare(
    `SELECT match_id, market_key, payload FROM run_slots WHERE run_id = ?`
  ).all(run_id);
  if (!slotRows.length) return null;

  const runMeta = db.prepare(
    `SELECT date_start FROM runs WHERE run_id = ?`
  ).get(run_id) ?? {};
  const ins = db.prepare(`
    INSERT OR IGNORE INTO prediction
      (run_id, match_id, match_date, liga, family, scope, period, direction,
       line, market_key, fair_prob, market_odd, edge_pct, confidence, certified, provenance)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  let backfilled = 0;
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      let p;
      try { p = JSON.parse(row.payload); } catch { continue; }
      const result = ins.run(
        run_id,
        row.match_id ?? p.match_id ?? null,
        p.date ?? p.match_date ?? runMeta.date_start ?? null,
        p.liga ?? null,
        p.family ?? null,
        p.scope ?? null,
        p.period ?? null,
        p.direction ?? null,
        p.line ?? null,
        row.market_key ?? p.market_key,
        p.fair_prob ?? 0,
        p.market_odd ?? null,
        p.edge_pct ?? null,
        p.confidence ?? 0,
        p.certified ? 1 : 0,
        p.provenance ? JSON.stringify(p.provenance) : null,
      );
      backfilled += result.changes;
    }
  });
  tx(slotRows);
  return backfilled;
}

function loadPredictionRows(db, run_id) {
  return db.prepare(`
    SELECT p.run_id, p.match_id, p.match_date, p.liga,
           p.family, p.scope, p.period, p.direction, p.line,
           p.market_key, p.fair_prob, p.market_odd, p.edge_pct,
           p.confidence, p.certified, p.result, p.actual_value, p.settled_at,
           COALESCE(m.home, pt.home_team) AS home,
           COALESCE(m.away, pt.away_team) AS away
    FROM prediction p
    LEFT JOIN match m    ON p.match_id = m.id
    LEFT JOIN partidas pt ON p.match_id = pt.id_confronto
    WHERE p.run_id = ?
    ORDER BY p.edge_pct DESC NULLS LAST
  `).all(run_id);
}

function summarizePredictionRows(run_id, rows, backfilled = 0) {
  const green   = rows.filter((r) => r.result === 'green').length;
  const red     = rows.filter((r) => r.result === 'red').length;
  const pending = rows.filter((r) => !r.result).length;
  return {
    run_id,
    count: rows.length,
    green,
    red,
    pending,
    certified: rows.filter((r) => r.certified).length,
    backfilled_from_slots: backfilled,
    rows,
  };
}

export function registerSettleAdmin(app, { repo }) {
  // POST /v1/settle/:run_id — liquida predictions de um run específico
  app.post('/v1/settle/:run_id', async (req, reply) => {
    const { run_id } = req.params;
    const dryRun = req.query?.dry_run === 'true';
    const closingOdds = req.body?.closing_odds ?? null;
    try {
      const backfilled = backfillPredictionsFromRunSlots(repo.db, run_id);
      if (backfilled == null) return reply.code(404).send({ error: 'run_not_found_or_no_predictions' });
      const out = settleJob(repo.db, { run_id, dryRun, closingOdds });
      return { run_id, dry_run: dryRun, backfilled_from_slots: backfilled, ...out };
    } catch (e) {
      app.log.error({ err: e.message, run_id }, 'settle_run_failed');
      return reply.code(500).send({ error: 'settle_failed', message: e.message });
    }
  });

  // POST /v1/settle/tickets — Liquida cascade de tickets yankee
  app.post('/v1/settle/tickets', async (req, reply) => {
    const dryRun = req.body?.dry_run === true;
    try {
      const result = settleTickets(repo.db, { dryRun });
      return result;
    } catch (e) {
      app.log.error({ err: e.message }, 'settle_tickets_failed');
      return reply.code(500).send({ error: 'settle_tickets_failed', message: e.message });
    }
  });

  // POST /v1/settle/:run_id/repair — RESET + reliquida (Bloco 5.1)
  // Caso de uso: regras de settlement mudaram e queremos reprocessar um run
  // já fechado para refletir as regras atuais. Limpa result/settled_at de
  // todas as predictions do run e roda o settler de novo.
  // Quando não houver rows em `prediction` mas o run tiver `run_slots` (ex.: smoke
  // run antigo que não passou pelo predict.mjs/savePredictions), faz backfill
  // de prediction a partir de run_slots antes de liquidar.
  // Exige confirm=true no body para evitar curl acidental.
  app.post('/v1/settle/:run_id/repair', async (req, reply) => {
    const { run_id } = req.params;
    const { confirm } = req.body ?? {};
    if (confirm !== true) {
      return reply.code(400).send({ error: 'confirm_required', hint: 'set confirm:true in body' });
    }
    const backfilled = backfillPredictionsFromRunSlots(repo.db, run_id);
    if (backfilled == null) return reply.code(404).send({ error: 'run_not_found_or_no_predictions' });
    try {
      const reset = repo.db.prepare(
        `UPDATE prediction
            SET result = NULL,
                actual_value = NULL,
                settled_at = NULL
          WHERE run_id = ?`
      ).run(run_id);
      const out = settleJob(repo.db, { run_id, dryRun: false, closingOdds: null });
      return {
        run_id,
        mode: 'repair',
        backfilled_from_slots: backfilled,
        reset_predictions: reset.changes,
        ...out,
      };
    } catch (e) {
      app.log.error({ err: e.message, run_id }, 'settle_repair_failed');
      return reply.code(500).send({ error: 'repair_failed', message: e.message });
    }
  });

  // POST /v1/settle/batch — liquida por data ± liga (assíncrono)
  app.post('/v1/settle/batch', async (req, reply) => {
    const body = req.body ?? {};
    if (!body.date) return reply.code(400).send({ error: 'date_required' });
    const args = ['apps/jobs/src/settle-results.mjs', `--date=${body.date}`];
    if (body.liga) args.push(`--liga=${body.liga}`);
    if (body.dry_run) args.push('--dry-run');
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(), env: process.env, stdio: 'ignore', detached: true,
    });
    child.unref();
    return reply.code(202).send({ accepted: true, pid: child.pid, args: args.slice(1) });
  });

  // GET /v1/predictions/:run_id — todas as predições de um run (para tabela no Resolver)
  app.get('/v1/predictions/:run_id', async (req, reply) => {
    const { run_id } = req.params;
    let rows = loadPredictionRows(repo.db, run_id);
    let backfilled = 0;
    if (!rows.length) {
      const b = backfillPredictionsFromRunSlots(repo.db, run_id);
      if (b == null) return reply.code(404).send({ error: 'not_found' });
      backfilled = b;
      rows = loadPredictionRows(repo.db, run_id);
    }
    if (!rows.length) return reply.code(404).send({ error: 'not_found' });
    return summarizePredictionRows(run_id, rows, backfilled);
  });

  // GET /v1/settle/run/:run_id — status agregado de um run
  app.get('/v1/settle/run/:run_id', async (req, reply) => {
    const { run_id } = req.params;
    const backfilled = backfillPredictionsFromRunSlots(repo.db, run_id);
    if (backfilled == null) return reply.code(404).send({ error: 'not_found' });
    const rows = repo.db.prepare(
      `SELECT result, COUNT(*) n FROM prediction WHERE run_id = ? GROUP BY result`
    ).all(run_id);
    if (!rows.length) return reply.code(404).send({ error: 'not_found' });
    const summary = { run_id, total: 0, green: 0, red: 0, pending: 0 };
    for (const r of rows) {
      summary.total += r.n;
      if (r.result === 'green') summary.green = r.n;
      else if (r.result === 'red') summary.red = r.n;
      else summary.pending += r.n;
    }
    summary.green_rate = summary.total > 0
      ? +(summary.green / Math.max(1, summary.green + summary.red)).toFixed(4)
      : null;
    summary.backfilled_from_slots = backfilled;
    return summary;
  });
}
