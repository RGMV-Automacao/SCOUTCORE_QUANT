// /v1/replay — replay de run_id, disparo e status do replay-bootstrap.
// GET  /v1/replay/:run_id      (reexecuta sem persistir e compara quando possivel)
// POST /v1/replay              (body: { liga?, since?, until?, limit?, engines? })
// GET  /v1/replay/status       (lê última linha de motor_run com tag=replay)

import { spawn } from 'node:child_process';
import { runPredict } from '../predict.mjs';

function parseJson(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function comparableResponse(response) {
  if (!response?.slots) return null;
  return {
    contract_version: response.contract_version,
    engine_signature: response.engine_signature,
    match: response.match,
    certified: response.certified,
    warnings: response.warnings || [],
    slots: response.slots,
    ev_ranked: response.ev_ranked || [],
    ev_ranked_capped_out: response.ev_ranked_capped_out || [],
    scout: response.scout ?? null,
  };
}

export function registerReplay(app, { repo }) {
  app.get('/v1/replay/:run_id', async (req, reply) => {
    const { run_id } = req.params;
    const row = repo.db.prepare(
      `SELECT run_id, match_id, engine_signature, request_payload, response_payload, created_at
         FROM motor_run WHERE run_id = ? LIMIT 1`,
    ).get(run_id);
    if (!row) return reply.code(404).send({ error: 'run_not_found', run_id });

    const requestPayload = parseJson(row.request_payload);
    if (!requestPayload) return reply.code(409).send({ error: 'request_payload_unreadable', run_id });

    const replay = await runPredict({ repo, body: requestPayload, log: app.log, persist: false });
    if (replay.__error) return reply.code(replay.__status).send(replay.__body);

    const originalSignature = parseJson(row.engine_signature, {});
    const storedResponse = parseJson(row.response_payload, {});
    const originalComparable = comparableResponse(storedResponse);
    const replayComparable = comparableResponse(replay);
    const signatureMatch = originalSignature?.hash === replay.engine_signature?.hash;
    const comparable = !!originalComparable && !!replayComparable;
    const deterministic = comparable && signatureMatch
      && JSON.stringify(originalComparable) === JSON.stringify(replayComparable);

    return {
      run_id,
      match_id: row.match_id,
      created_at: row.created_at,
      replayed_at: new Date().toISOString(),
      signature_match: signatureMatch,
      comparable,
      deterministic,
      reason: comparable
        ? (signatureMatch ? (deterministic ? 'match' : 'payload_diff') : 'signature_mismatch')
        : 'stored_response_has_no_slots',
      original_engine_signature: originalSignature,
      replay_engine_signature: replay.engine_signature,
      original_slots_count: storedResponse?.slots?.length ?? storedResponse?.slots_count ?? null,
      replay_slots_count: replay.slots?.length ?? null,
      original_ev_ranked: storedResponse?.ev_ranked ?? null,
      replay_ev_ranked: replay.ev_ranked ?? null,
    };
  });

  app.post('/v1/replay', async (req, reply) => {
    const body = req.body ?? {};
    const args = ['apps/jobs/src/replay-bootstrap.mjs'];
    if (body.liga)  args.push(`--liga=${body.liga}`);
    if (body.since) args.push(`--since=${body.since}`);
    if (body.until) args.push(`--until=${body.until}`);
    if (body.limit) args.push(`--limit=${body.limit}`);
    if (body.engines) {
      const engines = Array.isArray(body.engines) ? body.engines.join(',') : String(body.engines);
      args.push(`--engines=${engines}`);
    }
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    return reply.code(202).send({ accepted: true, pid: child.pid, args: args.slice(1) });
  });

  app.get('/v1/replay/status', async () => {
    // Conta clv_history como progresso real do replay.
    const total = repo.db.prepare(`SELECT COUNT(*) c FROM clv_history`).get().c;
    const last = repo.db.prepare(
      `SELECT match_id, settled_at FROM clv_history ORDER BY settled_at DESC LIMIT 1`
    ).get();
    const partidasFin = repo.db.prepare(
      `SELECT COUNT(*) c FROM partidas WHERE home_goals IS NOT NULL`
    ).get().c;
    return {
      clv_history_count: total,
      partidas_finalizadas: partidasFin,
      coverage_pct: partidasFin > 0 ? +(total / partidasFin * 100).toFixed(2) : 0,
      last_settled_match: last?.match_id ?? null,
      last_settled_at: last?.settled_at ?? null,
    };
  });
}
