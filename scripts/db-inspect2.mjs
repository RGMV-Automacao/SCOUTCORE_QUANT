import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB || 'data/scout_extraction.db', { readonly: true });
console.log('result dist:', db.prepare('SELECT result, COUNT(*) c FROM prediction GROUP BY result').all());
console.log('by family:', db.prepare('SELECT family, COUNT(*) c FROM prediction GROUP BY family').all());
console.log('isotonic_blob cols:', db.prepare('PRAGMA table_info(isotonic_blob)').all().map(c => c.name));
console.log('isotonic_blob rows:', db.prepare('SELECT COUNT(*) c FROM isotonic_blob').get().c);
console.log('confronto cols:', db.prepare('PRAGMA table_info(confronto)').all().map(c => c.name));
console.log('confronto rows:', db.prepare('SELECT COUNT(*) c FROM confronto').get().c);
console.log('partidas rows:', db.prepare('SELECT COUNT(*) c FROM partidas').get().c);
