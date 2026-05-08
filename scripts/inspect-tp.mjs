import Database from 'better-sqlite3';
const path = process.env.SCOUT_DB || 'data/scout.db';
const db = new Database(path, { readonly: true });
const rows = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name IN ('team_profiles','eventos_faixa')").all();
console.log(JSON.stringify(rows, null, 2));
console.log('triggers ref team_profiles:');
console.log(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%team_profiles%'").all());
