import 'dotenv/config';
import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB);
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
console.log('tables:', tables);
try { console.log('schema_version:', db.prepare('SELECT * FROM schema_version').all()); }
catch (e) { console.log('schema_version err:', e.message); }
