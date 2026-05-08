// engine-signature.mjs — versões + hash determinístico do estado do motor.

import { createHash } from 'node:crypto';
import { ENGINE_A_VERSION } from '@scoutcore/engine-a';
import { CURINGA_VERSION } from '@scoutcore/curinga';
import { ENGINE_B_VERSION } from '@scoutcore/engine-b-bridge';
import { MARKETS_VERSION } from '@scoutcore/markets';
import { EVIDENCE_VERSION } from '@scoutcore/evidence';
import { QG_VERSION } from '@scoutcore/quality-gates';
import { CALIBRATION_VERSION } from '@scoutcore/calibration';

export const MOTOR_VERSION = '0.5.0';

export function buildSignature({ calibSnapshotId = null } = {}) {
  const sig = {
    motor_version: MOTOR_VERSION,
    model_a_version: ENGINE_A_VERSION,
    model_b_version: ENGINE_B_VERSION,
    curinga_version: CURINGA_VERSION,
    evidence_version: EVIDENCE_VERSION,
    isotonic_version: null,
    calib_snapshot_id: calibSnapshotId,
    quality_gates_version: QG_VERSION,
    calibration_version: CALIBRATION_VERSION,
    markets_catalog_version: MARKETS_VERSION,
    data_snapshot_hash: null,
  };
  const canonical = JSON.stringify(sig, Object.keys(sig).sort());
  sig.hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return sig;
}
