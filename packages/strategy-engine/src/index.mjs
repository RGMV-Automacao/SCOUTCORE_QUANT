/**
 * @scoutcore/strategy-engine — index.mjs
 * ═════════════════════════════════════════════════════════════════════════════
 * Registry central de estratégias. Carrega configs JSON do disco e delega
 * para o runner correto por tipo.
 *
 * API:
 *   listStrategies()                     → StrategyMeta[]
 *   getStrategyConfig(id)                → config object | null
 *   applyStrategy(id, slots, overrides)  → StrategyOutput
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRATEGIES_DIR = resolve(__dirname, '..', 'config', 'strategies');

// ── Lazy-load runners (evita import circular) ───────────────────────────────
const RUNNER_MAP = new Map();
async function getRunner(type) {
  if (RUNNER_MAP.has(type)) return RUNNER_MAP.get(type);
  const runnerPath = resolve(__dirname, 'runners', `${type}.mjs`);
  try {
    const mod = await import(`file://${runnerPath.replace(/\\/g, '/')}`);
    RUNNER_MAP.set(type, mod);
    return mod;
  } catch (e) {
    return null;
  }
}

// ── Config loader ───────────────────────────────────────────────────────────
let _configCache = null;

function loadConfigs() {
  if (_configCache) return _configCache;
  const configs = new Map();
  let files;
  try {
    files = readdirSync(STRATEGIES_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  for (const file of files) {
    try {
      const raw = readFileSync(resolve(STRATEGIES_DIR, file), 'utf-8');
      const cfg = JSON.parse(raw);
      if (cfg.id) configs.set(cfg.id, cfg);
    } catch {
      // config inválido — silencia
    }
  }
  _configCache = configs;
  return configs;
}

/** Limpa cache (útil para testes). */
export function __resetConfigCache() {
  _configCache = null;
  RUNNER_MAP.clear();
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista todas as estratégias disponíveis.
 * @returns {{ id: string, label: string, description: string, type: string }[]}
 */
export function listStrategies() {
  const configs = loadConfigs();
  return [...configs.values()].map((c) => ({
    id: c.id,
    label: c.label ?? c.id,
    description: c.description ?? '',
    type: c.type ?? 'unknown',
  }));
}

/**
 * Retorna a config completa de uma estratégia, ou null se não existe.
 * @param {string} id
 * @returns {object | null}
 */
export function getStrategyConfig(id) {
  return loadConfigs().get(id) ?? null;
}

/**
 * Aplica uma estratégia sobre um array de slots.
 *
 * @param {string} id         ID da estratégia (ex: 'yankee', 'duplas', 'bingo-escanteios')
 * @param {object[]} slots    Array de slots calibrados (output do predict)
 * @param {object} [overrides]  Sobrescreve params da config (ex: { top_n: 5 })
 * @returns {Promise<StrategyOutput>}
 *
 * @typedef {object} StrategyOutput
 * @property {string} strategy_id
 * @property {string} strategy_label
 * @property {string} strategy_type
 * @property {number} input_slots     Total de slots recebidos
 * @property {number} output_picks    Total de picks retornados
 * @property {object} params          Parâmetros usados (config + overrides)
 * @property {object[]} picks         Os picks retornados pelo runner
 * @property {object} [board]         Board (apenas para board_based)
 * @property {object[]} [tickets]     Tickets BIBD (apenas para board_based)
 * @property {object} [meta]          Metadados extras do runner
 */
export async function applyStrategy(id, slots, overrides = {}) {
  const config = getStrategyConfig(id);
  if (!config) {
    return {
      strategy_id: id,
      strategy_label: id,
      strategy_type: 'unknown',
      input_slots: slots?.length ?? 0,
      output_picks: 0,
      params: {},
      picks: [],
      error: `strategy '${id}' not found`,
    };
  }

  const mergedParams = { ...config.params, ...overrides };
  const runner = await getRunner(config.type);

  if (!runner || typeof runner.run !== 'function') {
    return {
      strategy_id: config.id,
      strategy_label: config.label ?? config.id,
      strategy_type: config.type,
      input_slots: slots?.length ?? 0,
      output_picks: 0,
      params: mergedParams,
      picks: [],
      error: `runner '${config.type}' not available`,
    };
  }

  const result = runner.run(slots ?? [], mergedParams);

  return {
    strategy_id: config.id,
    strategy_label: config.label ?? config.id,
    strategy_type: config.type,
    input_slots: slots?.length ?? 0,
    output_picks: result.picks?.length ?? 0,
    params: mergedParams,
    picks: result.picks ?? [],
    board: result.board ?? undefined,
    tickets: result.tickets ?? undefined,
    meta: result.meta ?? undefined,
  };
}
