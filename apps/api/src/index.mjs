// SCOUTCORE_QUANT — API entrypoint.
// Rotas v1: /v1/health, /v1/markets, /v1/predict, /v1/settle.
import 'dotenv/config';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { SqliteMatchRepository } from '@scoutcore/data-access';
import { MARKETS, MARKETS_VERSION, listMarkets } from '@scoutcore/markets';
import { settle } from '@scoutcore/markets/settle';
import { registerPredict, buildHealthPayload } from './predict.mjs';

const SCOUT_DB = process.env.SCOUT_DB;
if (!SCOUT_DB || !existsSync(SCOUT_DB)) {
  console.error(`[api] SCOUT_DB inválido: ${SCOUT_DB}`);
  process.exit(1);
}

const app = Fastify({ logger: { level: process.env.API_LOG_LEVEL ?? 'info' } });
const repo = new SqliteMatchRepository(SCOUT_DB);
app.addHook('onClose', async () => repo.close());

app.get('/health',     async () => buildHealthPayload());
app.get('/v1/health',  async () => buildHealthPayload());

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

const port = Number(process.env.API_PORT ?? 4040);
const host = process.env.API_HOST ?? '127.0.0.1';
app.listen({ port, host })
  .then(() => app.log.info(`scoutcore-api up @ http://${host}:${port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
