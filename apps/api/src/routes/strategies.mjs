import { applyStrategy, listStrategies, getStrategyConfig } from '@scoutcore/strategy-engine';
import { getRunsStore } from './runs.mjs';

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

    return result;
  });
}
