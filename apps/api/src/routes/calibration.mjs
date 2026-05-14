// /v1/calibration — leitura/admin do calib_state.
// GET  /v1/calibration?engine=A&liga=brasileirao
// GET  /v1/calibration/:engine/:family/:liga
// POST /v1/calibration/refit/isotonic  (dispara job; body: {family, direction, liga})

import { spawn } from 'node:child_process';

export function registerCalibration(app, { repo }) {
  app.get('/v1/calibration', async (req) => {
    const { engine = 'A', liga } = req.query ?? {};
    const sql = `SELECT engine, family, direction, liga, ewma_hr, ewma_brier, clv_score,
                        sample_size, lambda_mult, confidence_factor, line_shift,
                        isotonic_version, updated_at
                 FROM calib_state
                 WHERE engine = ?${liga ? ' AND liga = ?' : ''}
                 ORDER BY family, direction, liga`;
    const params = liga ? [engine, liga] : [engine];
    const rows = repo.db.prepare(sql).all(...params);
    return { engine, liga: liga ?? null, count: rows.length, items: rows };
  });

  app.get('/v1/calibration/:engine/:family/:liga', async (req, reply) => {
    const { engine, family, liga } = req.params;
    const rows = repo.db.prepare(
      `SELECT * FROM calib_state WHERE engine = ? AND family = ? AND liga = ?`
    ).all(engine, family, liga);
    if (!rows.length) return reply.code(404).send({ error: 'not_found' });
    return { items: rows };
  });

  // Dispara refit isotônico em background. Retorna run_id imediatamente.
  app.post('/v1/calibration/refit/isotonic', async (req, reply) => {
    const args = ['apps/jobs/src/refit-isotonic.mjs'];
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    return reply.code(202).send({ accepted: true, pid: child.pid });
  });
}
