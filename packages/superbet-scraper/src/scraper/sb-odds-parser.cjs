'use strict';

/**
 * Parser de odds brutas do Bet Builder da Superbet.
 *
 * Input:  raw DOM entries { heading, lineText, outcome, odd, teamTab, sectionName }
 * Output: structured records prontos para sb_odds_raw
 *
 * Responsabilidades:
 *  - Resolve heading → family/scope/period via HEADING_MAP + DYNAMIC_HEADINGS
 *  - Normaliza outcome para o vocabulário do contrato (mais/menos/sim/nao/1/X/2/...)
 *  - Normaliza line (vírgula→ponto, sinal preservado)
 *  - Resolve scope para mercados de equipe (team_tabs → equipe_home/equipe_away)
 *  - Rejeita registros inválidos com log
 */

const { HEADING_MAP, DYNAMIC_HEADINGS } = require('./sb-selectors.cjs');

// --- Outcome normalization ---
const OUTCOME_ALIASES = Object.freeze({
  'mais':  'mais',   'over':  'mais',  'sim': 'sim',  'yes': 'sim',
  'menos': 'menos',  'under': 'menos', 'nao': 'nao',  'não': 'nao', 'no': 'nao',
  '1': '1', 'x': 'X', 'X': 'X', '2': '2',
  '1x': '1X', '1X': '1X', '12': '12', 'x2': 'X2', 'X2': 'X2',
  'gol': 'gol', 'semgol': 'semgol', 'sem gol': 'semgol',
  // v2.0.0 — ímpar/par
  'par': 'par', 'even': 'par', 'pares': 'par',
  'ímpar': 'impar', 'impar': 'impar', 'odd': 'impar', 'ímpares': 'impar', 'impares': 'impar',
});

const VALID_OUTCOMES = new Set([
  'mais', 'menos', 'sim', 'nao',
  '1', 'X', '2', '1X', '12', 'X2',
  'gol', 'semgol',
  'par', 'impar',
]);

/**
 * Normaliza o texto de outcome do DOM para o vocabulário do contrato.
 * @param {string} raw — ex: 'Mais', 'Menos', 'Sim', '1', 'X', ...
 * @returns {string|null} outcome normalizado ou null se inválido
 */
function normalizeOutcome(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim().toLowerCase();
  const mapped = OUTCOME_ALIASES[trimmed];
  if (mapped) return mapped;
  // Fallback: check direct (case-sensitive for X)
  if (VALID_OUTCOMES.has(trimmed)) return trimmed;
  if (VALID_OUTCOMES.has(raw.trim())) return raw.trim();
  return null;
}

function normalizeLabelOutcome(raw, meta, homeTeam, awayTeam) {
  const direct = normalizeOutcome(raw);
  if (direct) return direct;
  if (meta?.type !== 'label' || !meta?.labels?.includes('1') || !meta?.labels?.includes('2')) return null;
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'empate') return 'X';
  if (homeTeam && value === homeTeam.toLowerCase().trim()) return '1';
  if (awayTeam && value === awayTeam.toLowerCase().trim()) return '2';
  return null;
}

/**
 * Normaliza line text do DOM → número.
 * Aceita vírgulas, sinais (+/-), espaços.
 * @param {string|number|null} raw
 * @returns {{ line: number|null, lineStr: string|null }}
 */
function normalizeLine(raw) {
  if (raw == null || raw === '') return { line: null, lineStr: null };
  const str = String(raw).trim().replace(',', '.');
  const num = parseFloat(str);
  if (isNaN(num)) return { line: null, lineStr: null };
  return { line: num, lineStr: str };
}

/**
 * Resolve heading para metadados (family, scope, period, type).
 * Tenta HEADING_MAP exato primeiro, depois DYNAMIC_HEADINGS via regex.
 *
 * @param {string} heading
 * @param {string|null} teamTab — nome do time selecionado na aba
 * @param {string} homeTeam — nome do time da casa
 * @param {string} awayTeam — nome do time visitante
 * @returns {object|null} { family, scope, period, type, labels?, team_tabs? }
 */
function resolveHeading(heading, teamTab, homeTeam, awayTeam) {
  // 1. Exact match
  const exact = HEADING_MAP[heading];
  if (exact) {
    const meta = { ...exact };
    // Resolve scope for team markets
    if (meta.team_tabs && teamTab) {
      meta.scope = resolveTeamScope(teamTab, homeTeam, awayTeam);
    }
    return meta;
  }

  // 2. Dynamic headings (regex)
  for (const dyn of DYNAMIC_HEADINGS) {
    const m = heading.match(dyn.re);
    if (m) {
      const teamName = m[1].trim();
      const scope = resolveTeamScope(teamName, homeTeam, awayTeam);
      return { family: dyn.family, scope, period: dyn.period, type: dyn.type, labels: dyn.labels, canonical_heading: dyn.canonical_heading };
    }
  }

  return null;
}

/**
 * Resolve o nome do time → 'equipe_home' | 'equipe_away' | 'total'
 */
function resolveTeamScope(teamName, homeTeam, awayTeam) {
  if (!teamName) return 'total';
  const norm = teamName.toLowerCase().trim();
  if (homeTeam && norm === homeTeam.toLowerCase().trim()) return 'equipe_home';
  if (awayTeam && norm === awayTeam.toLowerCase().trim()) return 'equipe_away';
  // Fuzzy: substring match
  if (homeTeam && (norm.includes(homeTeam.toLowerCase()) || homeTeam.toLowerCase().includes(norm))) return 'equipe_home';
  if (awayTeam && (norm.includes(awayTeam.toLowerCase()) || awayTeam.toLowerCase().includes(norm))) return 'equipe_away';
  return 'total';
}

/**
 * Resolve a direction para o contrato: 'over'|'under'|'label'|'handicap'
 */
function resolveDirection(type, outcome) {
  if (type === 'handicap') return 'handicap';
  if (type === 'label') return 'label';
  if (type === 'over_under') {
    const norm = normalizeOutcome(outcome);
    if (norm === 'mais') return 'over';
    if (norm === 'menos') return 'under';
    return null;
  }
  return null;
}

/**
 * Parseia um array de raw entries do DOM em records prontos para sb_odds_raw.
 *
 * @param {Array<object>} rawEntries — cada entry: { heading, lineText, outcome, odd, teamTab, sectionName }
 * @param {{ homeTeam: string, awayTeam: string, matchId: number, runId: string }} context
 * @returns {{ records: Array<object>, skipped: Array<object>, stats: object }}
 */
function parseRawEntries(rawEntries, context) {
  const { homeTeam, awayTeam, matchId, runId } = context;
  const records = [];
  const skipped = [];
  const familyCounts = {};

  for (const entry of rawEntries) {
    const { heading, lineText, outcome: rawOutcome, odd: rawOdd, teamTab, sectionName } = entry;

    // Resolve heading
    const meta = resolveHeading(heading, teamTab, homeTeam, awayTeam);
    if (!meta) {
      skipped.push({ reason: 'unknown_heading', heading, entry });
      continue;
    }

    // Normalize outcome
    const outcome = normalizeLabelOutcome(rawOutcome, meta, homeTeam, awayTeam);
    if (!outcome) {
      skipped.push({ reason: 'invalid_outcome', rawOutcome, heading, entry });
      continue;
    }

    // Validate outcome for market type
    if (meta.type === 'over_under' && outcome !== 'mais' && outcome !== 'menos') {
      skipped.push({ reason: 'outcome_type_mismatch', outcome, type: meta.type, heading, entry });
      continue;
    }

    // Normalize odd
    const odd = typeof rawOdd === 'number' ? rawOdd : parseFloat(String(rawOdd).replace(',', '.'));
    if (isNaN(odd) || odd <= 1.0) {
      skipped.push({ reason: 'invalid_odd', rawOdd, heading, entry });
      continue;
    }

    // Normalize line
    const { line, lineStr } = normalizeLine(lineText);

    // Line validation
    if (meta.type === 'over_under' && line == null) {
      skipped.push({ reason: 'missing_line_for_numeric', heading, entry });
      continue;
    }
    if (meta.type === 'label' && line != null) {
      // Label markets allow null line — if DOM gave a line, keep it for handicap label
    }

    // Direction
    const direction = resolveDirection(meta.type, outcome);
    if (!direction) {
      skipped.push({ reason: 'unresolvable_direction', type: meta.type, outcome, heading, entry });
      continue;
    }

    const record = {
      run_id:       runId,
      match_id:     matchId,
      heading:       meta.canonical_heading || heading,
      line:         meta.type === 'label' ? null : line,
      line_str:     meta.type === 'label' ? null : lineStr,
      outcome,
      odd,
      family:       meta.family,
      scope:        meta.scope,
      period:       meta.period,
      odd_uuid:     entry.oddUuid || null,
      section_name: sectionName || null,
      team_tab:     teamTab || null,
    };

    records.push(record);
    familyCounts[meta.family] = (familyCounts[meta.family] || 0) + 1;
  }

  return {
    records,
    skipped,
    stats: {
      total_raw:     rawEntries.length,
      total_parsed:  records.length,
      total_skipped: skipped.length,
      families:      familyCounts,
    },
  };
}

module.exports = {
  normalizeOutcome,
  normalizeLine,
  resolveHeading,
  resolveTeamScope,
  resolveDirection,
  parseRawEntries,
  OUTCOME_ALIASES,
  VALID_OUTCOMES,
};
