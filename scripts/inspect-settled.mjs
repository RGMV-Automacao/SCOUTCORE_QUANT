import Database from 'better-sqlite3';
const db = new Database(process.env.SCOUT_DB || 'data/scout_extraction.db', { readonly: true });

console.log('\n=== Settlement por result ===');
const res = db.prepare(`SELECT result, COUNT(*) n FROM prediction GROUP BY result`).all();
console.table(res);

console.log('\n=== Por (family, direction) ===');
const fam = db.prepare(`
  SELECT family, direction, period, scope,
         SUM(CASE WHEN result='green' THEN 1 ELSE 0 END) g,
         SUM(CASE WHEN result='red'   THEN 1 ELSE 0 END) r,
         SUM(CASE WHEN result IS NULL THEN 1 ELSE 0 END) skip,
         COUNT(*) total
  FROM prediction GROUP BY family, direction, period, scope ORDER BY family, period
`).all();
console.table(fam);

console.log('\n=== calib_state populado ===');
const calib = db.prepare(`SELECT family, direction, liga, lambda_mult, confidence_factor, ewma_hr, sample_size FROM calib_state ORDER BY sample_size DESC`).all();
console.table(calib);

console.log('\n=== Slots não-resolvidos (skipped) — primeiras 10 ===');
const sk = db.prepare(`SELECT family, scope, period, direction, line, market_key FROM prediction WHERE result IS NULL LIMIT 10`).all();
console.table(sk);

console.log('\n=== Sanity: gols/total/FT ===  (Palmeiras 1-0 → total=1)');
const goalsFT = db.prepare(`SELECT market_key, line, fair_prob, result FROM prediction WHERE family='gols' AND scope='total' AND period='FT' AND direction IN ('over','under') ORDER BY line`).all();
console.table(goalsFT);
