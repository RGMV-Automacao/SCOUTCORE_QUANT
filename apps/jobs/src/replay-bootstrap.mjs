// SCOUTCORE_QUANT — Replay Bootstrap (Opção B)
// One-time. Roda Engine A + Engine B em todas as partidas finalizadas
// para popular clv_history retroativo. Estimativa: ~10 dias.

import 'dotenv/config';
import Database from 'better-sqlite3';

console.log('[replay-bootstrap] STUB — implementação real depende de:');
console.log('  - packages/engine-a (Poisson)');
console.log('  - packages/engine-b-bridge (sidecar Python XGB+LGBM)');
console.log('  - packages/markets (catálogo SemVer com 479 mercados)');
console.log('  - packages/data-access (PIT enforced feature snapshot)');
console.log('  - packages/evidence (Evidence Pack P8)');
console.log('');
console.log('Ver SCOUTCORE_SPEC.md §17.4 para o algoritmo completo.');

// const db = new Database(process.env.SCOUT_DB);
// const partidas = db.prepare(`
//   SELECT id_confronto, home_team, away_team, league, season, kickoff
//   FROM partidas
//   WHERE finalizado = 1
//   ORDER BY kickoff ASC
// `).all();
// 
// for (const p of partidas) {
//   const snap = await buildFeatureSnapshotPIT(p.id_confronto, p.kickoff);
//   const predA = await engineA.predict(snap);
//   const predB = await engineB.predict(snap);
//   const result = await settle(p.id_confronto);
//   db.prepare(`INSERT INTO clv_history ...`).run(...);
// }

process.exit(0);
