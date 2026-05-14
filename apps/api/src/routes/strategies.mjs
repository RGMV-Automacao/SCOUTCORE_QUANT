import { randomUUID } from 'node:crypto';
import { applyStrategy, listStrategies, getStrategyConfig } from '@scoutcore/strategy-engine';
import { getRunsStore } from './runs.mjs';

/**
 * Endpoint para aplicar estratégias sobre slots de um run.
 * GET /v1/strategies
 * GET /v1/runs/:id/strategy/:name
 */
export function registerStrategies(app, { repo }) {
  app.get('/v1/strategies', async () => {
    return { items: listStrategies() };
  });

  app.get('/v1/strategies/:name/config', async (req, reply) => {
    const { name } = req.params;
    const config = getStrategyConfig(name);
    if (!config) return reply.code(404).send({ error: 'strategy_not_found' });
    return config;
  });

  app.post('/v1/runs/:id/strategy/:name', async (req, reply) => {
    const { id, name } = req.params;
    const overrides = req.body ?? {};

    const run = getRunsStore().get(id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });

    const result = await applyStrategy(name, run.slots, overrides);

    if (result.error) {
      return reply.code(400).send({ error: result.error });
    }

    return result;
  });

  // ── Yankee submission (Bloco 3.4) ─────────────────────────────────────────
  // Endpoints separados para dry-run (validação) e submit (persistência).
  // Submit grava snapshot em `yankee_submissions` com stake_per_ticket,
  // tickets_json e status='submitted'. Dry-run idem mas status='validated'
  // e is_dry_run=1.
  const insertSubmission = repo.db.prepare(`
    INSERT INTO yankee_submissions
      (submission_id, run_id, is_dry_run, stake_per_ticket,
       tickets_count, stake_total, status, warnings, tickets_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  async function buildYankeeSubmissionResult({ runId, stakePerTicket, isDryRun, overrides }) {
    const run = getRunsStore().get(runId);
    if (!run) return { __error: 'run_not_found', __status: 404 };

    const stake = Number(stakePerTicket);
    if (!Number.isFinite(stake) || stake < 1 || stake > 100) {
      return { __error: 'invalid_stake_per_ticket_range_1_100', __status: 400 };
    }

    const yankee = await applyStrategy('yankee', run.slots, overrides ?? {});
    if (yankee.error) return { __error: yankee.error, __status: 400 };

    const tickets = Array.isArray(yankee.tickets) ? yankee.tickets : [];
    const warnings = Array.isArray(yankee.board?.warnings) ? [...yankee.board.warnings] : [];

    // Validação de submissão (não bloqueia dry-run; bloqueia submit real)
    const blocking = [];
    if (tickets.length === 0) blocking.push('no_tickets_in_yankee');
    const boardStatus = yankee.board?.board_status;
    if (boardStatus && boardStatus !== 'ready' && boardStatus !== 'ok') {
      blocking.push(`board_status:${boardStatus}`);
    }

    const stakeTotal = +(tickets.length * stake).toFixed(2);
    const status = isDryRun ? 'validated' : (blocking.length > 0 ? 'rejected' : 'submitted');

    const submissionId = `sub-${runId}-${randomUUID().slice(0, 8)}`;
    const ticketsJson = JSON.stringify(tickets);
    const warningsJson = warnings.length ? JSON.stringify(warnings) : null;

    insertSubmission.run(
      submissionId,
      runId,
      isDryRun ? 1 : 0,
      stake,
      tickets.length,
      stakeTotal,
      status,
      warningsJson,
      ticketsJson,
    );

    return {
      submission_id: submissionId,
      run_id: runId,
      is_dry_run: isDryRun,
      status,
      stake_per_ticket: stake,
      tickets_count: tickets.length,
      stake_total: stakeTotal,
      blocking,
      warnings,
      board: yankee.board ?? null,
      tickets,
    };
  }

  app.post('/v1/runs/:id/yankee/dry-run', async (req, reply) => {
    const { id } = req.params;
    const { stake_per_ticket = 3, overrides } = req.body ?? {};
    const out = await buildYankeeSubmissionResult({
      runId: id, stakePerTicket: stake_per_ticket, isDryRun: true, overrides,
    });
    if (out.__error) return reply.code(out.__status).send({ error: out.__error });
    return out;
  });

  app.post('/v1/runs/:id/yankee/submit', async (req, reply) => {
    const { id } = req.params;
    const { stake_per_ticket = 3, overrides, confirm } = req.body ?? {};
    // Camada extra de proteção server-side: exige confirm=true no body
    // (a UI já tem o double-confirm de 15s; isto evita curl acidental).
    if (confirm !== true) {
      return reply.code(400).send({ error: 'confirm_required', hint: 'set confirm:true in body' });
    }
    const out = await buildYankeeSubmissionResult({
      runId: id, stakePerTicket: stake_per_ticket, isDryRun: false, overrides,
    });
    if (out.__error) return reply.code(out.__status).send({ error: out.__error });
    if (out.status === 'rejected') {
      return reply.code(409).send(out);
    }
    return out;
  });

  app.get('/v1/runs/:id/yankee/submissions', async (req, reply) => {
    const { id } = req.params;
    const rows = repo.db.prepare(`
      SELECT submission_id, run_id, submitted_at, is_dry_run, stake_per_ticket,
             tickets_count, stake_total, status, warnings
      FROM yankee_submissions
      WHERE run_id = ?
      ORDER BY submitted_at DESC
    `).all(id);
    return {
      run_id: id,
      items: rows.map((r) => ({
        ...r,
        is_dry_run: !!r.is_dry_run,
        warnings: r.warnings ? JSON.parse(r.warnings) : [],
      })),
    };
  });
}
