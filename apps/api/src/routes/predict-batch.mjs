// /v1/predict/batch — chamada em lote para até N partidas em paralelo limitado.
// Reusa o handler unitário `runPredict` (extraído de predict.mjs).
import { runPredict } from '../predict.mjs';

const MAX_BATCH = 50;
const CONCURRENCY = 4;

export function registerPredictBatch(app, { repo }) {
  app.post('/v1/predict/batch', async (req, reply) => {
    const body = req.body ?? {};
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items) return reply.code(400).send({ error: 'items_required' });
    if (items.length === 0) return { count: 0, items: [] };
    if (items.length > MAX_BATCH) {
      return reply.code(413).send({ error: 'batch_too_large', max: MAX_BATCH, got: items.length });
    }
    // Concurrency-limited execution.
    const results = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try {
          results[i] = await runPredict({ repo, body: items[i], log: app.log });
        } catch (e) {
          results[i] = { error: 'predict_failed', message: e.message };
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { count: results.length, items: results };
  });
}
