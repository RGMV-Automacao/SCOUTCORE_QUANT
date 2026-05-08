import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB, { readonly: true });
for (const t of ['odds','odds_historico','odds_coletas','odds_valuebets']) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all();
    const n = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get();
    console.log(`\n${t} (n=${n.c}):`, cols.map(c=>c.name).join(','));
    const sample = db.prepare(`SELECT * FROM ${t} LIMIT 2`).all();
    console.log('sample:', JSON.stringify(sample, null, 2).slice(0, 1000));
  } catch (e) { console.log(t, 'ERR', e.message); }
}
db.close();
