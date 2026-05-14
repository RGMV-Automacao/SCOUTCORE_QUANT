-- ============================================================
-- MIGRATION 004 — Remove schema drift from early MVP tables
-- ============================================================
-- `motor_run_v2` and `calib_state_v2` were created by migration 001,
-- but the runtime writes to `motor_run`, `prediction`, `calib_state`,
-- and `clv_history`. `isotonic_blob` stays: packages/isotonic uses it.
-- ============================================================

DROP TABLE IF EXISTS motor_run_v2;
DROP TABLE IF EXISTS calib_state_v2;

INSERT OR IGNORE INTO schema_version (version) VALUES (4);
