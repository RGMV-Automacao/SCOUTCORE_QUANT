// @scoutcore/data-access — SqliteMatchRepository
//
// Implementa a interface MatchRepository (SPEC §6.1) lendo do scout.db
// (legacy: partidas/eventos_faixa/team_profiles/odds; CORE: match/team_profile_v2/
// feature_snapshot/calib_state/motor_run).
//
// Princípios:
// - Read-mostly. Único write é saveMotorRun() e upserts em team_profile_v2/calib_state.
// - PIT: getTeamStats(team, liga, asOf) só usa partidas com data_partida < asOf.
// - Liga aliases: brasileirao↔brasileiro, etc. Mapeados aqui para reconciliar
//   o split casa/fora real do FutMax.

import Database from 'better-sqlite3';

const LIGA_ALIASES = {
  brasileirao: ['brasileirao', 'brasileiro'],
  brasileiro: ['brasileirao', 'brasileiro'],
  'la-liga': ['la-liga', 'laliga'],
  laliga: ['la-liga', 'laliga'],
  'serie-a': ['serie-a', 'serie-a-italia'],
  'serie-a-italia': ['serie-a', 'serie-a-italia'],
};

function ligasFor(liga) {
  return LIGA_ALIASES[liga] ?? [liga];
}

export class SqliteMatchRepository {
  /**
   * @param {string} dbPath caminho para scout.db
   * @param {{readonly?:boolean}} [opts]
   */
  constructor(dbPath, opts = {}) {
    this.db = new Database(dbPath, { readonly: opts.readonly === true });
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._prep();
  }

  _prep() {
    this.s = {
      getMatchByExt: this.db.prepare(`
        SELECT id_confronto AS external_id, liga, home_team AS home, away_team AS away,
               data_partida AS date, hora_partida AS hora,
               home_goals, away_goals, home_goals_ht, away_goals_ht, status, processado
          FROM partidas WHERE id_confronto = ? LIMIT 1`),

      getMatchesForTeam: this.db.prepare(`
        SELECT id_confronto, liga, home_team, away_team, data_partida, hora_partida,
               home_goals, away_goals, home_goals_ht, away_goals_ht, processado
          FROM partidas
         WHERE liga IN (SELECT value FROM json_each(?))
           AND (home_team = ? OR away_team = ?)
           AND date(data_partida) < date(?)
           AND processado = 1
         ORDER BY date(data_partida) DESC, hora_partida DESC
         LIMIT ?`),

      getEventBands: this.db.prepare(`
        SELECT time AS team_label, faixa, escanteios, chutes, chutes_no_alvo,
               faltas, cartoes_amarelos, cartoes_vermelhos, gols, impedimentos
          FROM eventos_faixa
         WHERE id_confronto = ?
         ORDER BY time, faixa`),

      getTeamProfileLegacy: this.db.prepare(`
        SELECT * FROM team_profiles
         WHERE team = ? AND liga IN (SELECT value FROM json_each(?))
           AND temporada = ? AND side = ?
         ORDER BY updated_at DESC LIMIT 1`),

      getTeamProfileV2: this.db.prepare(`
        SELECT payload, n, as_of, updated_at FROM team_profile_v2
         WHERE team = ? AND liga = ? AND temporada = ? AND side = ?
           AND date(as_of) <= date(?)
         ORDER BY date(as_of) DESC LIMIT 1`),

      getCalib: this.db.prepare(`
        SELECT * FROM calib_state WHERE engine = ? AND family = ? AND direction = ? AND liga = ?`),

      upsertTeamProfileV2: this.db.prepare(`
        INSERT INTO team_profile_v2(team, liga, temporada, side, as_of, n, payload, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(team, liga, temporada, side, as_of) DO UPDATE
           SET n = excluded.n, payload = excluded.payload, updated_at = excluded.updated_at`),

      saveRun: this.db.prepare(`
        INSERT INTO motor_run(run_id, match_id, engine_signature, request_payload, response_payload)
        VALUES (?, ?, ?, ?, ?)`),

      upsertCalib: this.db.prepare(`
        INSERT INTO calib_state(engine, family, direction, liga, ewma_hr, ewma_brier, clv_score,
                                isotonic_blob, isotonic_version, sample_size, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(engine, family, direction, liga) DO UPDATE SET
          ewma_hr = excluded.ewma_hr,
          ewma_brier = excluded.ewma_brier,
          clv_score = excluded.clv_score,
          isotonic_blob = excluded.isotonic_blob,
          isotonic_version = excluded.isotonic_version,
          sample_size = excluded.sample_size,
          updated_at = excluded.updated_at`),

      upsertLeaguePriors: this.db.prepare(`
        INSERT INTO league_priors(liga, temporada, period, payload, as_of, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(liga, temporada, period, as_of) DO UPDATE
           SET payload = excluded.payload, updated_at = excluded.updated_at`),

      getLeaguePriors: this.db.prepare(`
        SELECT payload, as_of FROM league_priors
         WHERE liga = ? AND temporada = ? AND period = ?
           AND date(as_of) <= date(?)
         ORDER BY date(as_of) DESC LIMIT 1`),

      insertPrediction: this.db.prepare(`
        INSERT OR IGNORE INTO prediction
          (run_id, match_id, match_date, liga, family, scope, period, direction,
           line, market_key, fair_prob, market_odd, edge_pct, confidence, certified, provenance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    };
  }

  capabilities() {
    return {
      pit: true,
      bands_resolution: '10min',
      legacy_team_profiles: true,
      writes: ['team_profile_v2', 'calib_state', 'motor_run', 'league_priors'],
    };
  }

  getMatch(externalId) {
    return this.s.getMatchByExt.get(externalId) ?? null;
  }

  /**
   * Lista jogos do time (qualquer side) ANTES de asOf, em ligas equivalentes.
   * @param {string} team
   * @param {string} liga
   * @param {string} asOfDate ISO YYYY-MM-DD (exclusivo)
   * @param {number} [limit=20]
   */
  getRecentMatches(team, liga, asOfDate, limit = 20) {
    const ligas = JSON.stringify(ligasFor(liga));
    return this.s.getMatchesForTeam.all(ligas, team, team, asOfDate, limit);
  }

  /**
   * Bandas 10min de um confronto (eventos_faixa).
   * Retorna { home: [9 bands], away: [9 bands] } com nulls se faltar.
   */
  getEventBands(externalId) {
    const rows = this.s.getEventBands.all(externalId);
    const grouped = { home: [], away: [], byTeam: {} };
    for (const r of rows) {
      const arr = grouped.byTeam[r.team_label] ??= [];
      arr.push(r);
    }
    return grouped;
  }

  /** team_profile_v2 com fallback para legacy team_profiles. */
  getTeamProfile({ team, liga, temporada, side, asOf }) {
    const v2 = this.s.getTeamProfileV2.get(team, liga, temporada, side, asOf);
    if (v2) {
      let payload = {};
      try { payload = JSON.parse(v2.payload); } catch { /* noop */ }
      return { source: 'v2', n: v2.n, as_of: v2.as_of, ...payload };
    }
    const ligas = JSON.stringify(ligasFor(liga));
    const legacy = this.s.getTeamProfileLegacy.get(team, ligas, temporada, side);
    if (legacy) return { source: 'legacy', ...legacy };
    return null;
  }

  getCalibState({ engine, family, liga }) {
    return this.s.getCalib.get(engine, family, liga) ?? null;
  }

  getLeaguePriors({ liga, temporada, period, asOf }) {
    const r = this.s.getLeaguePriors.get(liga, temporada, period, asOf);
    if (!r) return null;
    let payload = {};
    try { payload = JSON.parse(r.payload); } catch { /* noop */ }
    return { ...payload, as_of: r.as_of };
  }

  upsertTeamProfileV2({ team, liga, temporada, side, asOf, n, payload }) {
    return this.s.upsertTeamProfileV2.run(team, liga, temporada, side, asOf, n, JSON.stringify(payload));
  }

  upsertLeaguePriors({ liga, temporada, period, asOf, payload }) {
    return this.s.upsertLeaguePriors.run(liga, temporada, period, JSON.stringify(payload), asOf);
  }

  upsertCalibState({ engine, family, liga, ewma_hr, ewma_brier, clv_score, isotonic_blob, isotonic_version, sample_size }) {
    return this.s.upsertCalib.run(
      engine, family, liga,
      ewma_hr ?? 0,
      ewma_brier ?? null,
      clv_score ?? null,
      isotonic_blob ?? null,
      isotonic_version ?? null,
      sample_size ?? 0,
    );
  }

  saveMotorRun({ run_id, match_id, engine_signature, request_payload, response_payload }) {
    return this.s.saveRun.run(
      run_id, match_id,
      JSON.stringify(engine_signature),
      JSON.stringify(request_payload),
      JSON.stringify(response_payload),
    );
  }

  /**
   * Persiste lista de slots como rows em `prediction`. Idempotente por (run_id, market_key).
   */
  savePredictions({ run_id, match_id, match_date, liga, slots }) {
    const tx = this.db.transaction((rows) => {
      for (const s of rows) {
        this.s.insertPrediction.run(
          run_id, match_id, match_date, liga,
          s.family, s.scope, s.period, s.direction,
          s.line ?? null,
          s.market_key,
          s.fair_prob ?? 0,
          s.market_odd ?? null,
          s.edge_pct ?? null,
          s.confidence ?? 0,
          s.certified ? 1 : 0,
          s.provenance ? JSON.stringify(s.provenance) : null,
        );
      }
    });
    tx(slots);
    return slots.length;
  }

  close() { this.db.close(); }
}
