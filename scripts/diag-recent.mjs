import Database from 'better-sqlite3';
const opta = new Database('C:\\Users\\Rogerio\\Desktop\\RGMV_PROJETOS\\SOLUCAO_IA\\opta-extractor\\db\\opta.db', { readonly: true, fileMustExist: true });
const scout = new Database('C:\\Users\\Rogerio\\Desktop\\RGMV_PROJETOS\\SCOUTCORE_QUANT\\data\\scout.db', { readonly: true });

console.log('--- TOTAL eventos_faixa ---');
console.log('opta :', opta.prepare('SELECT count(*) c FROM eventos_faixa').get().c);
console.log('scout:', scout.prepare('SELECT count(*) c FROM eventos_faixa').get().c);

console.log('\n--- TOTAL eventos_faixa BRASILEIRAO ---');
console.log('opta :', opta.prepare("SELECT count(*) c FROM eventos_faixa WHERE liga='brasileirao'").get().c);
console.log('scout:', scout.prepare("SELECT count(*) c FROM eventos_faixa WHERE liga='brasileirao'").get().c);

console.log('\n--- INSERTS RECENTES (ultimos 30 min) ---');
console.log('opta eventos_faixa por liga:');
console.log(opta.prepare("SELECT liga, count(*) c, MAX(criado_em) m FROM eventos_faixa WHERE criado_em > datetime('now','-30 minutes') GROUP BY liga ORDER BY c DESC").all());

console.log('opta partidas por liga:');
console.log(opta.prepare("SELECT liga, count(*) c, MAX(criado_em) m FROM partidas WHERE criado_em > datetime('now','-30 minutes') GROUP BY liga ORDER BY c DESC").all());

console.log('opta odds por liga:');
console.log(opta.prepare("SELECT liga, count(*) c, MAX(criado_em) m FROM odds WHERE criado_em > datetime('now','-30 minutes') GROUP BY liga ORDER BY c DESC").all());

console.log('\n--- LAST criado_em ---');
console.log('opta partidas      :', opta.prepare('SELECT MAX(criado_em) m FROM partidas').get().m);
console.log('scout partidas     :', scout.prepare('SELECT MAX(criado_em) m FROM partidas').get().m);
console.log('opta eventos_faixa :', opta.prepare('SELECT MAX(criado_em) m FROM eventos_faixa').get().m);
console.log('scout eventos_faixa:', scout.prepare('SELECT MAX(criado_em) m FROM eventos_faixa').get().m);
console.log('opta odds          :', opta.prepare('SELECT MAX(criado_em) m FROM odds').get().m);
console.log('scout odds         :', scout.prepare('SELECT MAX(criado_em) m FROM odds').get().m);
