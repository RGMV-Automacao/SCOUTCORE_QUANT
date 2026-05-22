// SCOUTCORE_QUANT — API entrypoint.
// Rotas v1: health, markets, predict, predict/batch, settle (in-memory),
//           settle/:run_id, settle/batch, calibration, replay, evaluation.
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { SqliteMatchRepository } from '@scoutcore/data-access';
import { MARKETS, MARKETS_VERSION, listMarkets } from '@scoutcore/markets';
import { settle } from '@scoutcore/markets/settle';
import { registerPredict, buildHealthPayload } from './predict.mjs';
import { registerPredictBatch } from './routes/predict-batch.mjs';
import { registerCalibration } from './routes/calibration.mjs';
import { registerReplay } from './routes/replay.mjs';
import { registerSettleAdmin } from './routes/settle-admin.mjs';
import { registerEvaluation } from './routes/evaluation.mjs';
import { registerRuns } from './routes/runs.mjs';
import { registerStrategies } from './routes/strategies.mjs';
import { runMigrations } from './migrate.mjs';
import { startScheduler } from './scheduler.mjs';
import { closeBooklineSession } from './bookline-session.mjs';

function resolveDbPath(envVal, name) {
  if (!envVal) {
    console.error(`[api] ${name} não definido em .env`);
    process.exit(1);
  }
  const abs = isAbsolute(envVal) ? envVal : resolve(process.cwd(), envVal);
  if (!existsSync(abs)) {
    console.error(`[api] ${name} não encontrado: ${abs}`);
    process.exit(1);
  }
  return abs;
}

const SCOUT_DB = resolveDbPath(process.env.SCOUT_DB, 'SCOUT_DB');

try {
  const m = runMigrations(SCOUT_DB);
  if (m.applied.length > 0) console.log(`[api] migrations applied: ${m.applied.join(', ')}`);
} catch (err) {
  console.error(`[api] migration error: ${err.message}`);
  process.exit(1);
}

const app = Fastify({ logger: { level: process.env.API_LOG_LEVEL ?? 'info' } });
app.register(cors, {
  origin: '*',
  methods: ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'],
});
const repo = new SqliteMatchRepository(SCOUT_DB);
app.addHook('onClose', async () => repo.close());
app.addHook('onClose', async () => { await closeBooklineSession().catch(() => null); });

app.get('/health',     async () => buildHealthPayload({ repo }));
app.get('/v1/health',  async () => buildHealthPayload({ repo }));

app.get('/v1/markets', async (req) => {
  const { family, scope, period } = req.query ?? {};
  const items = (family || scope || period) ? listMarkets({ family, scope, period }) : MARKETS;
  return {
    contract_version: '1.0.0',
    markets_catalog_version: MARKETS_VERSION,
    count: items.length,
    items,
  };
});

app.post('/v1/settle', async (req, reply) => {
  const { slots = [], result } = req.body ?? {};
  if (!result) return reply.code(400).send({ error: 'missing_result' });
  const out = slots.map((s) => ({
    market_key: s.market_key ?? s,
    ...settle(s.market_key ?? s, result),
  }));
  return { items: out };
});

registerPredict(app, { repo });
registerPredictBatch(app, { repo });
registerCalibration(app, { repo });
registerReplay(app, { repo });
registerSettleAdmin(app, { repo });
registerEvaluation(app, { repo });
registerRuns(app, { repo });
registerStrategies(app, { repo });
const port = Number(process.env.API_PORT ?? 4040);
const host = process.env.API_HOST ?? '127.0.0.1';
app.listen({ port, host })
  .then(() => {
    app.log.info(`scoutcore-api up @ http://${host}:${port}`);
    startScheduler({ log: app.log });
  })
  .catch((err) => { app.log.error(err); process.exit(1); });
