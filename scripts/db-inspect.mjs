import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB || 'data/scout_extraction.db', { readonly: true });
console.log('tables:', db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name));
const tabExists = (n) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
if (tabExists('prediction')) {
  console.log('prediction total:', db.prepare('SELECT COUNT(*) c FROM prediction').get().c);
  console.log('cols:', db.prepare('PRAGMA table_info(prediction)').all().map(c => c.name));
  // count settled by name detected
  const cols = db.prepare('PRAGMA table_info(prediction)').all().map(c => c.name);
  for (const cand of ['outcome', 'result', 'settled', 'resolved', 'pred_outcome']) {
    if (cols.includes(cand)) {
      console.log(`settled (col=${cand}):`, db.prepare(`SELECT COUNT(*) c FROM prediction WHERE ${cand} IS NOT NULL`).get().c);
    }
  }
}
if (tabExists('match')) {
  console.log('match total:', db.prepare('SELECT COUNT(*) c FROM match').get().c);
  console.log('match cols:', db.prepare('PRAGMA table_info(match)').all().map(c => c.name));
}
if (tabExists('calib_state')) {
  console.log('calib_state rows:', db.prepare('SELECT COUNT(*) c FROM calib_state').get().c);
}
