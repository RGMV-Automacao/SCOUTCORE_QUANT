// /v1/evaluation — métricas de qualidade pós-settle (Brier, log-loss, hit-rate, CLV).
// GET /v1/evaluation/summary?engine=A&liga=brasileirao&since=2025-01-01
// GET /v1/evaluation/by-family?engine=A&liga=brasileirao
// GET /v1/evaluation/clv?engine=A&liga=brasileirao

export function registerEvaluation(app, { repo }) {
  // Summary global em prediction (filtrável). Brier/log_loss calculados on-the-fly.
  app.get('/v1/evaluation/summary', async (req) => {
    const { engine = 'A', liga, since, until, family } = req.query ?? {};
    const where = [`p.result IN ('green','red')`, `p.fair_prob IS NOT NULL`];
    const params = [];
    if (liga)   { where.push('p.liga = ?');         params.push(liga); }
    if (since)  { where.push('p.match_date >= ?');  params.push(since); }
    if (until)  { where.push('p.match_date <= ?');  params.push(until); }
    if (family) { where.push('p.family = ?');       params.push(family); }
    const rows = repo.db.prepare(
      `SELECT result, fair_prob FROM prediction p WHERE ${where.join(' AND ')}`
    ).all(...params);

    if (!rows.length) return { engine, n: 0, brier: null, log_loss: null, hit_rate: null };

    let brierSum = 0, llSum = 0, green = 0;
    for (const r of rows) {
      const y = r.result === 'green' ? 1 : 0;
      const p = Math.min(0.999, Math.max(0.001, r.fair_prob));
      brierSum += (p - y) ** 2;
      llSum    += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
      if (y) green++;
    }
    const n = rows.length;
    return {
      engine, liga: liga ?? null, since: since ?? null, until: until ?? null, family: family ?? null,
      n, green, red: n - green,
      hit_rate: +(green / n).toFixed(4),
      brier:    +(brierSum / n).toFixed(6),
      log_loss: +(llSum / n).toFixed(6),
    };
  });

  // Por família — útil para detectar onde o motor calibra mal.
  app.get('/v1/evaluation/by-family', async (req) => {
    const { liga, since } = req.query ?? {};
    const where = [`result IN ('green','red')`, `fair_prob IS NOT NULL`];
    const params = [];
    if (liga)  { where.push('liga = ?');        params.push(liga); }
    if (since) { where.push('match_date >= ?'); params.push(since); }
    const rows = repo.db.prepare(
      `SELECT family, result, fair_prob FROM prediction WHERE ${where.join(' AND ')}`
    ).all(...params);
    const agg = new Map();
    for (const r of rows) {
      const k = r.family;
      if (!agg.has(k)) agg.set(k, { n: 0, green: 0, brier: 0, ll: 0 });
      const a = agg.get(k);
      a.n++;
      const y = r.result === 'green' ? 1 : 0;
      const p = Math.min(0.999, Math.max(0.001, r.fair_prob));
      a.green += y;
      a.brier += (p - y) ** 2;
      a.ll    += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    }
    const items = [...agg.entries()].map(([family, a]) => ({
      family, n: a.n, hit_rate: +(a.green / a.n).toFixed(4),
      brier: +(a.brier / a.n).toFixed(6), log_loss: +(a.ll / a.n).toFixed(6),
    })).sort((a, b) => a.brier - b.brier);
    return { count: items.length, items };
  });

  // CLV — lê clv_history. brier_a = engine A, brier_b = engine B (futuro).
  app.get('/v1/evaluation/clv', async (req) => {
    const { liga, since, family } = req.query ?? {};
    const where = [];
    const params = [];
    if (liga)   { where.push('liga = ?');        params.push(liga); }
    if (family) { where.push('family = ?');      params.push(family); }
    if (since)  { where.push('settled_at >= ?'); params.push(since); }
    const sql = `
      SELECT
        family, liga,
        COUNT(*)         AS n,
        AVG(brier_a)     AS avg_brier_a,
        AVG(brier_b)     AS avg_brier_b,
        AVG(clv_pct)     AS avg_clv_pct,
        SUM(CASE WHEN result='green' THEN 1 ELSE 0 END) AS green
      FROM clv_history
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY family, liga
      ORDER BY n DESC
    `;
    const items = repo.db.prepare(sql).all(...params).map(r => ({
      ...r,
      avg_brier_a: r.avg_brier_a == null ? null : +r.avg_brier_a.toFixed(6),
      avg_brier_b: r.avg_brier_b == null ? null : +r.avg_brier_b.toFixed(6),
      avg_clv_pct: r.avg_clv_pct == null ? null : +r.avg_clv_pct.toFixed(4),
      hit_rate: r.n > 0 ? +(r.green / r.n).toFixed(4) : null,
    }));
    const total = repo.db.prepare(
      `SELECT COUNT(*) c FROM clv_history${where.length ? ' WHERE ' + where.join(' AND ') : ''}`
    ).get(...params).c;
    return { total, count: items.length, items };
  });
}
