// SCOUTCORE_QUANT — API entrypoint (stub)
// Implementação real: rotas /v1/predict, /v1/settle, /v1/markets, /v1/calibration
import 'dotenv/config';
import Fastify from 'fastify';

const app = Fastify({
  logger: { level: process.env.API_LOG_LEVEL ?? 'info' }
});

app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

app.get('/v1/markets', async () => {
  return { todo: 'expor catálogo SemVer dos 479 mercados (P9 zero-bloqueio)' };
});

const port = Number(process.env.API_PORT ?? 4040);
const host = process.env.API_HOST ?? '127.0.0.1';

app.listen({ port, host })
  .then(() => app.log.info(`scoutcore-api up @ http://${host}:${port}`))
  .catch((err) => { app.log.error(err); process.exit(1); });
