import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuoteSignature,
  buildQuoteKey,
  inferMarketKey,
  normalizeLegacyLiga,
} from '../../../scripts/migrate-legacy-bookline-odds.mjs';

test('normalizeLegacyLiga traduz aliases conhecidos', () => {
  assert.equal(normalizeLegacyLiga('brasileiro'), 'brasileirao');
  assert.equal(normalizeLegacyLiga('premier'), 'premier-league');
  assert.equal(normalizeLegacyLiga('laliga2'), 'la-liga-2');
});

test('inferMarketKey reconhece mercados canonicos basicos', () => {
  assert.equal(
    inferMarketKey({ mercado: 'Total de Gols', selecao: 'MAIS', linha: '2.5' }),
    'gols_total_ft_over_2_5',
  );
  assert.equal(
    inferMarketKey({ mercado: '1º Tempo - Total de Escanteios', selecao: 'MENOS', linha: '4.5' }),
    'escanteios_total_ht_under_4_5',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Resultado Final', selecao: '1' }),
    '1x2_total_ft_home',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Resultado Final (1X2)', selecao: '2' }),
    '1x2_total_ft_away',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Dupla Chance', selecao: '1X' }),
    'dupla_total_ft_1x',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Ambas as Equipes Marcam', selecao: 'Não' }),
    'btts_total_ft_nao',
  );
});

test('inferMarketKey faz fallback raw para mercado nao suportado', () => {
  const key = inferMarketKey({ mercado: 'Jogador - Finalizacoes', selecao: 'A. Exemplo', linha: '1.5' });
  assert.match(key, /^legacy_raw_[a-f0-9]{24}$/);
});

test('inferMarketKey reconhece mercados live ampliados', () => {
  const match = { home_team: 'Arsenal', away_team: 'Burnley' };
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Handicap', selecao: 'Mais de -0.5', linha: '-0.5', team_tab: 'Arsenal' }),
    'asian_handicap_total_ft_home_minus_0_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: '1º Tempo - Handicap de Escanteio', selecao: 'Mais de 2.5', linha: '2.5', team_tab: 'Burnley' }),
    'escanteios_handicap_total_ht_away_plus_2_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Escanteios - Handicap', selecao: 'Mais de -5.5', linha: '-5.5', team_tab: 'Arsenal' }),
    'escanteios_handicap_total_ft_home_minus_5_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Escanteios - Handicap', selecao: 'Mais de 5.5', linha: '5.5', team_tab: 'Burnley' }),
    'escanteios_handicap_total_ft_away_plus_5_5',
  );
  assert.equal(
    inferMarketKey({ mercado: '1° Tempo - Cartões 1X2', selecao: 'X' }),
    'cartoes_1x2_total_ht_draw',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Equipe Com Mais Chutes no Gol (1X2)', selecao: '2' }),
    'chutes_alvo_1x2_total_ft_away',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Total de Cartões Vermelhos', selecao: 'Menos de 0.5', linha: '0.5' }),
    'cartoes_vermelhos_total_ft_under_0_5',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Ambas as Equipes Marcam 2 ou Mais Gols', selecao: 'Sim' }),
    'btts_2plus_total_ft_sim',
  );
});

test('buildQuoteKey preserva snapshots distintos por coleta', () => {
  const baseRow = {
    home_team: 'Vitória BA',
    away_team: 'Bahia',
    liga: 'brasileiro',
    data_jogo: '2026-03-11',
    mercado: 'Resultado Final',
    selecao: '1',
    linha: '',
    fixture_id: 0,
    url_partida: 'https://superbet.bet.br/odds/futebol/bahia-x-vitoria-11561130/',
  };

  const firstKey = buildQuoteKey({ ...baseRow, coleta_id: 'sb_a' }, 'brasileirao');
  const secondKey = buildQuoteKey({ ...baseRow, home_team: 'Vitória', coleta_id: 'sb_b' }, 'brasileirao');

  assert.notEqual(firstKey, secondKey);
});

test('buildQuoteSignature ignora coleta e preserva identidade da cotacao', () => {
  const baseRow = {
    id_confronto: 'match_1',
    home_team: 'Arsenal',
    away_team: 'Burnley',
    data_jogo: '2026-05-18',
    mercado: 'Resultado Final',
    selecao: '1',
    linha: '',
    fixture_id: 12099608,
  };

  const first = buildQuoteSignature({ ...baseRow, coleta_id: 'coleta_a' }, 'premier-league');
  const second = buildQuoteSignature({ ...baseRow, coleta_id: 'coleta_b' }, 'premier-league');

  assert.equal(first, second);
  assert.match(first, /^bookline_sig_[a-f0-9]{40}$/);
});

test('inferMarketKey reconhece gols por equipe FT e HT', () => {
  const match = { home_team: 'AFC Bournemouth', away_team: 'Manchester City' };
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Total de Gols da Equipe', selecao: 'MAIS Bournemouth', linha: '0.5' }),
    'gols_home_ft_over_0_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Total de Gols da Equipe', selecao: 'MENOS Manchester City', linha: '1.5' }),
    'gols_away_ft_under_1_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: '1º Tempo - Total de Gols do Time', selecao: 'Mais de 0.5', linha: '0.5', scope: 'equipe_home' }),
    'gols_home_ht_over_0_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: '1º Tempo - Total de Gols do Time', selecao: 'Menos de 1.5', linha: '1.5', team_tab: 'Manchester City' }),
    'gols_away_ht_under_1_5',
  );
});

test('inferMarketKey aceita home/away em dialeto portugues', () => {
  const match = { equipe_home: 'Arsenal', equipe_away: 'Burnley' };
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Escanteios - Handicap', selecao: 'Mais de -5.5', linha: '-5.5', team_tab: 'Arsenal' }),
    'escanteios_handicap_total_ft_home_minus_5_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: '1º Tempo - Handicap de Escanteio', selecao: 'Mais de 2.5', linha: '2.5', team_tab: 'Burnley' }),
    'escanteios_handicap_total_ht_away_plus_2_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Resultado Final (1X2)', selecao: 'Burnley' }),
    '1x2_total_ft_away',
  );
});

test('buildQuoteSignature normaliza home/away em ambos os dialetos', () => {
  const base = {
    id_confronto: 'match_1',
    data_jogo: '2026-05-18',
    mercado: 'Escanteios - Handicap',
    selecao: 'Mais de -5.5',
    linha: '-5.5',
    team_tab: 'Arsenal',
    fixture_id: 12099608,
  };
  const english = buildQuoteSignature({ ...base, home_team: 'Arsenal', away_team: 'Burnley' }, 'premier-league');
  const portuguese = buildQuoteSignature({ ...base, equipe_home: 'Arsenal', equipe_away: 'Burnley' }, 'premier-league');
  assert.equal(portuguese, english);
});

test('inferMarketKey reconhece labels exatos da tela Superbet', () => {
  const match = { home_team: 'AFC Bournemouth', away_team: 'Manchester City' };
  assert.equal(
    inferMarketKey({ ...match, mercado: '1º Tempo - Finalizações 1X2', selecao: 'Manchester City' }),
    'chutes_1x2_total_ht_away',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Total de Desarmes', selecao: 'Mais de 30.5', linha: '30.5' }),
    'desarmes_total_ft_over_30_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Total de Desarmes da Equipe', selecao: 'Menos de 15.5', linha: '15.5', team_tab: 'AFC Bournemouth' }),
    'desarmes_home_ft_under_15_5',
  );
  assert.equal(
    inferMarketKey({ ...match, mercado: 'Total de Defesas do Goleiro da Equipe', selecao: 'Mais de 3.5', linha: '3.5', team_tab: 'Manchester City' }),
    'defesas_away_ft_over_3_5',
  );
  assert.equal(
    inferMarketKey({ mercado: 'Total de Gols Ímpar/Par', selecao: 'Ímpar' }),
    'gols_oddeven_total_ft_impar',
  );
  assert.equal(
    inferMarketKey({ mercado: '1º Tempo - Escanteios Ímpar/Par', selecao: 'Par' }),
    'escanteios_oddeven_total_ht_par',
  );
  assert.equal(
    inferMarketKey({ mercado: '2º Tempo - Total de Gols', selecao: 'Menos de 1.5', linha: '1.5' }),
    'gols_total_2t_under_1_5',
  );
});