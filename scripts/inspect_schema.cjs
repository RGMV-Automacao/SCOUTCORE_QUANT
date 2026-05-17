const Database = require('better-sqlite3');
const path = require('path');
const dbPath = 'C:\\Users\\Rogerio\\Desktop\\RGMV_PROJETOS\\SOLUCAO_IA\\opta-extractor\\db\\opta.db';
const db = new Database(dbPath, { readonly: true });

const TARGETS = [
  'predictions', 'ml_predictions', 'odds_historico', 'odds',
  'calibration_states', 'motor_runs', 'motor_boards', 'eventos_faixa',
  'partidas', 'team_profiles', 'banca_apostas', 'tips'
];

for (const t of TARGETS) {
  console.log('\n=========================================');
  console.log('TABLE:', t);
  console.log('=========================================');
  try {
    const cnt = db.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get().c;
    console.log('rows:', cnt);
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
    console.log('columns:');
    for (const c of cols) {
      console.log(`  ${c.name.padEnd(30)} ${c.type.padEnd(12)} ${c.pk ? 'PK' : ''} ${c.notnull ? 'NN' : ''}`);
    }
    if (cnt > 0) {
      const sample = db.prepare(`SELECT * FROM "${t}" ORDER BY ROWID DESC LIMIT 1`).get();
      console.log('most recent row:');
      for (const [k, v] of Object.entries(sample)) {
        const s = String(v).slice(0, 120);
        console.log(`  ${k.padEnd(30)} = ${s}`);
      }
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

// Quick brier viability check
console.log('\n=========================================');
console.log('BRIER DIFFERENTIAL VIABILITY CHECK');
console.log('=========================================');
try {
  const predCols = db.prepare("PRAGMA table_info(predictions)").all().map(c => c.name);
  const hasProbA = predCols.includes('prob_a');
  const hasProbB = predCols.includes('prob_b');
  const hasFairOdd = predCols.includes('fair_odd_curinga');
  console.log('predictions has prob_a?', hasProbA);
  console.log('predictions has prob_b?', hasProbB);
  console.log('predictions has fair_odd_curinga?', hasFairOdd);
  if (hasProbA && hasProbB) {
    const settled = db.prepare("SELECT COUNT(*) as c FROM predictions WHERE prob_a IS NOT NULL AND prob_b IS NOT NULL").get().c;
    console.log('predictions com prob_a + prob_b:', settled);
  }
} catch (e) {
  console.log('ERROR:', e.message);
}

db.close();
