import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB, { readonly: true });
const home = process.argv[2] || 'Bahia';
const away = process.argv[3] || 'Atlético Mineiro';
const date = process.argv[4] || '2026-12-02';

const rows = db.prepare(`
  SELECT mercado, selecao, linha, COUNT(*) c, MIN(odd) min_odd, MAX(odd) max_odd
  FROM odds
  WHERE home_team = ? AND away_team = ? AND data_jogo = ?
  GROUP BY mercado, selecao, linha
  ORDER BY mercado, linha
`).all(home, away, date);
console.log(`mercados Superbet ${home}×${away} ${date}: ${rows.length}`);
const families = new Set();
for (const r of rows) {
  console.log(`  [${r.mercado}] ${r.selecao} ${r.linha} | n=${r.c} odd=${r.min_odd}..${r.max_odd}`);
  families.add(r.mercado);
}
console.log(`\nfamílias distintas: ${families.size}`);
db.close();
