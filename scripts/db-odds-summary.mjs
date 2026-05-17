import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB, { readonly: true });
const r1 = db.prepare(`SELECT DISTINCT liga FROM odds`).all();
console.log('ligas em odds:', r1.map(x=>x.liga));
const r2 = db.prepare(`SELECT DISTINCT home_team, away_team, data_jogo FROM odds WHERE liga LIKE '%brasil%' ORDER BY data_jogo DESC LIMIT 10`).all();
console.log('top 10 brasileiro:', r2);
const r3 = db.prepare(`SELECT COUNT(DISTINCT home_team || away_team || data_jogo) AS n_matches FROM odds WHERE liga LIKE '%brasil%'`).get();
console.log('total matches brasileiro com odds:', r3);
db.close();
