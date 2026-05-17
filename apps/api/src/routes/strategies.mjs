import { randomUUID } from 'node:crypto';
import { applyStrategy, listStrategies, getStrategyConfig } from '@scoutcore/strategy-engine';
import { getRunsStore } from './runs.mjs';
import { validateYankeeAgainstSuperbet } from '../yankee-superbet-validator.mjs';

/**
 * Enriquece o retorno de applyStrategy com `result` (green/red) e
 * `actual_value` por (match_id, market_key) — vindos de `prediction`
 * após o settler. Permite UI mostrar badges e valor real em todas as
 * telas (yankee/singles-ev/duplas/board) sem alterar o strategy-engine.
 */
function enrichWithSettlement(repo, runId, result) {
  if (!runId || !result || typeof result !== 'object') return result;
  let rows;
  try {
    rows = repo.db.prepare(
      'SELECT match_id, market_key, result, actual_value FROM prediction WHERE run_id = ?'
    ).all(runId);
  } catch {
    return result;
  }
  if (!rows.length) return result;
  const map = new Map();
  for (const r of rows) map.set(`${r.match_id}::${r.market_key}`, r);

  const visit = (node, parentMid = null) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parentMid);
      return;
    }
    const mid = node.match_id ?? parentMid;
    if (mid && node.market_key) {
      const hit = map.get(`${mid}::${node.market_key}`);
      if (hit) {
        if (node.result == null) node.result = hit.result ?? null;
        if (node.actual_value == null) node.actual_value = hit.actual_value ?? null;
      }
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') visit(v, mid);
    }
  };
  visit(result);
  return result;
}

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

    enrichWithSettlement(repo, id, result);
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
    enrichWithSettlement(repo, runId, yankee);

    const tickets = Array.isArray(yankee.tickets) ? yankee.tickets : [];
    const warnings = Array.isArray(yankee.board?.warnings) ? [...yankee.board.warnings] : [];
    let externalValidation = null;

    // Validação de submissão (não bloqueia dry-run; bloqueia submit real)
    const blocking = [];
    if (tickets.length === 0) blocking.push('no_tickets_in_yankee');
    const boardStatus = yankee.board?.board_status;
    if (boardStatus && boardStatus !== 'ready' && boardStatus !== 'ok') {
      blocking.push(`board_status:${boardStatus}`);
    }

    try {
      externalValidation = await validateYankeeAgainstSuperbet({
        repo,
        run,
        yankee,
        maxDropPct: Number(process.env.SCOUTCORE_SB_DRY_RUN_MAX_DROP_PCT || 8),
      });
      warnings.push(
        `superbet_validated:${externalValidation.summary.tickets_ok}/${externalValidation.summary.tickets_total}_tickets`
      );
      if (externalValidation.summary.boards_failed > 0) {
        blocking.push(`superbet_boards_failed:${externalValidation.summary.boards_failed}`);
      }
      if (externalValidation.summary.gaps_total > 0) {
        blocking.push(`superbet_gaps:${externalValidation.summary.gaps_total}`);
      }
    } catch (error) {
      warnings.push(`superbet_validation_error:${error.message}`);
      if (!isDryRun) blocking.push('superbet_validation_unavailable');
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
      validation_scope: externalValidation ? 'local_board_plus_superbet_catalog' : 'local_board_only',
      external_validation: externalValidation,
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
