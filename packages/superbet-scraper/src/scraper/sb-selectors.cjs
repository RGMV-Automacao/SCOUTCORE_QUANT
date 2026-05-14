'use strict';

/**
 * Selectors centralizados para o DOM do Bet Builder da Superbet.
 * Fonte: scan real 2026-04-09 (beta superbet-core.mjs + superbet-markets.json).
 */

// --- DOM selectors ---
const DOM = Object.freeze({
  LOGIN_USERNAME:     'input[name="username"]',
  LOGIN_PASSWORD:     'input[name="password"]',
  LOGIN_SUBMIT:       'button[type="submit"]',
  LOGIN_COOKIE:       'sb-production-token',
  WELCOME_CLOSE:      'button:has-text("FECHAR")',
  CRIAR_APOSTA_TAB:   'Criar Aposta',
  MARKET_HEADER_NAME: '.market-header-base__name',
  MARKET_HEADER:      '.market-header-base',
  MARKET_SECTION:     '.bet-builder__market-container',
  MARKET_SCROLLER:    '.infinite-scroller',
  ODD_BUTTON_RE:      /^\d+[\.,]\d{2,3}$/,
  ENDED_RE:           /fim de jogo|encerrado|finalizado|full.?time/i,
});

// --- Heading → family/scope/period/type lookup (37 estáticos + 2 dinâmicos, 8 famílias) ---
// Mapa flat: heading exato → metadados.  Headings dinâmicos ({Home}/{Away}) em DYNAMIC_HEADINGS.
const HEADING_MAP = Object.freeze({
  // === GOLS ===
  'Total de Gols':                           { family: 'gols', scope: 'total',    period: 'FT', type: 'over_under' },
  'Total de Gols da Equipe':                 { family: 'gols', scope: 'equipe',   period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Gols':               { family: 'gols', scope: 'total',    period: '1T', type: 'over_under' },
  '1º Tempo - Total de Gols do Time':       { family: 'gols', scope: 'equipe',   period: '1T', type: 'over_under', team_tabs: true },
  'Ambas as Equipes Marcam':                 { family: 'gols', scope: 'total',    period: 'FT', type: 'label', labels: ['sim', 'nao'] },
  '1° Tempo - Ambas as Equipes Marcam':      { family: 'gols', scope: 'total',    period: '1T', type: 'label', labels: ['sim', 'nao'] },

  // === ESCANTEIOS ===
  'Total de Escanteios':                     { family: 'escanteios', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Escanteios da Equipe':           { family: 'escanteios', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Escanteios':          { family: 'escanteios', scope: 'total',  period: '1T', type: 'over_under' },
  '1º Tempo - Total de Escanteios da Equipe':{ family: 'escanteios', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },
  'Escanteios - Handicap':                   { family: 'escanteios', scope: 'total',  period: 'FT', type: 'handicap' },
  'Equipe Com Mais Escanteios (1X2)':        { family: 'escanteios', scope: 'total',  period: 'FT', type: 'label', labels: ['1', 'X', '2'] },
  '1º Tempo - Time com Mais Escanteios':     { family: 'escanteios', scope: 'total',  period: '1T', type: 'label', labels: ['1', 'X', '2'] },

  // === CARTÕES ===
  'Total de Cartões':                        { family: 'cartoes', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Cartões da Equipe':              { family: 'cartoes', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Cartões':             { family: 'cartoes', scope: 'total',  period: '1T', type: 'over_under' },
  '1º Tempo - Total de Cartões da Equipe':   { family: 'cartoes', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },
  'Equipe com Mais Cartões (1X2)':           { family: 'cartoes', scope: 'total',  period: 'FT', type: 'label', labels: ['1', 'X', '2'] },

  // === CHUTES NO GOL ===
  'Total de Chutes no Gol':                  { family: 'chutes', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Chutes no Gol da Equipe':        { family: 'chutes', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Chutes no Gol':       { family: 'chutes', scope: 'total',  period: '1T', type: 'over_under' },
  '1º Tempo - Chutes no Gol Totais da Equipe':{ family: 'chutes', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },
  'Equipe Com Mais Chutes no Gol (1X2)':     { family: 'chutes', scope: 'total',  period: 'FT', type: 'label', labels: ['1', 'X', '2'] },

  // === FINALIZAÇÕES ===
  'Total de Finalizações':                   { family: 'finalizacoes', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Finalizações da Equipe':         { family: 'finalizacoes', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Finalizações':        { family: 'finalizacoes', scope: 'total',  period: '1T', type: 'over_under' },
  'Equipe Com Mais Finalizações (1X2)':      { family: 'finalizacoes', scope: 'total',  period: 'FT', type: 'label', labels: ['1', 'X', '2'] },

  // === FALTAS ===
  'Total de Faltas':                         { family: 'faltas', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Faltas da Equipe':               { family: 'faltas', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Faltas':              { family: 'faltas', scope: 'total',  period: '1T', type: 'over_under' },
  '1º Tempo - Total de Faltas da Equipe':    { family: 'faltas', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },

  // === IMPEDIMENTOS ===
  'Total de Impedimentos':                   { family: 'impedimentos', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Impedimentos da Equipe':         { family: 'impedimentos', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Impedimentos':        { family: 'impedimentos', scope: 'total',  period: '1T', type: 'over_under' },
  // Impedimentos 1T equipe: headings dinâmicos — ver DYNAMIC_HEADINGS

  // === RESULTADO ===
  'Resultado Final':                         { family: 'resultado', scope: 'total', period: 'FT', type: 'label', labels: ['1', 'X', '2'] },
  'Dupla Chance':                            { family: 'resultado', scope: 'total', period: 'FT', type: 'label', labels: ['1X', '12', 'X2'] },
  'Handicap':                                { family: 'resultado', scope: 'total', period: 'FT', type: 'handicap' },
  '1º Tempo - Handicap':                     { family: 'resultado', scope: 'total', period: '1T', type: 'handicap' },

  // === HEADINGS ADICIONAIS (descobertos em 2026-04-16) ===
  // Resultado 1T
  '1º Tempo - Resultado (1X2)':              { family: 'resultado', scope: 'total', period: '1T', type: 'label', labels: ['1', 'X', '2'] },
  '1º Tempo - Dupla Chance':                 { family: 'resultado', scope: 'total', period: '1T', type: 'label', labels: ['1X', '12', 'X2'] },
  // Cartões extras
  '1° Tempo - Cartões 1X2':                  { family: 'cartoes', scope: 'total',  period: '1T', type: 'label', labels: ['1', 'X', '2'] },
  'Total de Cartões Vermelhos':              { family: 'cartoes_vermelhos', scope: 'total',  period: 'FT', type: 'over_under' },
  // Finalizações 1T total/equipe
  '1º Tempo - Finalizações Totais da Equipe':{ family: 'finalizacoes', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },
  // Escanteios 1T handicap
  '1º Tempo - Handicap de Escanteio':        { family: 'escanteios', scope: 'total',  period: '1T', type: 'handicap' },
  // Gols extras
  'Ambas as Equipes Marcam 2 ou Mais Gols':  { family: 'gols', scope: 'total',    period: 'FT', type: 'label', labels: ['sim', 'nao'] },
});

/**
 * Headings dinâmicos (contêm nome do time).
 * Cada entry: regex → metadados.
 * O parser tentará match via regex quando o heading exato não estiver no HEADING_MAP.
 */
const DYNAMIC_HEADINGS = [
  { re: /^1º Tempo - (.+) - Marcar Gol$/,    family: 'gols',         scope: '_dynamic_team', period: '1T', type: 'label', labels: ['sim', 'nao'] },
  { re: /^1º Tempo - (.+) Impedimentos$/,     family: 'impedimentos', scope: '_dynamic_team', period: '1T', type: 'over_under' },
  // Cartões vermelhos por equipe (dinâmico)
  { re: /^(.+) - Total de Cartões Vermelhos$/, family: 'cartoes_vermelhos', scope: '_dynamic_team', period: 'FT', type: 'over_under' },
  // Defesas do goleiro (dinâmico — inclui nome do time)
  { re: /^Total de Defesas do Goleiro (.+)$/,  family: 'defesas',     scope: '_dynamic_team', period: 'FT', type: 'over_under' },
  { re: /^1º Tempo - Total de Defesas do Goleiro (.+)$/, family: 'defesas', scope: '_dynamic_team', period: '1T', type: 'over_under' },
];

module.exports = { DOM, HEADING_MAP, DYNAMIC_HEADINGS };
