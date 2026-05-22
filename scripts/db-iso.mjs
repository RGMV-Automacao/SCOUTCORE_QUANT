import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB || 'data/scout_extraction.db', { readonly: true });
console.log(db.prepare("SELECT sql FROM sqlite_master WHERE name='isotonic_blob'").get().sql);
