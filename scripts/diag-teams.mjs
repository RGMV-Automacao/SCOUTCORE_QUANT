import 'dotenv/config';
import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB);
console.log(db.prepare("SELECT DISTINCT team FROM team_profile_v2 WHERE liga='brasileirao' AND temporada='2025' AND side='home' ORDER BY team LIMIT 8").all());
console.log(db.prepare("SELECT * FROM league_priors WHERE liga='brasileirao' AND temporada='2025'").all());
