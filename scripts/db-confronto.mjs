import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB || 'data/scout.db', { readonly: true });
console.log('confronto sample:');
console.log(db.prepare('SELECT id, liga, temporada, confronto, modo, status, gols, escanteios FROM confronto LIMIT 3').all());
console.log('partidas cols:', db.prepare('PRAGMA table_info(partidas)').all().map(c => c.name));
console.log('partidas sample:');
console.log(db.prepare('SELECT * FROM partidas LIMIT 2').all());
console.log('team_profile_v2 cols:', db.prepare('PRAGMA table_info(team_profile_v2)').all().map(c => c.name));
console.log('team_profile_v2 count:', db.prepare('SELECT COUNT(*) c FROM team_profile_v2').get().c);
