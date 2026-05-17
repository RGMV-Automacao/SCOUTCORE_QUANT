// engine-signature.mjs — versões + hash determinístico do estado do motor.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_A_VERSION } from '@scoutcore/engine-a';
import { CURINGA_VERSION } from '@scoutcore/curinga';
import { ENGINE_B_VERSION } from '@scoutcore/engine-b-bridge';
import { MARKETS_VERSION } from '@scoutcore/markets';
import { EVIDENCE_VERSION } from '@scoutcore/evidence';
import { QG_VERSION } from '@scoutcore/quality-gates';
import { CALIBRATION_VERSION } from '@scoutcore/calibration';
import { ISOTONIC_VERSION } from '@scoutcore/isotonic';
import { SCOUT_VERSION } from '@scoutcore/scout';

export const MOTOR_VERSION = '0.8.0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function shortHash(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return createHash('sha256').update(value).digest('hex').slice(0, 16);
  }
  return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex').slice(0, 16);
}

function hashFile(relativePath) {
  const path = resolve(ROOT, relativePath);
  if (!existsSync(path)) return null;
  return shortHash(readFileSync(path));
}

function hashModelArtifacts() {
  const dir = process.env.ENGINE_B_MODELS_DIR
    ? resolve(process.env.ENGINE_B_MODELS_DIR)
    : resolve(ROOT, 'apps/ml-sidecar/models');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((name) => name.endsWith('.joblib') || name === 'manifest.json').sort();
  const hash = createHash('sha256');
  for (const name of files) {
    hash.update(name);
    hash.update(readFileSync(resolve(dir, name)));
  }
  return hash.digest('hex').slice(0, 16);
}

function safeAll(db, sql, params = []) {
  if (!db?.prepare) return [];
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function buildCalibSnapshotId(db, fallback = null) {
  if (fallback) return fallback;
  if (process.env.SCOUT_CALIB_SNAPSHOT_ID) return process.env.SCOUT_CALIB_SNAPSHOT_ID;
  const calibRows = safeAll(db, `
    SELECT engine, family, direction, liga,
           lambda_mult, confidence_factor, line_shift,
           ewma_hr, ewma_brier, clv_score, isotonic_version,
           sample_size, updated_at
      FROM calib_state
     ORDER BY engine, family, direction, liga
  `);
  const isotonicRows = safeAll(db, `
    SELECT family, liga, period, direction, n_samples, fit_at, hex(blob_bytes) AS blob_hex
      FROM isotonic_blob
     ORDER BY family, liga, period, direction
  `);
  if (calibRows.length === 0 && isotonicRows.length === 0) return null;
  return shortHash({ calib_state: calibRows, isotonic_blob: isotonicRows });
}

function buildDataSnapshotHash(dataSnapshot, fallback = null) {
  if (process.env.SCOUT_DATA_SNAPSHOT_HASH) return process.env.SCOUT_DATA_SNAPSHOT_HASH;
  if (fallback) return fallback;
  if (!dataSnapshot) return null;
  return shortHash(dataSnapshot);
}

export function buildSignature({ db = null, calibSnapshotId = null, dataSnapshot = null, dataSnapshotHash = null } = {}) {
  const resolvedCalibSnapshotId = buildCalibSnapshotId(db, calibSnapshotId);
  const resolvedDataSnapshotHash = buildDataSnapshotHash(dataSnapshot, dataSnapshotHash);
  const sig = {
    motor_version: MOTOR_VERSION,
    model_a_version: ENGINE_A_VERSION,
    model_b_version: ENGINE_B_VERSION,
    curinga_version: CURINGA_VERSION,
    evidence_version: EVIDENCE_VERSION,
    isotonic_version: ISOTONIC_VERSION,
    scout_version: SCOUT_VERSION,
    calib_snapshot_id: resolvedCalibSnapshotId,
    quality_gates_version: QG_VERSION,
    calibration_version: CALIBRATION_VERSION,
    markets_catalog_version: MARKETS_VERSION,
    quality_gates_hash: hashFile('config/quality-gates.json'),
    markets_registry_hash: hashFile('packages/markets/src/registry.mjs'),
    model_b_artifacts_hash: hashModelArtifacts(),
    data_snapshot_hash: resolvedDataSnapshotHash,
  };
  sig.hash = shortHash(sig);
  return sig;
}
