const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.resolve('C:\\Users\\Rogerio\\Desktop\\RGMV_PROJETOS\\SOLUCAO_IA\\opta-extractor\\db\\opta.db');
const db = new Database(dbPath, { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('=== TABELAS ===');
for (const t of tables) console.log(t.name);

const oddsLike = tables.filter(t => /odd|book|price|market|line|super/i.test(t.name));
console.log('\n=== TABELAS RELACIONADAS A ODDS/MERCADO ===');
for (const t of oddsLike) {
  const cnt = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c;
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
  console.log(`\n[${t.name}] rows=${cnt}`);
  console.log('  cols:', cols.map(c => `${c.name}:${c.type}`).join(', '));
  if (cnt > 0) {
    const sample = db.prepare(`SELECT * FROM "${t.name}" LIMIT 1`).get();
    console.log('  sample:', JSON.stringify(sample).slice(0, 300));
  }
}

db.close();
