import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('tables:', tables.map(t => t.name));
for (const candidate of ['confronto_v2', 'partidas', 'matches', 'match', 'confrontos']) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${candidate})`).all();
    if (cols.length) console.log(`\n${candidate} cols:`, cols.map(c => c.name).join(','));
  } catch (e) {}
}
db.close();
