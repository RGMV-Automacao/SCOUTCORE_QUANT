import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applyAOnlyConfidencePenalty, buildEvRanking, runPredict } from '../src/predict.mjs';

test('applyAOnlyConfidencePenalty: penalizes engine_b_unavailable', () => {
  const slot = { confidence: 0.72, provenance: { divergence_resolved_by: 'engine_b_unavailable' } };
  applyAOnlyConfidencePenalty(slot);
  assert.equal(slot.confidence, 0.612);
  assert.equal(slot.provenance.a_only_confidence_factor, 0.85);
  assert.equal(slot.provenance.a_only_confidence_penalty_applied, true);
});

test('applyAOnlyConfidencePenalty: penalizes engine_b_no_slot', () => {
  const slot = { confidence: 0.8, provenance: { divergence_resolved_by: 'engine_b_no_slot' } };
  applyAOnlyConfidencePenalty(slot);
  assert.equal(slot.confidence, 0.68);
  assert.equal(slot.provenance.a_only_confidence_penalty_applied, true);
});

test('applyAOnlyConfidencePenalty: keeps consensus unchanged', () => {
  const slot = { confidence: 0.8, provenance: { divergence_resolved_by: 'consensus' } };
  applyAOnlyConfidencePenalty(slot);
  assert.equal(slot.confidence, 0.8);
  assert.equal(slot.provenance.a_only_confidence_penalty_applied, undefined);
});

test('buildEvRanking exclui slots com odd/edge mas certified=false', () => {
  const slots = [
    {
      market_key: 'ok',
      family: 'gols',
      certified: true,
      market_odd: 1.9,
      edge_pct: 7,
      confidence: 0.6,
      provenance: { qg: { market_gate: { rank_eligible: true } } },
    },
    {
      market_key: 'divergente',
      family: 'gols',
      certified: false,
      market_odd: 2.4,
      edge_pct: 12,
      confidence: 0.8,
      provenance: { qg: { market_gate: { rank_eligible: true } } },
    },
  ];

  const out = buildEvRanking(slots, { getFamilyCap: () => Infinity });

  assert.deepEqual(out.ev_ranked, ['ok']);
  assert.deepEqual(out.ev_ranked_capped_out, []);
});

test('runPredict expõe warning explícito quando o contexto interno do Engine A é inválido', async () => {
  const repo = {
    db: {
      prepare() {
        return {
          all() { return []; },
          get() { return null; },
        };
      },
    },
    getTeamProfile({ side }) {
      if (side === 'home') {
        return { avg_gols_marcados: 'bad', avg_gols_sofridos: 1.0, source: 'pit', n: 20, n_events: 20 };
      }
      return { avg_gols_marcados: 1.1, avg_gols_sofridos: 1.2, source: 'pit', n: 20, n_events: 20 };
    },
    getLeaguePriors() {
      return { avg_goals_total: 2.6 };
    },
    getRecentMatches() {
      return [];
    },
  };

  const out = await runPredict({
    repo,
    persist: false,
    body: {
      contract_version: '1.0.0',
      match: {
        external_id: 'match-1',
        home: 'A',
        away: 'B',
        liga: 'brasileirao',
        date: '2026-05-16',
      },
      options: { include_engines: ['A'] },
    },
  });

  assert.equal(out.__error, undefined);
  assert.ok(out.warnings.some((warning) => warning.startsWith('engine_a_invalid_context:profileHome.avg_gols_marcados')));
  assert.deepEqual(out.slots, []);
});

test('runPredict normaliza odds_snapshot legado com alias numérico compacto', async () => {
  const repo = {
    db: {
      prepare() {
        return {
          all() { return []; },
          get() { return null; },
        };
      },
    },
    getTeamProfile() {
      return {
        avg_gols_marcados: 1.5,
        avg_gols_sofridos: 1.1,
        avg_escanteios: 5.3,
        avg_chutes: 12.4,
        avg_chutes_alvo: 4.6,
        avg_cartoes_amarelos: 2.1,
        avg_faltas_cometidas: 11.8,
        avg_impedimentos: 1.9,
        avg_defesas: 3.2,
        source: 'pit',
        n: 20,
        n_events: 20,
      };
    },
    getLeaguePriors() {
      return {
        avg_goals_total: 2.7,
        avg_escanteios_total: 10.2,
        avg_chutes_total: 22.5,
        avg_chutes_alvo_total: 8.7,
        avg_cartoes_total: 4.3,
        avg_faltas_total: 24.1,
        avg_impedimentos_total: 4.0,
        avg_defesas_total: 7.1,
      };
    },
    getRecentMatches() {
      return [];
    },
  };

  const out = await runPredict({
    repo,
    persist: false,
    body: {
      contract_version: '1.0.0',
      match: {
        external_id: 'match-legacy-odds',
        home: 'Aston Villa',
        away: 'Liverpool',
        liga: 'premier-league',
        date: '2026-05-15',
      },
      odds_snapshot: { gols_total_ft_over_25: 1.85 },
      options: { include_engines: ['A'] },
    },
  });

  const slot = out.slots.find((item) => item.market_key === 'gols_total_ft_over_2_5');
  assert.ok(slot, 'esperava slot canônico gols_total_ft_over_2_5');
  assert.equal(slot.market_odd, 1.85);
  assert.equal(slot.edge_pct != null, true);
  assert.ok(out.warnings.includes('market_alias_resolved:gols_total_ft_over_25->gols_total_ft_over_2_5'));
});

test('runPredict não certifica slots sem odd real', async () => {
  const repo = {
    db: {
      prepare() {
        return {
          all() { return []; },
          get() { return null; },
        };
      },
    },
    getTeamProfile() {
      return {
        avg_gols_marcados: 1.5,
        avg_gols_sofridos: 1.1,
        avg_escanteios: 5.3,
        avg_chutes: 12.4,
        avg_chutes_alvo: 4.6,
        avg_cartoes_amarelos: 2.1,
        avg_faltas_cometidas: 11.8,
        avg_impedimentos: 1.9,
        avg_defesas: 3.2,
        source: 'pit',
        n: 20,
        n_events: 20,
      };
    },
    getLeaguePriors() {
      return {
        avg_goals_total: 2.7,
        avg_escanteios_total: 10.2,
        avg_chutes_total: 22.5,
        avg_chutes_alvo_total: 8.7,
        avg_cartoes_total: 4.3,
        avg_faltas_total: 24.1,
        avg_impedimentos_total: 4.0,
        avg_defesas_total: 7.1,
      };
    },
    getRecentMatches() {
      return [];
    },
  };

  const out = await runPredict({
    repo,
    persist: false,
    body: {
      contract_version: '1.0.0',
      match: {
        external_id: 'match-no-odds',
        home: 'Aston Villa',
        away: 'Liverpool',
        liga: 'premier-league',
        date: '2026-05-15',
      },
      options: { include_engines: ['A'] },
    },
  });

  assert.equal(out.__error, undefined);
  assert.equal(out.slots.length > 0, true);
  const noOddSlots = out.slots.filter((slot) => slot.market_odd == null || slot.edge_pct == null);
  assert.equal(noOddSlots.length, out.slots.length);
  assert.equal(noOddSlots.every((slot) => slot.certified === false), true);
  assert.equal(noOddSlots.every((slot) => slot.provenance?.qg?.market_gate?.reasons?.includes('no_market_odd')), true);
});

test('runPredict resolve odds do DB quando options.resolve_odds=true', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE odds (
      fonte TEXT,
      home_team TEXT,
      away_team TEXT,
      data_jogo TEXT,
      mercado TEXT,
      selecao TEXT,
      linha TEXT,
      odd REAL,
      criado_em TEXT
    );
    CREATE TABLE calib_state (
      engine TEXT,
      family TEXT,
      direction TEXT,
      liga TEXT,
      lambda_mult REAL,
      confidence_factor REAL,
      line_shift REAL,
      ewma_hr REAL,
      ewma_brier REAL,
      sample_size INTEGER,
      updated_at TEXT
    );
  `);
  db.prepare(`
    INSERT INTO odds (fonte, home_team, away_team, data_jogo, mercado, selecao, linha, odd, criado_em)
    VALUES ('superbet', 'Aston Villa', 'Liverpool', '2026-05-15', 'Total de Gols', 'Mais de 2.5', '2.5', 1.95, '2026-05-15 10:00:00')
  `).run();

  const repo = {
    db,
    getTeamProfile() {
      return {
        avg_gols_marcados: 1.5,
        avg_gols_sofridos: 1.1,
        avg_escanteios: 5.3,
        avg_chutes: 12.4,
        avg_chutes_alvo: 4.6,
        avg_cartoes_amarelos: 2.1,
        avg_faltas_cometidas: 11.8,
        avg_impedimentos: 1.9,
        avg_defesas: 3.2,
        source: 'pit',
        n: 20,
        n_events: 20,
      };
    },
    getLeaguePriors() {
      return {
        avg_goals_total: 2.7,
        avg_escanteios_total: 10.2,
        avg_chutes_total: 22.5,
        avg_chutes_alvo_total: 8.7,
        avg_cartoes_total: 4.3,
        avg_faltas_total: 24.1,
        avg_impedimentos_total: 4.0,
        avg_defesas_total: 7.1,
      };
    },
    getRecentMatches() {
      return [];
    },
  };

  try {
    const out = await runPredict({
      repo,
      persist: false,
      body: {
        contract_version: '1.0.0',
        match: {
          external_id: 'match-2',
          home: 'Aston Villa',
          away: 'Liverpool',
          liga: 'premier-league',
          date: '2026-05-15',
        },
        options: { include_engines: ['A'], resolve_odds: true },
      },
    });

    const slot = out.slots.find((item) => item.market_key === 'gols_total_ft_over_2_5');
    assert.ok(slot, 'esperava slot canônico gols_total_ft_over_2_5');
    assert.equal(slot.market_odd, 1.95);
    assert.equal(out.diagnostics.odds.resolver_used, true);
    assert.equal(out.diagnostics.odds.resolver_found >= 1, true);
  } finally {
    db.close();
  }
});