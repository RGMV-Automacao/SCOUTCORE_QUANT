import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB || 'data/scout_extraction.db', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
console.log('TABLES:', tables.join(', '));
for (const n of ['partidas','eventos_faixa','match','team_profile_v2','prediction']) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${n})`).all();
    console.log(`\n${n}: ${cols.map(c=>c.name+':'+c.type).join(', ')}`);
    const sample = db.prepare(`SELECT * FROM ${n} LIMIT 1`).get();
    if (sample) console.log('  sample keys:', Object.keys(sample).join(','));
  } catch(e) { console.log(`${n}: ${e.message}`); }
}
// Show eventos_faixa distinct kinds
try {
  const kinds = db.prepare(`SELECT DISTINCT faixa FROM eventos_faixa LIMIT 30`).all();
  console.log('\nfaixa values:', kinds.map(k=>k.faixa).join(','));
  const ev = db.prepare(`SELECT * FROM eventos_faixa LIMIT 3`).all();
  console.log('\neventos_faixa sample row 1:', ev[0]);
} catch(e) { console.log('eventos_faixa probe:', e.message); }
