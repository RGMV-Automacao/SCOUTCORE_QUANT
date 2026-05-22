import 'dotenv/config';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const DEFAULT_EXTRACTION_DB = join('data', 'scout_extraction.db');
export const DEFAULT_EXTRACTION_MIGRATIONS_DIR = join('migrations', 'extraction');

const REQUIRED_SCHEMA = {
  extraction_schema_version: ['version', 'name', 'checksum', 'applied_at'],
  extracoes_log: ['run_id', 'job_name', 'source_system', 'status', 'started_at', 'status_certificacao'],
  partidas: ['id_confronto', 'liga', 'temporada', 'id_liga', 'rodada', 'confronto', 'home_team', 'away_team', 'data_partida', 'hora_partida', 'data_brasil', 'hora_brasil', 'competition_id', 'estadio', 'arbitro_principal', 'publico', 'formacao_casa', 'formacao_fora', 'processado_stats', 'processado_odds', 'status_certificacao'],
  times: ['id_confronto', 'liga', 'id_liga', 'temporada', 'confronto', 'time', 'rodada', 'side', 'modo', 'status', 'gols', 'assistencias', 'escanteios', 'chutes', 'chutes_no_alvo', 'chutes_bloqueados', 'passes', 'desarmes', 'faltas', 'faltas_cometidas', 'faltas_sofridas', 'defesas', 'escanteios_sofridos', 'chutes_sofridos', 'chutes_noalvo_sofridos', 'posse', 'passes_certos', 'desarmes_certos', 'clean_sheet'],
  confronto: ['id_confronto', 'liga', 'id_liga', 'temporada', 'confronto', 'rodada', 'modo', 'status', 'total_gols', 'total_escanteios', 'total_chutes', 'gols', 'assistencias', 'escanteios', 'chutes', 'chutes_no_alvo', 'chutes_bloqueados', 'passes', 'desarmes', 'faltas_cometidas', 'faltas_sofridas', 'defesas'],
  eventos_faixa: ['id_confronto', 'liga', 'temporada', 'time', 'faixa', 'minuto_inicio', 'minuto_fim'],
  jogadores: ['id_confronto', 'liga', 'temporada', 'time', 'jogador', 'modo', 'gols', 'assistencias', 'chutes', 'passes', 'minutos', 'titular', 'player_id', 'posicao'],
  arbitros: ['statsline_id', 'nome', 'primeiro_nome', 'sobrenome', 'jogos_apitados', 'media_amarelos', 'media_vermelhos'],
  partida_arbitro: ['id_confronto', 'statsline_id', 'tipo', 'nome'],
  odds_coletas: ['coleta_id', 'source_system', 'liga', 'janela_inicio', 'janela_fim', 'status'],
  odds: ['quote_key', 'snapshot_id', 'quote_signature', 'id_confronto', 'source_event_id', 'liga', 'home_team', 'away_team', 'mercado_key', 'selecao', 'linha', 'odd'],
  odds_historico: ['id', 'quote_key', 'snapshot_id', 'quote_signature', 'coleta_id', 'old_odd', 'new_odd', 'delta'],
  certificacao_extracao: ['certification_id', 'run_id', 'scope', 'liga', 'temporada', 'status', 'checks_total', 'checks_passed', 'checks_failed'],
  certificacao_liga: ['liga', 'temporada', 'status', 'statsline_status', 'bookline_status', 'last_certification_id'],
};

const REQUIRED_INDEXES = {
  partidas: ['idx_partidas_liga_data', 'idx_partidas_certificacao', 'idx_partidas_data_brasil'],
  times: ['idx_times_liga_time_modo'],
  confronto: ['idx_confronto_liga_modo'],
  eventos_faixa: ['idx_eventos_faixa_liga_faixa'],
  jogadores: ['idx_jogadores_liga_temporada', 'idx_jogadores_confronto', 'idx_jogadores_jogador', 'idx_jogadores_player_id'],
  arbitros: ['idx_arbitros_nome'],
  partida_arbitro: ['idx_partida_arbitro_partida', 'idx_partida_arbitro_statsline'],
  odds: ['idx_odds_match_market', 'idx_odds_liga_data', 'ux_odds_snapshot_id', 'idx_odds_quote_signature_time', 'idx_odds_coleta_cert'],
  odds_historico: ['idx_odds_historico_quote_time', 'idx_odds_historico_signature_time', 'idx_odds_historico_coleta'],
  extracoes_log: ['idx_extracoes_log_source_status'],
  odds_coletas: ['idx_odds_coletas_liga_status'],
  certificacao_extracao: ['idx_certificacao_scope_status'],
};

export function resolveExtractionDbPath(dbPath = process.env.SCOUT_DB || process.env.SCOUT_EXTRACTION_DB || DEFAULT_EXTRACTION_DB) {
  return isAbsolute(dbPath) ? dbPath : resolve(process.cwd(), dbPath);
}

export function resolveExtractionMigrationsDir(migrationsDir = DEFAULT_EXTRACTION_MIGRATIONS_DIR) {
  return isAbsolute(migrationsDir) ? migrationsDir : resolve(process.cwd(), migrationsDir);
}

function checksumSql(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

function listMigrationFiles(migrationsDir) {
  if (!existsSync(migrationsDir)) throw new Error(`Diretorio de migrations nao encontrado: ${migrationsDir}`);
  return readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
}

function ensureVersionTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS extraction_schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

export function openExtractionDb(dbPath, opts = {}) {
  if (opts.create !== false) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath, { readonly: opts.readonly === true });
  if (opts.readonly !== true) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function checkpointExtractionDb(db, mode = 'TRUNCATE') {
  const safeMode = String(mode || 'TRUNCATE').toUpperCase();
  if (!['PASSIVE', 'FULL', 'RESTART', 'TRUNCATE'].includes(safeMode)) {
    throw new Error(`checkpoint_mode_invalido:${mode}`);
  }
  const result = db.pragma(`wal_checkpoint(${safeMode})`);
  const row = Array.isArray(result) ? result[0] : result;
  return {
    mode: safeMode,
    busy: Number(row?.busy ?? 0),
    log: Number(row?.log ?? 0),
    checkpointed: Number(row?.checkpointed ?? 0),
  };
}

export function applyExtractionMigrations(options = {}) {
  const dbPath = resolveExtractionDbPath(options.dbPath);
  const migrationsDir = resolveExtractionMigrationsDir(options.migrationsDir);
  const db = openExtractionDb(dbPath);
  ensureVersionTable(db);

  const appliedRows = db.prepare('SELECT version, checksum FROM extraction_schema_version').all();
  const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));
  const appliedNow = [];
  const skipped = [];

  for (const file of listMigrationFiles(migrationsDir)) {
    const version = Number(file.match(/^(\d+)_/)?.[1]);
    if (!Number.isInteger(version) || version <= 0) throw new Error(`Migration invalida: ${file}`);

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const checksum = checksumSql(sql);
    const previousChecksum = applied.get(version);

    if (previousChecksum) {
      if (previousChecksum !== checksum) {
        throw new Error(`Checksum divergente para migration ${file}. Banco=${previousChecksum} arquivo=${checksum}`);
      }
      skipped.push({ version, name: file });
      continue;
    }

    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare(`
        INSERT INTO extraction_schema_version(version, name, checksum)
        VALUES (?, ?, ?)
      `).run(version, file, checksum);
    });
    tx();
    appliedNow.push({ version, name: file });
  }

  const pragmas = {
    journal_mode: db.pragma('journal_mode', { simple: true }),
    foreign_keys: db.pragma('foreign_keys', { simple: true }),
  };
  db.close();

  return { dbPath, migrationsDir, applied: appliedNow, skipped, pragmas };
}

function addCheck(checks, name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
}

export function auditExtractionSchema(options = {}) {
  const dbPath = resolveExtractionDbPath(options.dbPath);
  if (!existsSync(dbPath)) {
    return {
      ok: false,
      dbPath,
      checks: [{ name: 'db_exists', ok: false, detail: `Banco nao encontrado: ${dbPath}` }],
    };
  }

  const db = openExtractionDb(dbPath, { readonly: true, create: false });
  const checks = [];

  const journalMode = db.pragma('journal_mode', { simple: true });
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  addCheck(checks, 'pragma_journal_mode_wal', String(journalMode).toLowerCase() === 'wal', `journal_mode=${journalMode}`);
  addCheck(checks, 'pragma_foreign_keys_on', Number(foreignKeys) === 1, `foreign_keys=${foreignKeys}`);

  const tables = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `).all().map((row) => row.name));

  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA)) {
    addCheck(checks, `table:${table}`, tables.has(table));
    if (!tables.has(table)) continue;

    const actualColumns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    for (const column of columns) {
      addCheck(checks, `column:${table}.${column}`, actualColumns.has(column));
    }
  }

  for (const [table, indexes] of Object.entries(REQUIRED_INDEXES)) {
    if (!tables.has(table)) continue;
    const actualIndexes = new Set(db.prepare(`PRAGMA index_list(${table})`).all().map((row) => row.name));
    for (const index of indexes) {
      addCheck(checks, `index:${index}`, actualIndexes.has(index), table);
    }
  }

  const versionRow = tables.has('extraction_schema_version')
    ? db.prepare('SELECT COUNT(*) AS count FROM extraction_schema_version').get()
    : { count: 0 };
  addCheck(checks, 'migration_version_recorded', versionRow.count >= 1, `versions=${versionRow.count}`);

  db.close();
  return {
    ok: checks.every((check) => check.ok),
    dbPath,
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.ok).length,
      failed: checks.filter((check) => !check.ok).length,
    },
  };
}
