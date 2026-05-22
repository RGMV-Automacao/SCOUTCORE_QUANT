import { randomUUID } from 'node:crypto';
import { runPredict } from '../predict.mjs';
import { buildDbOddsResolver } from '../odds-resolver.mjs';

// ── RunProgressStore ──────────────────────────────────────────────────────────
// In-memory progress tracking for /v1/run. Cliente pode fornecer `run_id`
// no body do POST e fazer polling em `GET /v1/runs/:id/progress` em paralelo,
// observando avanço por match enquanto o POST está em flight.
const PROGRESS_TTL_MS = 30 * 60 * 1000;     // 30 min retention após finish
const PROGRESS_GC_INTERVAL = 5 * 60 * 1000; // GC a cada 5 min

class RunProgressStore {
  constructor() {
    /** @type {Map<string, any>} */
    this.map = new Map();
    this._gc = setInterval(() => this._gcSweep(), PROGRESS_GC_INTERVAL);
    this._gc.unref?.();
  }
  init(runId, { date_start, date_end, total_matches }) {
    const now = Date.now();
    this.map.set(runId, {
      run_id: runId,
      status: 'running',
      phase: 'discover',
      sub_phase: null,
      date_start, date_end,
      total_matches,
      matches_done: 0,
      matches_skipped: 0,
      slots_built: 0,
      current_match: null,
      started_at: now,
      updated_at: now,
      finished_at: null,
      error: null,
    });
  }
  update(runId, patch) {
    const r = this.map.get(runId);
    if (!r) return;
    Object.assign(r, patch, { updated_at: Date.now() });
  }
  finish(runId, { slots_built, error } = {}) {
    const r = this.map.get(runId);
    if (!r) return;
    r.status = error ? 'failed' : 'done';
    r.phase = error ? 'failed' : 'done';
    r.sub_phase = null;
    r.current_match = null;
    r.finished_at = Date.now();
    r.updated_at = r.finished_at;
    if (typeof slots_built === 'number') r.slots_built = slots_built;
    if (error) r.error = error;
  }
  get(runId) { return this.map.get(runId) ?? null; }
  _gcSweep() {
    const cutoff = Date.now() - PROGRESS_TTL_MS;
    for (const [k, v] of this.map) {
      const stamp = v.finished_at ?? v.started_at;
      if (v.status !== 'running' && stamp < cutoff) this.map.delete(k);
    }
  }
}
const RUN_PROGRESS = new RunProgressStore();
export function getRunProgress() { return RUN_PROGRESS; }

function runLabelFromSeq(seq) {
  return `RUN #${String(seq).padStart(4, '0')}`;
}

// Persistent runs store backed by SQLite (tables: runs, run_slots).
// Mantém a interface antiga (set/get/has/delete/clear/size/values) que
// strategies.mjs consome via RUNS_CACHE.
class RunsStore {
  constructor(db) {
    this.db = db;
    this._ensureRunMetadataColumns();
    this.q = {
      insertRun: db.prepare('INSERT OR REPLACE INTO runs (run_id, date_start, date_end, matches, created_at, run_seq, run_label) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      deleteSlots: db.prepare('DELETE FROM run_slots WHERE run_id = ?'),
      insertSlot: db.prepare('INSERT INTO run_slots (run_id, idx, match_id, market_key, payload) VALUES (?, ?, ?, ?, ?)'),
      getRun: db.prepare('SELECT run_id, date_start, date_end, matches, created_at, run_seq, run_label FROM runs WHERE run_id = ?'),
      getSlots: db.prepare('SELECT payload FROM run_slots WHERE run_id = ? ORDER BY idx ASC'),
      countSlots: db.prepare('SELECT COUNT(*) AS n FROM run_slots WHERE run_id = ?'),
      listRuns: db.prepare('SELECT run_id, date_start, date_end, matches, created_at, run_seq, run_label FROM runs ORDER BY created_at DESC'),
      deleteRun: db.prepare('DELETE FROM runs WHERE run_id = ?'),
      hasRun: db.prepare('SELECT 1 FROM runs WHERE run_id = ?'),
      countAll: db.prepare('SELECT COUNT(*) AS n FROM runs'),
      clearRuns: db.prepare('DELETE FROM runs'),
      nextRunSeq: db.prepare('SELECT COALESCE(MAX(run_seq), 0) + 1 AS n FROM runs'),
    };
    this._setTx = db.transaction((run) => {
      this.q.insertRun.run(run.run_id, run.date_start, run.date_end, run.matches, run.created_at, run.run_seq, run.run_label);
      this.q.deleteSlots.run(run.run_id);
      let i = 0;
      for (const s of run.slots) {
        this.q.insertSlot.run(run.run_id, i++, s.match_id ?? null, s.market_key ?? null, JSON.stringify(s));
      }
    });
  }
  _ensureRunMetadataColumns() {
    const cols = new Set(this.db.prepare('PRAGMA table_info(runs)').all().map((col) => col.name));
    if (!cols.has('run_seq')) this.db.exec('ALTER TABLE runs ADD COLUMN run_seq INTEGER');
    if (!cols.has('run_label')) this.db.exec('ALTER TABLE runs ADD COLUMN run_label TEXT');

    const pending = this.db.prepare('SELECT run_id FROM runs WHERE run_seq IS NULL ORDER BY created_at ASC, run_id ASC').all();
    if (pending.length === 0) return;

    let nextSeq = this.db.prepare('SELECT COALESCE(MAX(run_seq), 0) + 1 AS n FROM runs').get().n;
    const update = this.db.prepare('UPDATE runs SET run_seq = ?, run_label = ? WHERE run_id = ?');
    const tx = this.db.transaction((rows) => {
      for (const row of rows) {
        update.run(nextSeq, runLabelFromSeq(nextSeq), row.run_id);
        nextSeq++;
      }
    });
    tx(pending);
  }
  set(runId, run) {
    const existing = this.q.getRun.get(runId);
    const runSeq = Number.isInteger(Number(run.run_seq)) && Number(run.run_seq) > 0
      ? Number(run.run_seq)
      : Number(existing?.run_seq) || Number(this.q.nextRunSeq.get().n);
    const savedRun = {
      ...run,
      run_seq: runSeq,
      run_label: run.run_label || existing?.run_label || runLabelFromSeq(runSeq),
    };
    this._setTx(savedRun);
    return savedRun;
  }
  get(runId) {
    const r = this.q.getRun.get(runId);
    if (!r) return null;
    const slots = this.q.getSlots.all(runId).map((row) => JSON.parse(row.payload));
    return { ...r, slots };
  }
  has(runId) { return this.q.hasRun.get(runId) != null; }
  delete(runId) {
    if (!this.has(runId)) return false;
    this.q.deleteRun.run(runId);
    return true;
  }
  clear() {
    const n = this.q.countAll.get().n;
    this.q.clearRuns.run();
    return n;
  }
  get size() { return this.q.countAll.get().n; }
  values() {
    const runs = this.q.listRuns.all();
    return runs.map((r) => ({ ...r, slots: this.q.getSlots.all(r.run_id).map((row) => JSON.parse(row.payload)) }));
  }
  listSummary() {
    return this.q.listRuns.all().map((r) => ({ ...r, slots: this.q.countSlots.get(r.run_id).n }));
  }
}

// Lazy singleton — inicializado no primeiro registerRuns().
let RUNS_STORE = null;
export function getRunsStore() {
  if (!RUNS_STORE) throw new Error('RUNS_STORE not initialized — call registerRuns first');
  return RUNS_STORE;
}

function buildRunOptions(options = {}) {
  const rawEngines = Array.isArray(options.include_engines) ? options.include_engines : ['A', 'B'];
  const include_engines = [...new Set(rawEngines.filter((engine) => engine === 'A' || engine === 'B'))];
  return {
    include_engines: include_engines.length > 0 ? include_engines : ['A', 'B'],
    scout: options.scout ?? true,
    min_edge_pp: Number.isFinite(options.min_edge_pp) ? options.min_edge_pp : 0,
    suppress_markets: Array.isArray(options.suppress_markets) ? options.suppress_markets : [],
    feature_set: options.feature_set || 'v3',
  };
}

const BRT_OFFSET_MINUTES = -180;
const KICKOFF_BUFFER_MINUTES = 30;
const LIVE_BLOCKED_STATUSES = new Set(['awarded', 'played', 'playing', 'postponed']);

function brtDateString(now = new Date()) {
  return new Date(now.getTime() + BRT_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

function brasilDateTimeToUtcMillis(date, time) {
  const dateMatch = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute, second = '00'] = timeMatch;
  const hh = Number(hour);
  const mm = Number(minute);
  const ss = Number(second);
  if (hh > 23 || mm > 59 || ss > 59) return null;

  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), hh, mm, ss);
  return localAsUtc - BRT_OFFSET_MINUTES * 60_000;
}

function matchFallsInsideLiveKickoffGuard(match, now = new Date()) {
  if (!match?.data_partida || !match?.hora_partida) return false;
  if (match.data_partida < brtDateString(now)) return false;
  const kickoffUtcMillis = brasilDateTimeToUtcMillis(match.data_partida, match.hora_partida);
  if (kickoffUtcMillis == null) return false;
  const minutesToKickoff = (kickoffUtcMillis - now.getTime()) / 60_000;
  return minutesToKickoff < KICKOFF_BUFFER_MINUTES;
}

function isRunnableTeamName(value) {
  const name = String(value ?? '').trim();
  if (!name) return false;
  return !new Set(['?', 'tbd', 'a definir', 'undefined', 'null']).has(name.toLowerCase());
}

function matchPassesRunFilter(match, body = {}, now = new Date()) {
  if (!isRunnableTeamName(match?.home_team) || !isRunnableTeamName(match?.away_team)) return false;

  const wantedId = body.match_id || body.external_id || body.id_confronto;
  if (wantedId && match.id_confronto !== wantedId) return false;
  if (body.liga && match.liga !== body.liga) return false;
  if ((body.home || body.home_team) && match.home_team !== (body.home || body.home_team)) return false;
  if ((body.away || body.away_team) && match.away_team !== (body.away || body.away_team)) return false;

  const includeStarted = body.include_started === true || body.options?.include_started === true;
  if (includeStarted) return true;

  if (match.data_partida >= brtDateString(now)) {
    const status = String(match.status || '').trim().toLowerCase();
    if (LIVE_BLOCKED_STATUSES.has(status)) return false;
    if (matchFallsInsideLiveKickoffGuard(match, now)) return false;
  }

  return true;
}

/**
 * Endpoint para descoberta, predição batch e persistência de runs.
 * POST /v1/run { date_start: 'YYYY-MM-DD', date_end: 'YYYY-MM-DD' }
 * GET /v1/runs
 * GET /v1/runs/:id/slots
 */
export function registerRuns(app, { repo }) {
  RUNS_STORE = new RunsStore(repo.db);

  app.post('/v1/run', async (req, reply) => {
    const body = req.body ?? {};
    const { date_start, date_end, run_id: clientRunId } = body;
    if (!date_start) return reply.code(400).send({ error: 'date_start_required' });
    const end = date_end || date_start;

    // Cliente pode pré-gerar run_id (ex: crypto.randomUUID()) para iniciar
    // polling em paralelo. Sanitiza para evitar injeção em chaves de storage.
    const safeClientId = typeof clientRunId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(clientRunId)
      ? clientRunId
      : null;
    const runId = safeClientId
      ? `run-${date_start}-to-${end}-${safeClientId.slice(0, 16)}`
      : `run-${date_start}-to-${end}-${randomUUID().slice(0, 8)}`;

    const matches = repo.getMatchesByDateRange(date_start, end).filter((match) => matchPassesRunFilter(match, body));
    const runOptions = buildRunOptions(body.options);
    const oddsResolver = buildDbOddsResolver(repo.db);
    const motorRuns = [];
    RUN_PROGRESS.init(runId, { date_start, date_end: end, total_matches: matches.length });
    RUN_PROGRESS.update(runId, { phase: matches.length === 0 ? 'done' : 'predicting' });

    const slots = [];
    let mIdx = 0;
  let savedRun = null;
    try {
      for (const m of matches) {
        mIdx++;
        RUN_PROGRESS.update(runId, {
          phase: 'predicting',
          current_match: { idx: mIdx, home: m.home_team, away: m.away_team, liga: m.liga },
        });

        const matchPayload = {
          external_id: m.id_confronto,
          home: m.home_team,
          away: m.away_team,
          liga: m.liga,
          date: m.data_partida,
        };
        if (m.hora_partida) matchPayload.hora = m.hora_partida;

        const payload = {
          match: matchPayload,
          options: runOptions,
        };

        const predictionRunId = `${runId}__${m.id_confronto}`;

        const out = await runPredict({
          repo,
          body: payload,
          log: app.log,
          run_id: predictionRunId,
          oddsResolver,
          onSubPhase: (sp) => RUN_PROGRESS.update(runId, { sub_phase: sp }),
        });

        if (!out.__error && out.slots) {
          motorRuns.push({ run_id: out.run_id, match_id: m.id_confronto, home: m.home_team, away: m.away_team, liga: m.liga });
          for (const s of out.slots) {
            s.batch_run_id = runId;
            s.prediction_run_id = out.run_id;
            s.match_id = m.id_confronto;
            s.home = m.home_team;
            s.away = m.away_team;
            s.liga = m.liga;
            s.date = m.data_partida;
            slots.push(s);
          }
        }

        RUN_PROGRESS.update(runId, { matches_done: mIdx, slots_built: slots.length });
      }

      RUN_PROGRESS.update(runId, { phase: 'persisting', sub_phase: null, current_match: null });
      savedRun = RUNS_STORE.set(runId, {
        run_id: runId,
        date_start,
        date_end: end,
        matches: matches.length,
        slots,
        created_at: new Date().toISOString(),
      });
      RUN_PROGRESS.finish(runId, { slots_built: slots.length });
    } catch (err) {
      RUN_PROGRESS.finish(runId, { error: err.message ?? String(err) });
      throw err;
    }

    return {
      run_id: runId,
      run_seq: savedRun?.run_seq ?? null,
      run_label: savedRun?.run_label ?? null,
      date_start,
      date_end: end,
      matches: matches.length,
      slots: slots.length,
        engines: runOptions.include_engines,
        scout: runOptions.scout,
        motor_runs: motorRuns,
    };
  });

  app.get('/v1/runs/:id/progress', async (req, reply) => {
    const { id } = req.params;
    const p = RUN_PROGRESS.get(id);
    if (!p) return reply.code(404).send({ error: 'not_found', run_id: id });
    const elapsed_ms = (p.finished_at ?? Date.now()) - p.started_at;
    return { ...p, elapsed_ms };
  });

  app.get('/v1/runs', async () => {
    return { count: RUNS_STORE.size, items: RUNS_STORE.listSummary() };
  });

  app.get('/v1/runs/:id/slots', async (req, reply) => {
    const { id } = req.params;
    const run = RUNS_STORE.get(id);
    if (!run) return reply.code(404).send({ error: 'not_found' });
    return { run_id: id, count: run.slots.length, slots: run.slots };
  });

  app.delete('/v1/runs/:id', async (req, reply) => {
    const { id } = req.params;
    if (!RUNS_STORE.delete(id)) return reply.code(404).send({ error: 'not_found' });
    return { deleted: id };
  });

  app.delete('/v1/runs', async () => {
    return { deleted_count: RUNS_STORE.clear() };
  });

  // Lista jogos disponíveis no DB em um intervalo. Usado pela UI para o
  // seletor de confronto antes de disparar /v1/run.
  app.get('/v1/matches', async (req, reply) => {
    const { date_start, date_end } = req.query ?? {};
    if (!date_start) return reply.code(400).send({ error: 'date_start_required' });
    const end = date_end || date_start;
    const matches = repo.getMatchesByDateRange(date_start, end).filter((match) => matchPassesRunFilter(match, req.query ?? {}));
    return {
      date_start,
      date_end: end,
      count: matches.length,
      items: matches.map((m) => ({
        id_confronto: m.id_confronto,
        liga: m.liga,
        home: m.home_team,
        away: m.away_team,
        data: m.data_partida,
        hora: m.hora_partida,
        status: m.status ?? null,
      })),
    };
  });

  // Retorna o response_payload completo de um motor_run individual
  // (auditoria por confronto). Usado pela página /realflow.
  app.get('/v1/motor-runs/:id', async (req, reply) => {
    const { id } = req.params;
    const row = repo.db
      .prepare('SELECT run_id, match_id, engine_signature, request_payload, response_payload, created_at FROM motor_run WHERE run_id = ?')
      .get(id);
    if (!row) return reply.code(404).send({ error: 'not_found', run_id: id });
    let request = null;
    let response = null;
    let signature = null;
    try { request = JSON.parse(row.request_payload); } catch { /* ignore */ }
    try { response = JSON.parse(row.response_payload); } catch { /* ignore */ }
    try { signature = JSON.parse(row.engine_signature); } catch { /* ignore */ }
    return {
      run_id: row.run_id,
      match_id: row.match_id,
      created_at: row.created_at,
      engine_signature: signature,
      request,
      response,
    };
  });
}
