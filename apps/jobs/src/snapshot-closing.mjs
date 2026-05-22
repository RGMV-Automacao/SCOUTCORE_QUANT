// apps/jobs/src/snapshot-closing.mjs
//
// Congela a ultima odd disponivel em `odds` para predictions abertas e gera
// JSON diretamente consumivel por settle-results.mjs --closing-odds.

import 'dotenv/config';
import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildLookupPlan } from '../../../scripts/lib/superbet-mapping.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DEFAULT_DB = resolve(ROOT, 'data', 'scout_extraction.db');
const DEFAULT_OUT = resolve(ROOT, 'audit', `closing-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    out[key] = rest.length > 0 ? rest.join('=') : true;
  }
  return out;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageMinutes(createdAt, now) {
  const created = parseDate(createdAt);
  const ref = parseDate(now) ?? new Date();
  if (!created) return null;
  return Math.max(0, (ref.getTime() - created.getTime()) / 60000);
}

function isClosingOddSane(openOdd, closeOdd) {
  if (!Number.isFinite(openOdd) || !Number.isFinite(closeOdd)) return false;
  if (openOdd <= 1 || closeOdd <= 1) return false;
  return closeOdd >= openOdd * 0.5 && closeOdd <= openOdd * 2;
}

function buildPredictionQuery({ runId, date, liga }) {
  const where = ['p.result IS NULL', 'p.market_odd IS NOT NULL', 'p.market_odd > 1'];
  const params = [];
  if (runId) { where.push('p.run_id = ?'); params.push(runId); }
  if (date) { where.push('p.match_date = ?'); params.push(date); }
  if (liga) { where.push('p.liga = ?'); params.push(liga); }
  return {
    sql: `
      SELECT p.run_id, p.match_id, p.match_date, p.liga, p.market_key, p.market_odd,
             p.family, p.scope, p.period, p.direction, p.line,
             m.home_team, m.away_team, m.data_partida
        FROM prediction p
        LEFT JOIN partidas m
          ON m.id_confronto = CASE
             WHEN instr(p.match_id, ':') > 0 THEN substr(p.match_id, instr(p.match_id, ':') + 1)
             ELSE p.match_id
          END
       WHERE ${where.join(' AND ')}
       ORDER BY p.run_id, p.market_key
    `,
    params,
  };
}

function findClosingOdd(db, prediction, { source } = {}) {
  if (!prediction.home_team || !prediction.away_team || !prediction.match_date) {
    return { found: false, reason: 'missing_match_identity' };
  }

  const plans = buildLookupPlan(prediction.market_key, prediction.home_team, prediction.away_team);
  if (plans === null) return { found: false, reason: 'unmapped_market' };
  if (plans.length === 0) return { found: false, reason: 'invalid_or_composite_market' };

  for (const plan of plans) {
    const where = ['home_team = ?', 'away_team = ?', 'data_jogo = ?'];
    const params = [prediction.home_team, prediction.away_team, prediction.match_date];
    if (source) { where.push('fonte = ?'); params.push(source); }
    if (plan.mercadoEqOrLike.eq != null) {
      where.push('mercado = ?');
      params.push(plan.mercadoEqOrLike.eq);
    } else if (plan.mercadoEqOrLike.like != null) {
      where.push('mercado LIKE ?');
      params.push(plan.mercadoEqOrLike.like);
    }
    if (plan.selecao != null) { where.push('selecao = ?'); params.push(plan.selecao); }
    if (plan.linha != null) { where.push('linha = ?'); params.push(plan.linha); }

    const row = db.prepare(`
      SELECT fonte, mercado, selecao, linha, odd, criado_em, coleta_id
        FROM odds
       WHERE ${where.join(' AND ')}
       ORDER BY datetime(criado_em) DESC, id DESC
       LIMIT 1
    `).get(...params);
    if (row) return { found: true, row };
  }
  return { found: false, reason: 'offered_odd_not_found' };
}

export function snapshotClosing(db, options = {}) {
  const now = options.now ?? new Date();
  const maxAgeMinutes = Number(options.maxAgeMinutes ?? 15);
  const enforceFreshness = Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0;
  const source = options.source ? String(options.source) : null;
  const query = buildPredictionQuery({ runId: options.runId, date: options.date, liga: options.liga });
  const predictions = db.prepare(query.sql).all(...query.params);

  const payload = {
    _meta: {
      generated_at: parseDate(now)?.toISOString() ?? new Date().toISOString(),
      db_source: source ?? 'any',
      run_id: options.runId ?? null,
      date: options.date ?? null,
      liga: options.liga ?? null,
      max_age_minutes: enforceFreshness ? maxAgeMinutes : null,
      total_predictions: predictions.length,
      captured: 0,
      missing: 0,
      stale: 0,
      invalid: 0,
      reasons: {},
    },
  };

  const rows = [];
  for (const prediction of predictions) {
    const lookup = findClosingOdd(db, prediction, { source });
    if (!lookup.found) {
      payload._meta.missing++;
      payload._meta.reasons[lookup.reason] = (payload._meta.reasons[lookup.reason] ?? 0) + 1;
      continue;
    }

    const closeOdd = Number(lookup.row.odd);
    const openOdd = Number(prediction.market_odd);
    if (!isClosingOddSane(openOdd, closeOdd)) {
      payload._meta.invalid++;
      payload._meta.reasons.invalid_close = (payload._meta.reasons.invalid_close ?? 0) + 1;
      continue;
    }

    const age = ageMinutes(lookup.row.criado_em, now);
    if (enforceFreshness && (age == null || age > maxAgeMinutes)) {
      payload._meta.stale++;
      payload._meta.reasons.stale_close = (payload._meta.reasons.stale_close ?? 0) + 1;
      continue;
    }

    payload[prediction.run_id] ??= {};
    payload[prediction.run_id][prediction.market_key] = {
      odd_close: closeOdd,
      odd_open: openOdd,
      captured_at: lookup.row.criado_em ?? null,
      age_minutes: age == null ? null : +age.toFixed(2),
      source: lookup.row.fonte ?? null,
      mercado: lookup.row.mercado ?? null,
      selecao: lookup.row.selecao ?? null,
      linha: lookup.row.linha ?? null,
      coleta_id: lookup.row.coleta_id ?? null,
    };
    payload._meta.captured++;
    rows.push({
      run_id: prediction.run_id,
      match_id: prediction.match_id,
      market_key: prediction.market_key,
      odd_open: openOdd,
      odd_close: closeOdd,
      captured_at: lookup.row.criado_em ?? null,
      age_minutes: age == null ? null : +age.toFixed(2),
    });
  }

  return { payload, rows, summary: payload._meta };
}

async function main() {
  const args = parseArgs();
  const dbPath = resolve(args.db ? String(args.db) : DEFAULT_DB);
  const outPath = resolve(args.out ? String(args.out) : DEFAULT_OUT);
  const maxAge = args['max-age-minutes'] === true || args['max-age-minutes'] == null
    ? 15
    : Number(args['max-age-minutes']);

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const result = snapshotClosing(db, {
      runId: args['run-id'] ? String(args['run-id']) : null,
      date: args.date ? String(args.date) : null,
      liga: args.liga ? String(args.liga) : null,
      source: args.source ? String(args.source) : null,
      maxAgeMinutes: maxAge,
    });

    if (!args['dry-run']) {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, `${JSON.stringify(result.payload, null, 2)}\n`);
    }

    console.log(JSON.stringify({ out: args['dry-run'] ? null : outPath, ...result.summary }, null, 2));
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
