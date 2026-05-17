// @scoutcore/isotonic — Pool Adjacent Violators (PAV) para calibração isotônica.
//
// Entrada de fit: arrays alinhados de probabilidades preditas e outcomes binários (0/1).
// Saída: modelo serializável { x: number[], y: number[] } com x estritamente crescente.
// predict() aplica busca binária + interpolação linear nos breakpoints.
//
// Sem dependências externas. Determinístico.

export const ISOTONIC_VERSION = '1.0.0';
export const MIN_SAMPLES = 20; // mínimo para considerar o modelo confiável

/**
 * @param {number[]} probs  predições brutas em [0,1]
 * @param {Array<0|1>} outcomes  outcome binário alinhado
 * @param {number[]} [weights]   pesos opcionais (default 1)
 * @returns {{x:number[], y:number[], n:number, version:string}}
 */
export function fit(probs, outcomes, weights) {
  if (probs.length !== outcomes.length) throw new Error('isotonic.fit: length mismatch');
  if (probs.length === 0) throw new Error('isotonic.fit: empty');
  const n = probs.length;
  const w0 = weights ?? new Array(n).fill(1);

  // 1. Sort by prob asc.
  const idx = [...probs.keys()].sort((a, b) => probs[a] - probs[b]);
  const x = idx.map((i) => probs[i]);
  const y = idx.map((i) => outcomes[i]);
  const w = idx.map((i) => w0[i]);

  // 2. PAV pool merging (in-place blocks).
  const blocks = []; // {x_start, x_end, sumY, sumW}
  for (let i = 0; i < n; i++) {
    let cur = { x_start: x[i], x_end: x[i], sumY: y[i] * w[i], sumW: w[i] };
    while (blocks.length > 0) {
      const prev = blocks[blocks.length - 1];
      const prevMean = prev.sumY / prev.sumW;
      const curMean  = cur.sumY  / cur.sumW;
      if (prevMean <= curMean) break;
      // merge prev into cur
      cur = {
        x_start: prev.x_start,
        x_end:   cur.x_end,
        sumY:    prev.sumY + cur.sumY,
        sumW:    prev.sumW + cur.sumW,
      };
      blocks.pop();
    }
    blocks.push(cur);
  }

  // 3. Build breakpoint arrays (one point per block at its midpoint x).
  const xb = [];
  const yb = [];
  for (const b of blocks) {
    const xMid = (b.x_start + b.x_end) / 2;
    xb.push(xMid);
    yb.push(b.sumY / b.sumW);
  }

  // 4. Garantir extremos 0 e 1 para clip seguro.
  if (xb[0] > 0) { xb.unshift(0); yb.unshift(yb[0]); }
  if (xb[xb.length - 1] < 1) { xb.push(1); yb.push(yb[yb.length - 1]); }

  return { x: xb, y: yb, n, version: '1.0.0' };
}

/** Aplica modelo isotônico via interpolação linear. */
export function predict(model, p) {
  if (!model || !Array.isArray(model.x) || model.x.length === 0) return p;
  const x = model.x, y = model.y;
  if (p <= x[0]) return y[0];
  if (p >= x[x.length - 1]) return y[y.length - 1];

  // binary search
  let lo = 0, hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= p) lo = mid; else hi = mid;
  }
  const t = (p - x[lo]) / (x[hi] - x[lo] || 1);
  return y[lo] + t * (y[hi] - y[lo]);
}

export function serialize(model) { return JSON.stringify(model); }
export function deserialize(json) {
  if (typeof json !== 'string' || !json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

/** Chave canônica de blob por (family, period, direction, liga). */
export function isoKey({ family, period, direction, liga }) {
  return `${family}::${period ?? 'FT'}::${direction}::${liga ?? '*'}`;
}

/**
 * Carrega todos os modelos isotônicos do DB em um Map keyed por isoKey.
 * Tolera ausência da tabela (retorna Map vazio).
 */
export function loadIsotonicMap(db) {
  const map = new Map();
  // Detecta presença da coluna `period` (migration 011) para retro-compat.
  let hasPeriod = false;
  try {
    const cols = db.prepare(`PRAGMA table_info(isotonic_blob)`).all();
    hasPeriod = cols.some((c) => c.name === 'period');
  } catch {
    return map;
  }
  try {
    const sql = hasPeriod
      ? 'SELECT family, period, direction, liga, blob_bytes, n_samples, fit_at FROM isotonic_blob'
      : 'SELECT family, direction, liga, blob_bytes, n_samples, fit_at FROM isotonic_blob';
    const rows = db.prepare(sql).all();
    for (const r of rows) {
      const blob = typeof r.blob_bytes === 'string'
        ? r.blob_bytes
        : (r.blob_bytes ? Buffer.from(r.blob_bytes).toString('utf8') : null);
      const model = deserialize(blob);
      if (!model) continue;
      const period = hasPeriod ? r.period : 'FT';
      map.set(isoKey({ family: r.family, period, direction: r.direction, liga: r.liga }), {
        model, n_samples: r.n_samples, fit_at: r.fit_at,
      });
    }
  } catch {
    // tabela inexistente em dev: silencioso
  }
  return map;
}

/** Resolve modelo: tenta (liga,period) específico, depois global ('*',period). */
export function getIsotonic(map, { family, period, direction, liga }) {
  const per = period ?? 'FT';
  const specific = map.get(isoKey({ family, period: per, direction, liga }));
  if (specific && specific.n_samples >= MIN_SAMPLES) return specific;
  const global = map.get(isoKey({ family, period: per, direction, liga: '*' }));
  if (global && global.n_samples >= MIN_SAMPLES) return global;
  return null;
}

/**
 * Aplica isotônica em slot.fair_prob, gravando provenance.
 * No-op (com provenance.applied=false) quando modelo não disponível ou amostras insuficientes.
 */
export function applyIsotonicToSlot(slot, isoEntry) {
  slot.provenance = slot.provenance ?? {};
  if (!isoEntry || !isoEntry.model) {
    slot.provenance.isotonic = { applied: false, reason: 'no_model' };
    return;
  }
  const pBefore = slot.fair_prob;
  const pAfter = predict(isoEntry.model, pBefore);
  slot.fair_prob = +pAfter.toFixed(6);
  slot.fair_odd = pAfter > 0 ? +(1 / pAfter).toFixed(4) : null;
  if (slot.market_odd != null) {
    slot.edge_pct = +((pAfter * slot.market_odd - 1) * 100).toFixed(2);
  }
  slot.provenance.isotonic = {
    applied: true,
    p_before: pBefore,
    p_after: slot.fair_prob,
    n_samples: isoEntry.n_samples,
    fit_at: isoEntry.fit_at,
  };
}

/** Salva (upsert) blob isotônico para uma chave. */
export function saveIsotonicBlob(db, { family, period, direction, liga, model, n_samples }) {
  const blob = serialize(model);
  const per = period ?? 'FT';
  // Detecta esquema com coluna `period` (migration 011). Se ausente, segue PK antiga.
  const cols = db.prepare(`PRAGMA table_info(isotonic_blob)`).all();
  const hasPeriod = cols.some((c) => c.name === 'period');
  if (hasPeriod) {
    db.prepare(
      `INSERT INTO isotonic_blob (family, liga, period, direction, blob_bytes, n_samples, fit_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(family, liga, period, direction) DO UPDATE SET
         blob_bytes=excluded.blob_bytes,
         n_samples=excluded.n_samples,
         fit_at=excluded.fit_at`
    ).run(family, liga ?? '*', per, direction, blob, n_samples);
  } else {
    db.prepare(
      `INSERT INTO isotonic_blob (family, direction, liga, blob_bytes, n_samples, fit_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(family, direction, liga) DO UPDATE SET
         blob_bytes=excluded.blob_bytes,
         n_samples=excluded.n_samples,
         fit_at=excluded.fit_at`
    ).run(family, direction, liga ?? '*', blob, n_samples);
  }
}
