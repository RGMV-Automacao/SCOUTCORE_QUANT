import { randomUUID } from 'node:crypto';
import { runPredict } from '../predict.mjs';

// Persistent runs store backed by SQLite (tables: runs, run_slots).
// Mantém a interface antiga (set/get/has/delete/clear/size/values) que
// strategies.mjs consome via RUNS_CACHE.
class RunsStore {
  constructor(db) {
    this.db = db;
    this.q = {
      insertRun: db.prepare('INSERT OR REPLACE INTO runs (run_id, date_start, date_end, matches, created_at) VALUES (?, ?, ?, ?, ?)'),
      deleteSlots: db.prepare('DELETE FROM run_slots WHERE run_id = ?'),
      insertSlot: db.prepare('INSERT INTO run_slots (run_id, idx, match_id, market_key, payload) VALUES (?, ?, ?, ?, ?)'),
      getRun: db.prepare('SELECT run_id, date_start, date_end, matches, created_at FROM runs WHERE run_id = ?'),
      getSlots: db.prepare('SELECT payload FROM run_slots WHERE run_id = ? ORDER BY idx ASC'),
      countSlots: db.prepare('SELECT COUNT(*) AS n FROM run_slots WHERE run_id = ?'),
      listRuns: db.prepare('SELECT run_id, date_start, date_end, matches, created_at FROM runs ORDER BY created_at DESC'),
      deleteRun: db.prepare('DELETE FROM runs WHERE run_id = ?'),
      hasRun: db.prepare('SELECT 1 FROM runs WHERE run_id = ?'),
      countAll: db.prepare('SELECT COUNT(*) AS n FROM runs'),
      clearRuns: db.prepare('DELETE FROM runs'),
    };
    this._setTx = db.transaction((run) => {
      this.q.insertRun.run(run.run_id, run.date_start, run.date_end, run.matches, run.created_at);
      this.q.deleteSlots.run(run.run_id);
      let i = 0;
      for (const s of run.slots) {
        this.q.insertSlot.run(run.run_id, i++, s.match_id ?? null, s.market_key ?? null, JSON.stringify(s));
      }
    });
  }
  set(runId, run) { this._setTx(run); }
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

// ── Odds helpers ──────────────────────────────────────────────────────────────

// Parse "Mais de 2.5" / "Menos de 2.5" into { dir:'over'|'under', line:'2_5' }
function parseMaisMenos(selecao, linha) {
  const mais = selecao.match(/^Mais de (\d+\.?\d*)$/i);
  if (mais) return { dir: 'over', line: mais[1].replace('.', '_') };
  const menos = selecao.match(/^Menos de (\d+\.?\d*)$/i);
  if (menos) return { dir: 'under', line: menos[1].replace('.', '_') };
  // Fallback: use raw selecao=MAIS/MENOS + linha column
  if ((selecao === 'MAIS' || selecao === 'MENOS') && linha) {
    return { dir: selecao === 'MAIS' ? 'over' : 'under', line: String(linha).replace('.', '_') };
  }
  return null;
}

function mapOddsKey(mercado, selecao, linha) {
  // 1x2 FT
  if (mercado === 'Resultado Final') {
    if (selecao === '1') return '1x2_total_ft_home';
    if (selecao === 'X') return '1x2_total_ft_draw';
    if (selecao === '2') return '1x2_total_ft_away';
  }
  // 1x2 HT
  if (mercado === '1º Tempo - Resultado (1X2)' || mercado === '1° Tempo - Resultado (1X2)') {
    if (selecao === '1') return '1x2_total_ht_home';
    if (selecao === 'X') return '1x2_total_ht_draw';
    if (selecao === '2') return '1x2_total_ht_away';
  }
  // Dupla chance FT
  if (mercado === 'Dupla Chance') {
    if (selecao === '1X' || selecao === 'Empate ou 2' === false && selecao.includes('1') && selecao.includes('X')) return 'dupla_total_ft_1x';
    if (selecao === 'X2' || selecao.includes('X') && selecao.includes('2') && !selecao.includes('1')) return 'dupla_total_ft_x2';
    if (selecao === '12') return 'dupla_total_ft_12';
    if (selecao === 'Empate ou 2') return 'dupla_total_ft_x2';
    if (selecao === '1 ou empate') return 'dupla_total_ft_1x';
    if (selecao === '1 ou 2') return 'dupla_total_ft_12';
  }
  // BTTS FT
  if (mercado === 'Ambas as Equipes Marcam') {
    if (selecao === 'Sim') return 'btts_total_ft_sim';
    if (selecao === 'Não') return 'btts_total_ft_nao';
  }
  // BTTS HT
  if (mercado === '1° Tempo - Ambas as Equipes Marcam' || mercado === '1º Tempo - Ambas as Equipes Marcam') {
    if (selecao === 'Sim') return 'btts_total_ht_sim';
    if (selecao === 'Não') return 'btts_total_ht_nao';
  }
  // Over/under mercados — all share the same parse logic
  const OVER_UNDER_MAP = {
    'Total de Gols':             'gols_total_ft',
    'Total de Escanteios':       'escanteios_total_ft',
    'Total de Cartões':          'cartoes_total_ft',
    'Total de Chutes no Gol':    'chutes_alvo_total_ft',
    'Total de Finalizações':     'chutes_total_ft',
    'Total de Faltas':           'faltas_total_ft',
    'Total de Impedimentos':     'impedimentos_total_ft',
    'Total de Defesas do Goleiro': 'defesas_total_ft',
    '1º Tempo - Total de Gols':           'gols_total_ht',
    '1° Tempo - Total de Gols':           'gols_total_ht',
    '1º Tempo - Total de Escanteios':     'escanteios_total_ht',
    '1° Tempo - Total de Escanteios':     'escanteios_total_ht',
    '1º Tempo - Total de Chutes no Gol':  'chutes_alvo_total_ht',
    '1° Tempo - Total de Chutes no Gol':  'chutes_alvo_total_ht',
    '1º Tempo - Total de Cartões':        'cartoes_total_ht',
    '1° Tempo - Total de Cartões':        'cartoes_total_ht',
  };
  const prefix = OVER_UNDER_MAP[mercado];
  if (prefix) {
    const parsed = parseMaisMenos(selecao, linha);
    if (parsed) return `${prefix}_${parsed.dir}_${parsed.line}`;
  }
  return null;
}

const ODDS_MERCADOS = [
  'Resultado Final',
  '1º Tempo - Resultado (1X2)', '1° Tempo - Resultado (1X2)',
  'Dupla Chance',
  'Ambas as Equipes Marcam',
  '1° Tempo - Ambas as Equipes Marcam', '1º Tempo - Ambas as Equipes Marcam',
  'Total de Gols', 'Total de Escanteios', 'Total de Cartões',
  'Total de Chutes no Gol', 'Total de Finalizações', 'Total de Faltas',
  'Total de Impedimentos', 'Total de Defesas do Goleiro',
  '1º Tempo - Total de Gols', '1° Tempo - Total de Gols',
  '1º Tempo - Total de Escanteios', '1° Tempo - Total de Escanteios',
  '1º Tempo - Total de Chutes no Gol', '1° Tempo - Total de Chutes no Gol',
  '1º Tempo - Total de Cartões', '1° Tempo - Total de Cartões',
];

function buildOddsSnapshot(db, home, away, date, log) {
  let rows = [];
  try {
    const placeholders = ODDS_MERCADOS.map(() => '?').join(',');
    rows = db.prepare(`
      SELECT mercado, selecao, linha, odd FROM odds
      WHERE home_team = ? AND away_team = ? AND date(data_jogo) = date(?)
        AND mercado IN (${placeholders})
    `).all(home, away, date, ...ODDS_MERCADOS);
  } catch (err) {
    (log ?? console).error?.({ err: err.message, home, away, date }, 'buildOddsSnapshot_query_failed');
    throw new Error(`odds_query_failed:${home}×${away}:${err.message}`);
  }
  const snap = {};
  for (const r of rows) {
    const key = mapOddsKey(r.mercado, r.selecao, r.linha);
    // Keep best (highest) odd when duplicate keys appear
    if (key && r.odd > 1.01 && (snap[key] == null || r.odd > snap[key])) snap[key] = r.odd;
  }
  return snap;
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
    const { date_start, date_end } = req.body ?? {};
    if (!date_start) return reply.code(400).send({ error: 'date_start_required' });
    const end = date_end || date_start;

    const runId = `run-${date_start}-to-${end}-${randomUUID().slice(0, 8)}`;
    const matches = repo.getMatchesByDateRange(date_start, end);
    const slots = [];

    for (const m of matches) {
      let odds_snapshot;
      try {
        odds_snapshot = buildOddsSnapshot(repo.db, m.home_team, m.away_team, m.data_partida, app.log);
      } catch (err) {
        app.log.warn?.({ err: err.message, match: m.id_confronto }, 'odds_snapshot_failed_skip_match');
        continue;
      }

      const payload = {
        match: {
          external_id: m.id_confronto,
          home: m.home_team,
          away: m.away_team,
          liga: m.liga,
          date: m.data_partida,
        },
        odds_snapshot,
        options: { include_engines: ['A'] },
      };

      const out = await runPredict({ repo, body: payload, log: app.log, run_id: runId });

      if (!out.__error && out.slots) {
        for (const s of out.slots) {
          s.match_id = m.id_confronto;
          s.home = m.home_team;
          s.away = m.away_team;
          s.liga = m.liga;
          s.date = m.data_partida;
          slots.push(s);
        }
      }
    }

    RUNS_STORE.set(runId, {
      run_id: runId,
      date_start,
      date_end: end,
      matches: matches.length,
      slots,
      created_at: new Date().toISOString(),
    });

    return {
      run_id: runId,
      date_start,
      date_end: end,
      matches: matches.length,
      slots: slots.length,
    };
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
}
