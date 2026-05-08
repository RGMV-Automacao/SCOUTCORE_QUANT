// SCOUTCORE_QUANT — Setup script: copia opta.db legacy → data/scout.db
// Roda UMA VEZ no boot inicial. Idempotente: aborta se scout.db já existe.

import 'dotenv/config';
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = process.env.OPTA_LEGACY_DB;
const DST = process.env.SCOUT_DB;

if (!SRC || !DST) {
  console.error('[setup-copy-legacy] Falta OPTA_LEGACY_DB ou SCOUT_DB no .env');
  process.exit(1);
}

if (!existsSync(SRC)) {
  console.error(`[setup-copy-legacy] Source não existe: ${SRC}`);
  process.exit(1);
}

if (existsSync(DST)) {
  console.error(`[setup-copy-legacy] Destino JÁ EXISTE: ${DST}`);
  console.error('Para refazer, apague o arquivo manualmente. Cópia inicial é one-time.');
  process.exit(2);
}

mkdirSync(dirname(DST), { recursive: true });

console.log(`[setup-copy-legacy] Copiando ${SRC} -> ${DST}`);
const start = Date.now();
copyFileSync(SRC, DST);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
const sizeMb = (statSync(DST).size / 1024 / 1024).toFixed(0);

console.log(`[setup-copy-legacy] OK — ${sizeMb} MB em ${elapsed}s`);
console.log('[setup-copy-legacy] Próximo passo: npm run setup:wipe-state');
