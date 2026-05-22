import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyExtractionMigrations,
  auditExtractionSchema,
} from '../../../scripts/lib/extraction-db.mjs';

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scq-extraction-'));
  const dbPath = join(dir, 'scout_extraction.db');
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('extraction migrations create a certified SQLite schema and rerun cleanly', () => withTempDb((dbPath) => {
  const first = applyExtractionMigrations({ dbPath });
  assert.ok(first.applied.length >= 2);
  assert.equal(first.skipped.length, 0);
  assert.equal(first.pragmas.journal_mode, 'wal');
  assert.equal(first.pragmas.foreign_keys, 1);

  const second = applyExtractionMigrations({ dbPath });
  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped.length, first.applied.length);

  const audit = auditExtractionSchema({ dbPath });
  assert.equal(audit.ok, true);
  assert.equal(audit.summary.failed, 0);

  const db = new Database(dbPath, { readonly: true });
  const timesCols = new Set(db.prepare('PRAGMA table_info(times)').all().map((row) => row.name));
  const confrontoCols = new Set(db.prepare('PRAGMA table_info(confronto)').all().map((row) => row.name));
  assert.equal(timesCols.has('desarmes'), true);
  assert.equal(timesCols.has('passes_certos'), true);
  assert.equal(timesCols.has('clean_sheet'), true);
  assert.equal(confrontoCols.has('assistencias'), true);
  assert.equal(confrontoCols.has('desarmes'), true);
  db.close();
}));

test('extraction schema enforces idempotent match and quote identities', () => withTempDb((dbPath) => {
  applyExtractionMigrations({ dbPath });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  db.prepare(`
    INSERT INTO extracoes_log(run_id, job_name, source_system, liga, temporada, status)
    VALUES ('run-1', 'test-statsline', 'statsline', 'brasileirao', '2026', 'ok')
  `).run();

  const upsertMatch = db.prepare(`
    INSERT INTO partidas(id_confronto, liga, temporada, home_team, away_team, data_partida, processado_stats, run_id)
    VALUES ('m1', 'brasileirao', '2026', 'Home', 'Away', '2026-05-17', 0, 'run-1')
    ON CONFLICT(id_confronto) DO UPDATE SET
      processado_stats = excluded.processado_stats,
      atualizado_em = datetime('now')
  `);
  upsertMatch.run();
  db.prepare(`
    INSERT INTO partidas(id_confronto, liga, temporada, home_team, away_team, data_partida, processado_stats, run_id)
    VALUES ('m1', 'brasileirao', '2026', 'Home', 'Away', '2026-05-17', 1, 'run-1')
    ON CONFLICT(id_confronto) DO UPDATE SET
      processado_stats = excluded.processado_stats,
      atualizado_em = datetime('now')
  `).run();

  assert.deepEqual(
    db.prepare('SELECT COUNT(*) AS count, MAX(processado_stats) AS processed FROM partidas').get(),
    { count: 1, processed: 1 },
  );

  db.prepare(`
    INSERT INTO odds_coletas(coleta_id, liga, janela_inicio, janela_fim, status)
    VALUES ('coleta-1', 'brasileirao', '2026-05-17', '2026-05-17', 'ok')
  `).run();

  const upsertQuote = db.prepare(`
    INSERT INTO odds(quote_key, id_confronto, liga, home_team, away_team, mercado_key, mercado, selecao, linha, odd, coleta_id)
    VALUES ('bookline:m1:gols_total_ft_over_2_5:over:2.5', 'm1', 'brasileirao', 'Home', 'Away', 'gols_total_ft_over_2_5', 'Total de Gols', 'Over', '2.5', ?, 'coleta-1')
    ON CONFLICT(quote_key) DO UPDATE SET
      odd = excluded.odd,
      coleta_id = excluded.coleta_id,
      atualizado_em = datetime('now')
  `);
  upsertQuote.run(1.91);
  upsertQuote.run(1.88);

  assert.deepEqual(
    db.prepare('SELECT COUNT(*) AS count, MAX(odd) AS odd FROM odds').get(),
    { count: 1, odd: 1.88 },
  );

  db.close();
}));

test('extraction schema includes idempotent player and referee contracts', () => withTempDb((dbPath) => {
  applyExtractionMigrations({ dbPath });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  db.prepare(`
    INSERT INTO extracoes_log(run_id, job_name, source_system, liga, temporada, status)
    VALUES ('run-players', 'test-statsline', 'statsline', 'brasileirao', '2026', 'ok')
  `).run();
  db.prepare(`
    INSERT INTO partidas(id_confronto, liga, temporada, home_team, away_team, data_partida, run_id)
    VALUES ('m-players', 'brasileirao', '2026', 'Home', 'Away', '2026-05-17', 'run-players')
  `).run();

  const upsertPlayer = db.prepare(`
    INSERT INTO jogadores(id_confronto, liga, temporada, time, jogador, modo, minutos, titular, player_id, posicao, run_id)
    VALUES ('m-players', 'brasileirao', '2026', 'Home', 'Player One', 'FT', ?, 1, 'p1', 'FW', 'run-players')
    ON CONFLICT(id_confronto, jogador, time, modo) DO UPDATE SET
      minutos = excluded.minutos,
      atualizado_em = datetime('now')
  `);
  upsertPlayer.run(45);
  upsertPlayer.run(90);

  db.prepare(`
    INSERT INTO arbitros(statsline_id, nome, primeiro_nome, sobrenome, run_id)
    VALUES ('ref1', 'Ref One', 'Ref', 'One', 'run-players')
    ON CONFLICT(statsline_id) DO UPDATE SET
      nome = excluded.nome,
      atualizado_em = datetime('now')
  `).run();
  db.prepare(`
    INSERT INTO partida_arbitro(id_confronto, statsline_id, tipo, nome, run_id)
    VALUES ('m-players', 'ref1', 'Main', 'Ref One', 'run-players')
    ON CONFLICT(id_confronto, statsline_id, tipo) DO UPDATE SET
      nome = excluded.nome,
      atualizado_em = datetime('now')
  `).run();

  assert.deepEqual(
    db.prepare('SELECT COUNT(*) AS count, MAX(minutos) AS minutos FROM jogadores').get(),
    { count: 1, minutos: 90 },
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM arbitros').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM partida_arbitro').get().count, 1);

  db.close();
}));
