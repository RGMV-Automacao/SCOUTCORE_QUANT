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

// --- Heading → family/scope/period/type lookup ---
// Mapa flat: heading exato → metadados.  Headings dinâmicos ({Home}/{Away}) em DYNAMIC_HEADINGS.
const HEADING_MAP = Object.freeze({
  // === GOLS ===
  'Total de Gols':                           { family: 'gols', scope: 'total',    period: 'FT', type: 'over_under' },
  'Total de Gols da Equipe':                 { family: 'gols', scope: 'equipe',   period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Gols':               { family: 'gols', scope: 'total',    period: '1T', type: 'over_under' },
  '2º Tempo - Total de Gols':               { family: 'gols', scope: 'total',    period: '2T', type: 'over_under' },
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

  // === CHUTES NO GOL (canônico: chutes_alvo — "shots on target") ===
  'Total de Chutes no Gol':                  { family: 'chutes_alvo', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Chutes no Gol da Equipe':        { family: 'chutes_alvo', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Chutes no Gol':       { family: 'chutes_alvo', scope: 'total',  period: '1T', type: 'over_under' },
  '1º Tempo - Chutes no Gol Totais da Equipe':{ family: 'chutes_alvo', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },
  'Equipe Com Mais Chutes no Gol (1X2)':     { family: 'chutes_alvo', scope: 'total',  period: 'FT', type: 'label', labels: ['1', 'X', '2'] },

  // === FINALIZAÇÕES (canônico: chutes — "total shots") ===
  'Total de Finalizações':                   { family: 'chutes', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Finalizações da Equipe':         { family: 'chutes', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Finalizações':        { family: 'chutes', scope: 'total',  period: '1T', type: 'over_under' },
  'Equipe Com Mais Finalizações (1X2)':      { family: 'chutes', scope: 'total',  period: 'FT', type: 'label', labels: ['1', 'X', '2'] },
  '1º Tempo - Finalizações 1X2':             { family: 'chutes', scope: 'total',  period: '1T', type: 'label', labels: ['1', 'X', '2'] },

  // === DEFESAS DO GOLEIRO ===
  'Total de Defesas do Goleiro':             { family: 'defesas', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Defesas do Goleiro da Equipe':   { family: 'defesas', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Defesas do Goleiro':  { family: 'defesas', scope: 'total',  period: '1T', type: 'over_under' },
  '1º Tempo - Total de Defesas do Goleiro da Equipe': { family: 'defesas', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },

  // === DESARMES ===
  'Total de Desarmes':                       { family: 'desarmes', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Desarmes da Equipe':             { family: 'desarmes', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },

  // === FALTAS ===
  'Total de Faltas':                         { family: 'faltas', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Faltas da Equipe':               { family: 'faltas', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Faltas':              { family: 'faltas', scope: 'total',  period: '1T', type: 'over_under' },
  '1º Tempo - Total de Faltas da Equipe':    { family: 'faltas', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },

  // === IMPEDIMENTOS ===
  'Total de Impedimentos':                   { family: 'impedimentos', scope: 'total',  period: 'FT', type: 'over_under' },
  'Total de Impedimentos da Equipe':         { family: 'impedimentos', scope: 'equipe', period: 'FT', type: 'over_under', team_tabs: true },
  '1º Tempo - Total de Impedimentos':        { family: 'impedimentos', scope: 'total',  period: '1T', type: 'over_under' },

  // === RESULTADO ===
  'Resultado Final (1X2)':                   { family: 'resultado', scope: 'total', period: 'FT', type: 'label', labels: ['1', 'X', '2'], canonical_heading: 'Resultado Final (1X2)' },
  'Resultado Final':                         { family: 'resultado', scope: 'total', period: 'FT', type: 'label', labels: ['1', 'X', '2'], canonical_heading: 'Resultado Final (1X2)' },
  'Dupla Chance':                            { family: 'resultado', scope: 'total', period: 'FT', type: 'label', labels: ['1X', '12', 'X2'] },
  // NOTE v2.0.0: 'Handicap' (gols europeu) e '1º Tempo - Handicap' REMOVIDOS — fora do whitelist Superbet.

  // === HEADINGS ADICIONAIS (descobertos em 2026-04-16) ===
  // Resultado 1T
  '1º Tempo - Resultado (1X2)':              { family: 'resultado', scope: 'total', period: '1T', type: 'label', labels: ['1', 'X', '2'] },
  '1º Tempo - Dupla Chance':                 { family: 'resultado', scope: 'total', period: '1T', type: 'label', labels: ['1X', '12', 'X2'] },
  // Cartões extras
  '1° Tempo - Cartões 1X2':                  { family: 'cartoes', scope: 'total',  period: '1T', type: 'label', labels: ['1', 'X', '2'] },
  // NOTE v2.0.0: 'Total de Cartões Vermelhos' REMOVIDO — família cartoes_vermelhos fora do whitelist.
  // Finalizações 1T total/equipe (canônico: chutes)
  '1º Tempo - Finalizações Totais da Equipe':{ family: 'chutes', scope: 'equipe', period: '1T', type: 'over_under', team_tabs: true },
  // Escanteios 1T handicap
  '1º Tempo - Handicap de Escanteio':        { family: 'escanteios', scope: 'total',  period: '1T', type: 'handicap' },
  // NOTE v2.0.0: 'Ambas as Equipes Marcam 2 ou Mais Gols' REMOVIDO — não está no whitelist.

  // === ÍMPAR/PAR (v2.0.0) ===
  'Total de Gols Ímpar/Par':                 { family: 'gols_oddeven', scope: 'total', period: 'FT', type: 'label', labels: ['par', 'impar'] },
  '1º Tempo - Total de Gols Ímpar/Par':      { family: 'gols_oddeven', scope: 'total', period: '1T', type: 'label', labels: ['par', 'impar'] },
  'Ímpar/Par - Escanteios':                  { family: 'escanteios_oddeven', scope: 'total', period: 'FT', type: 'label', labels: ['par', 'impar'] },
  '1º Tempo - Escanteios Ímpar/Par':         { family: 'escanteios_oddeven', scope: 'total', period: '1T', type: 'label', labels: ['par', 'impar'] },
});

/**
 * Headings dinâmicos (contêm nome do time).
 * Cada entry: regex → metadados.
 * O parser tentará match via regex quando o heading exato não estiver no HEADING_MAP.
 */
const DYNAMIC_HEADINGS = [
  { re: /^(.+) - Desarmes$/,                  family: 'desarmes',     scope: '_dynamic_team', period: 'FT', type: 'over_under', canonical_heading: 'Total de Desarmes da Equipe' },
  // NOTE v2.0.0: regex de cartoes_vermelhos removida — família fora do whitelist Superbet.
  // Defesas do goleiro (dinâmico — inclui nome do time)
  { re: /^Total de Defesas do Goleiro (.+)$/,  family: 'defesas',     scope: '_dynamic_team', period: 'FT', type: 'over_under', canonical_heading: 'Total de Defesas do Goleiro da Equipe' },
  { re: /^1º Tempo - Total de Defesas do Goleiro (.+)$/, family: 'defesas', scope: '_dynamic_team', period: '1T', type: 'over_under', canonical_heading: '1º Tempo - Total de Defesas do Goleiro da Equipe' },
];

module.exports = { DOM, HEADING_MAP, DYNAMIC_HEADINGS };
