// engine-b-bridge — STUB honesto.
// O sidecar Python (XGB+LGBM) ainda não existe. Esta bridge declara a
// interface esperada e devolve { available:false } para o curinga
// degradar para Engine A puro, sem inventar números.

export const ENGINE_B_VERSION = '0.0.0-unavailable';

export async function predictBatch(_features) {
  return {
    available: false,
    reason: 'engine_b_sidecar_not_implemented',
    slots: [],
    version: ENGINE_B_VERSION,
  };
}

export function ping() {
  return { available: false, version: ENGINE_B_VERSION };
}
