import 'dotenv/config';
import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB);
for (const t of ['partidas', 'eventos_faixa', 'team_profiles', 'odds', 'odds_historico']) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  console.log(`${t}:`, cols.join(','));
}
