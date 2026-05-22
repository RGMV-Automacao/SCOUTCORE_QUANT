import { createHash, randomUUID } from 'node:crypto';
import { applyStrategy, listStrategies, getStrategyConfig } from '@scoutcore/strategy-engine';
import { getRaw as getQualityGates } from '@scoutcore/quality-gates';
import { getRunsStore } from './runs.mjs';
import { validateYankeeAgainstSuperbet } from '../yankee-superbet-validator.mjs';
import { buildValidatedTicketSubmitPreview, isRealSubmitEnabled, submitValidatedTicket } from '../bookline-ticket-submitter.mjs';
import { isBrowserSubmitEnabled } from '../bookline-session.mjs';

const MANUAL_YANKEE_DESIGN = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  [0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3],
  [0, 1, 2, 3],
];

const manualTicketKind = (size) => {
  if (size === 2) return 'double';
  if (size === 3) return 'triple';
  return 'fourfold';
};

const manualSlotKey = (matchId, marketKey) => `${matchId ?? ''}::${marketKey ?? ''}`;
const DEFAULT_SB_REPAIR_PASSES = 2;

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getExternalValidationConfig() {
  const qg = getQualityGates();
  const guardrails = qg.guardrails ?? {};
  const gates = qg.gates ?? {};
  const maxDropFallback = Number(guardrails.price_drift_max_pct ?? gates.max_odds_drift_pct ?? 8);
  return {
    maxDropPct: numberFromEnv('SCOUTCORE_SB_DRY_RUN_MAX_DROP_PCT', maxDropFallback),
    maxFavorableDriftPct: numberFromEnv('SCOUTCORE_SB_FAVORABLE_DRIFT_WARN_PCT', Number(guardrails.favorable_price_drift_warn_pct ?? 25)),
    minActualComboEv: numberFromEnv('SCOUTCORE_SB_MIN_ACTUAL_COMBO_EV', Number(guardrails.min_actual_combo_ev ?? 0)),
  };
}

export function isExternalValidationPassed(externalValidation) {
  const summary = externalValidation?.summary;
  if (!summary) return false;
  return Number(summary.tickets_total) > 0
    && Number(summary.tickets_ok) === Number(summary.tickets_total)
    && Number(summary.boards_failed ?? 0) === 0
    && Number(summary.gaps_total ?? 0) === 0;
}

export function countSubmittableValidationTickets(externalValidation) {
  return (externalValidation?.tickets || []).filter((ticket) => ticket?.status === 'ok').length;
}

function toPositiveIntegerSet(values) {
  const raw = Array.isArray(values) ? values : values == null ? [] : [values];
  const parsed = raw
    .flatMap((value) => String(value).split(','))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return new Set(parsed);
}

function toKindSet(values) {
  const raw = Array.isArray(values) ? values : values == null ? [] : [values];
  const parsed = raw
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parsed);
}

function normalizeTicketSelection(selection = {}) {
  const ticketIdxs = toPositiveIntegerSet(selection.ticket_idxs ?? selection.ticket_idx);
  const ticketKinds = toKindSet(selection.ticket_kinds ?? selection.ticket_kind);
  const maxTickets = Number(selection.max_tickets ?? selection.limit_tickets ?? 0);
  return {
    ticketIdxs,
    ticketKinds,
    maxTickets: Number.isInteger(maxTickets) && maxTickets > 0 ? maxTickets : null,
  };
}

function ticketSelectionFromBody(body = {}) {
  return {
    ticket_idx: body.ticket_idx,
    ticket_idxs: body.ticket_idxs,
    ticket_kind: body.ticket_kind,
    ticket_kinds: body.ticket_kinds,
    max_tickets: body.max_tickets ?? body.limit_tickets,
  };
}

function parseJsonOr(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function inferTicketKind(ticket) {
  if (ticket?.kind) return String(ticket.kind).toLowerCase();
  const size = Array.isArray(ticket?.boards)
    ? ticket.boards.length
    : Array.isArray(ticket?.match_ids)
      ? ticket.match_ids.length
      : 0;
  if (size === 2) return 'double';
  if (size === 3) return 'triple';
  if (size === 4) return 'fourfold';
  return '';
}

export function selectSubmittableValidationTickets(externalValidation, sourceTickets = [], selection = {}) {
  const normalized = normalizeTicketSelection(selection);
  const sourceByIdx = new Map((sourceTickets || []).map((ticket) => [Number(ticket.ticket_idx), ticket]));
  const okTickets = (externalValidation?.tickets || []).filter((ticket) => ticket?.status === 'ok');
  const filtered = [];
  for (const validationTicket of okTickets) {
    const ticketIdx = Number(validationTicket.ticket_idx);
    const sourceTicket = sourceByIdx.get(ticketIdx);
    if (normalized.ticketIdxs.size > 0 && !normalized.ticketIdxs.has(ticketIdx)) continue;
    if (normalized.ticketKinds.size > 0 && !normalized.ticketKinds.has(inferTicketKind(sourceTicket))) continue;
    filtered.push({ validationTicket, sourceTicket });
  }
  const selected = normalized.maxTickets ? filtered.slice(0, normalized.maxTickets) : filtered;
  return {
    selected,
    submittable_total: okTickets.length,
    selected_total: selected.length,
    skipped_by_filter: Math.max(0, okTickets.length - selected.length),
    ticket_selection: {
      ticket_idxs: [...normalized.ticketIdxs],
      ticket_kinds: [...normalized.ticketKinds],
      max_tickets: normalized.maxTickets,
    },
  };
}

export function computeYankeeSubmissionStatus({ isDryRun, blocking, externalValidation, realSubmitSummary } = {}) {
  const hasBlocking = Array.isArray(blocking) && blocking.length > 0;
  const submittableTickets = countSubmittableValidationTickets(externalValidation);
  if (isDryRun) {
    if (hasBlocking) return 'external_failed';
    if (externalValidation) return isExternalValidationPassed(externalValidation) ? 'external_passed' : 'external_failed';
    return 'dry_run_created';
  }
  if (realSubmitSummary?.enabled) {
    const dups = Number(realSubmitSummary.duplicates_skipped ?? 0);
    if (realSubmitSummary.submitted > 0 && (realSubmitSummary.failed > 0 || hasBlocking || realSubmitSummary.skipped > 0)) return 'partial_submitted';
    if (realSubmitSummary.failed > 0) return 'submit_failed';
    if (realSubmitSummary.submitted > 0) return 'submitted';
    if (dups > 0 && (realSubmitSummary.selected_total ?? 0) > 0 && dups >= (realSubmitSummary.selected_total ?? 0)) return 'all_duplicates_skipped';
    return 'submit_failed';
  }
  if (hasBlocking) return submittableTickets > 0 ? 'partial_ready_for_real_submit' : 'rejected';
  return 'ready_for_real_submit';
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toPositiveOdd(value) {
  const odd = Number(value);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

function collectBoardIssuesByMatch(externalValidation) {
  const reasonsByMatch = new Map();
  for (const ticket of externalValidation?.tickets || []) {
    for (const board of ticket?.boards || []) {
      if (board?.status !== 'error' || !board?.match_id) continue;
      let entry = reasonsByMatch.get(board.match_id);
      if (!entry) {
        entry = { match_id: board.match_id, match: board.match ?? null, reasons: [] };
        reasonsByMatch.set(board.match_id, entry);
      }
      if (!entry.match && board.match) entry.match = board.match;
      for (const gap of board?.gaps || []) {
        if (gap?.reason && !entry.reasons.includes(gap.reason)) entry.reasons.push(gap.reason);
      }
    }
  }
  return [...reasonsByMatch.values()];
}

export function collectRepairableDriftMatchIds(externalValidation) {
  return collectBoardIssuesByMatch(externalValidation)
    .filter((entry) => entry.reasons.length > 0 && entry.reasons.every((reason) => (
      reason.startsWith('price_drift_combo:') || reason.startsWith('actual_ev_combo:')
    )))
    .map((entry) => entry.match_id);
}

function mergeExcludedMatchIds(overrides, failedMatchIds) {
  const excluded = new Set(Array.isArray(overrides?.excluded_match_ids) ? overrides.excluded_match_ids : []);
  for (const matchId of failedMatchIds || []) excluded.add(matchId);
  return [...excluded];
}

function buildMatchLabelMap(run) {
  const labels = new Map();
  for (const slot of run?.slots || []) {
    const matchId = slot?.match_id ?? slot?.opta_match_id ?? null;
    if (!matchId || labels.has(matchId)) continue;
    const home = String(slot?.home ?? '').trim();
    const away = String(slot?.away ?? '').trim();
    labels.set(matchId, home && away ? `${home} x ${away}` : null);
  }
  return labels;
}

function summarizeSelectedMatches(yankee, matchLabels) {
  return (yankee?.board?.ready_combos || [])
    .map((combo) => {
      const matchId = combo?.match_id ?? combo?.opta_match_id ?? null;
      if (!matchId) return null;
      return {
        match_id: matchId,
        match: matchLabels.get(matchId) ?? null,
      };
    })
    .filter(Boolean);
}

async function buildAutoYankeeWithSuperbetRepair({ run, repo, overrides, validationConfig, maxRepairPasses }) {
  const matchLabels = buildMatchLabelMap(run);
  let currentOverrides = overrides ?? {};
  let yankee = await applyStrategy('yankee', run.slots, currentOverrides);
  if (yankee.error || yankee.__error) return { yankee, externalValidation: null, repairHistory: [] };

  const repairHistory = [];
  let externalValidation = null;
  const validationCache = { events: new Map(), catalogs: new Map(), quotes: new Map() };
  for (let pass = 0; pass <= maxRepairPasses; pass++) {
    const tickets = Array.isArray(yankee?.tickets) ? yankee.tickets : [];
    if (tickets.length === 0) break;

    externalValidation = await validateYankeeAgainstSuperbet({ repo, run, yankee, ...validationConfig, validationCache });
    const boardIssues = collectBoardIssuesByMatch(externalValidation);
    const selectedBefore = summarizeSelectedMatches(yankee, matchLabels);
    const failedMatchIds = collectRepairableDriftMatchIds(externalValidation);
    if (failedMatchIds.length === 0 || pass === maxRepairPasses) break;

    const nextExcluded = mergeExcludedMatchIds(currentOverrides, failedMatchIds);
    const newlyExcluded = nextExcluded.filter((matchId) => !(currentOverrides?.excluded_match_ids || []).includes(matchId));
    if (newlyExcluded.length === 0) break;

    repairHistory.push({
      pass: pass + 1,
      excluded_match_ids: newlyExcluded,
      excluded_matches: newlyExcluded.map((matchId) => {
        const issue = boardIssues.find((item) => item.match_id === matchId);
        return issue ?? { match_id: matchId, match: matchLabels.get(matchId) ?? null, reasons: [] };
      }),
      summary_before: externalValidation.summary,
    });
    currentOverrides = { ...currentOverrides, excluded_match_ids: nextExcluded };
    yankee = await applyStrategy('yankee', run.slots, currentOverrides);
    if (yankee.error || yankee.__error) break;

    const selectedAfter = summarizeSelectedMatches(yankee, matchLabels);
    const addedMatches = selectedAfter.filter((item) => !selectedBefore.some((before) => before.match_id === item.match_id));
    const lastEntry = repairHistory[repairHistory.length - 1];
    lastEntry.added_match_ids = addedMatches.map((item) => item.match_id);
    lastEntry.added_matches = addedMatches;
  }

  return { yankee, externalValidation, repairHistory, overrides: currentOverrides };
}

export function buildManualYankeeFromRunSlots({ run, legs, stakePerTicket }) {
  const requestedLegs = Array.isArray(legs) ? legs : [];
  if (requestedLegs.length < 4 || requestedLegs.length > 16) {
    return { __error: 'manual_yankee_requires_4_matches_with_1_to_4_legs_each', __status: 400 };
  }

  const seenRequestKeys = new Set();
  for (const leg of requestedLegs) {
    if (!leg?.match_id || !leg?.market_key) {
      return { __error: 'manual_leg_requires_match_id_and_market_key', __status: 400 };
    }
    const requestKey = manualSlotKey(leg.match_id, leg.market_key);
    if (seenRequestKeys.has(requestKey)) {
      return { __error: `manual_duplicate_leg:${requestKey}`, __status: 400 };
    }
    seenRequestKeys.add(requestKey);
  }

  const slotMap = new Map((run?.slots ?? []).map((slot) => [manualSlotKey(slot.match_id, slot.market_key), slot]));
  const selectedSlots = [];
  for (const leg of requestedLegs) {
    const slot = slotMap.get(manualSlotKey(leg.match_id, leg.market_key));
    if (!slot) {
      return { __error: `manual_leg_not_found_in_run:${manualSlotKey(leg.match_id, leg.market_key)}`, __status: 400 };
    }
    const marketOdd = toPositiveOdd(slot.market_odd);
    if (marketOdd == null) {
      return { __error: `manual_leg_missing_valid_market_odd:${manualSlotKey(slot.match_id, slot.market_key)}`, __status: 400 };
    }
    selectedSlots.push({ ...slot, market_odd: marketOdd });
  }

  const matchIds = new Set(selectedSlots.map((slot) => slot.match_id));
  if (matchIds.size !== 4) {
    return { __error: 'manual_yankee_requires_4_distinct_matches', __status: 400 };
  }

  const matchGroups = [];
  const groupByMatch = new Map();
  for (const slot of selectedSlots) {
    let group = groupByMatch.get(slot.match_id);
    if (!group) {
      group = { match_id: slot.match_id, slots: [] };
      groupByMatch.set(slot.match_id, group);
      matchGroups.push(group);
    }
    group.slots.push(slot);
    if (group.slots.length > 4) {
      return { __error: `manual_match_exceeds_4_legs:${slot.match_id}`, __status: 400 };
    }
  }

  const warnings = [];
  for (const slot of selectedSlots) {
    if (slot.certified !== true) {
      warnings.push(`manual_uncertified_leg:${slot.match_id}:${slot.market_key}`);
    }
  }

  const familyCounts = new Map();
  for (const slot of selectedSlots) {
    const family = slot.family || 'unknown';
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  for (const [family, count] of familyCounts.entries()) {
    if (count >= 3) warnings.push(`manual_family_concentration:${family}:${count}/4`);
  }

  const readyCombos = matchGroups.map((group, index) => {
    const comboOdd = group.slots.reduce((acc, slot) => acc * Number(slot.market_odd ?? 1), 1);
    const edgeValues = group.slots.map((slot) => Number(slot.edge_pct ?? 0)).filter(Number.isFinite);
    const qualityScore = edgeValues.length
      ? edgeValues.reduce((sum, value) => sum + value, 0) / edgeValues.length
      : 0;
    return {
      status: 'ready',
      source: 'manual_yankee',
      manual_index: index,
      match_id: group.match_id,
      combo_odd: Number(comboOdd.toFixed(4)),
      quality_score: Number(qualityScore.toFixed(4)),
      n_legs: group.slots.length,
      families: [...new Set(group.slots.map((slot) => slot.family).filter(Boolean))],
      legs: group.slots.map((slot) => ({
        ...slot,
        status: 'pending',
      })),
    };
  });

  const stake = Number(stakePerTicket);
  const tickets = MANUAL_YANKEE_DESIGN.map((indices, ticketIdx) => {
    const picked = indices.map((index) => readyCombos[index]);
    const ticketOdd = Number(picked.reduce((acc, combo) => acc * Number(combo.combo_odd ?? 1), 1).toFixed(4));
    return {
      ticket_idx: ticketIdx,
      status: 'pending',
      source: 'manual_yankee',
      kind: manualTicketKind(indices.length),
      n_legs: indices.length,
      confronto_indices: indices.slice(),
      match_ids: picked.map((combo) => combo.match_id),
      boards: picked.map((combo) => ({
        match_id: combo.match_id,
        status: 'pending',
        source: 'manual_yankee',
        legs: (combo.legs || []).map((leg) => ({
          market_key: leg.market_key,
          status: 'pending',
        })),
      })),
      ticket_odd: ticketOdd,
      stake_brl: stake,
    };
  });

  return {
    source: 'manual_yankee',
    board: {
      board_status: 'ready',
      mode: 'manual_yankee',
      product: 'classic_yankee_4_matches_1_to_4_legs_each',
      ready_combos: readyCombos,
      warnings,
      stats: {
        manual_count: readyCombos.length,
        manual_markets_count: selectedSlots.length,
        ready_count: readyCombos.length,
        approved_count: readyCombos.length,
        tickets_double: tickets.filter((ticket) => ticket.kind === 'double').length,
        tickets_triple: tickets.filter((ticket) => ticket.kind === 'triple').length,
        tickets_fourfold: tickets.filter((ticket) => ticket.kind === 'fourfold').length,
      },
    },
    tickets,
    meta: {
      yankee_status: 'ok',
      mode: 'manual_yankee',
      product: 'classic_yankee_4_matches_1_to_4_legs_each',
      n_confrontos: readyCombos.length,
      n_markets: selectedSlots.length,
      n_tickets: tickets.length,
      avg_ticket_odd: Number((tickets.reduce((sum, ticket) => sum + ticket.ticket_odd, 0) / tickets.length).toFixed(4)),
    },
  };
}

/**
 * Enriquece o retorno de applyStrategy com `result` (green/red) e
 * `actual_value` por (match_id, market_key) — vindos de `prediction`
 * após o settler. Permite UI mostrar badges e valor real em todas as
 * telas (yankee/singles-ev/duplas/board) sem alterar o strategy-engine.
 */
function enrichWithSettlement(repo, runId, result) {
  if (!runId || !result || typeof result !== 'object') return result;
  let rows;
  try {
    rows = repo.db.prepare(
      'SELECT match_id, market_key, result, actual_value FROM prediction WHERE run_id = ?'
    ).all(runId);
  } catch {
    return result;
  }
  if (!rows.length) return result;
  const map = new Map();
  for (const r of rows) map.set(`${r.match_id}::${r.market_key}`, r);

  const visit = (node, parentMid = null) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parentMid);
      return;
    }
    const mid = node.match_id ?? parentMid;
    if (mid && node.market_key) {
      const hit = map.get(`${mid}::${node.market_key}`);
      if (hit) {
        if (node.result == null) node.result = hit.result ?? null;
        if (node.actual_value == null) node.actual_value = hit.actual_value ?? null;
      }
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') visit(v, mid);
    }
  };
  visit(result);
  return result;
}

/**
 * Endpoint para aplicar estratégias sobre slots de um run.
 * GET /v1/strategies
 * GET /v1/runs/:id/strategy/:name
 */
export function registerStrategies(app, { repo }) {
  app.get('/v1/strategies', async () => {
    return { items: listStrategies() };
  });

  app.get('/v1/strategies/:name/config', async (req, reply) => {
    const { name } = req.params;
    const config = getStrategyConfig(name);
    if (!config) return reply.code(404).send({ error: 'strategy_not_found' });
    return config;
  });

  app.post('/v1/runs/:id/strategy/:name', async (req, reply) => {
    const { id, name } = req.params;
    const overrides = req.body ?? {};

    const run = getRunsStore().get(id);
    if (!run) return reply.code(404).send({ error: 'run_not_found' });

    const result = await applyStrategy(name, run.slots, overrides);

    if (result.error) {
      return reply.code(400).send({ error: result.error });
    }

    enrichWithSettlement(repo, id, result);
    return result;
  });

  // ── Yankee submission (Bloco 3.4) ─────────────────────────────────────────
  // Endpoints separados para dry-run (validação externa) e submit.
  // Ambos persistem snapshot em `yankee_submissions`; auditoria e recibos por
  // ticket ficam nas tabelas yankee_submission_audit/yankee_submission_tickets.
  const insertSubmission = repo.db.prepare(`
    INSERT INTO yankee_submissions
      (submission_id, run_id, is_dry_run, stake_per_ticket,
       tickets_count, stake_total, status, warnings, tickets_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSubmissionAudit = repo.db.prepare(`
    INSERT OR REPLACE INTO yankee_submission_audit
      (submission_id, run_id, mode, validation_scope, blocking_json,
       external_validation_json, repair_history_json, effective_overrides_json,
       real_submit_summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSubmissionTicket = repo.db.prepare(`
    INSERT OR REPLACE INTO yankee_submission_tickets
      (submission_ticket_id, submission_id, run_id, ticket_idx, ticket_hash,
       match_ids_json, stake_brl, expected_ticket_odd, actual_ticket_odd,
       status, attempts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((
      SELECT attempts FROM yankee_submission_tickets WHERE submission_ticket_id = ?
    ), 0))
  `);

  const claimSubmissionTicket = repo.db.prepare(`
    UPDATE yankee_submission_tickets
    SET status = 'submitting', attempts = attempts + 1, last_attempt_at = datetime('now'), error = NULL
    WHERE submission_ticket_id = ?
      AND external_ticket_id IS NULL
      AND status IN ('pending', 'failed', 'dry_ok')
  `);

  const markSubmissionTicketSubmitted = repo.db.prepare(`
    UPDATE yankee_submission_tickets
    SET status = 'submitted', external_ticket_id = ?, payload_hash = ?, payload_json = ?,
        response_json = ?, actual_ticket_odd = COALESCE(?, actual_ticket_odd),
        submitted_at = datetime('now'), error = NULL
    WHERE submission_ticket_id = ?
  `);

  const markSubmissionTicketFailed = repo.db.prepare(`
    UPDATE yankee_submission_tickets
    SET status = 'failed', payload_hash = COALESCE(?, payload_hash), payload_json = COALESCE(?, payload_json),
        response_json = COALESCE(?, response_json), error = ?
    WHERE submission_ticket_id = ?
  `);

  const markSubmissionTicketDuplicate = repo.db.prepare(`
    UPDATE yankee_submission_tickets
    SET status = 'duplicate_skipped',
        external_ticket_id = ?,
        error = ?,
        last_attempt_at = datetime('now')
    WHERE submission_ticket_id = ?
      AND external_ticket_id IS NULL
  `);

  const findPriorSubmittedTicketByMatchIds = repo.db.prepare(`
    SELECT submission_id, submission_ticket_id, ticket_idx, external_ticket_id,
           actual_ticket_odd, stake_brl, submitted_at
    FROM yankee_submission_tickets
    WHERE run_id = ?
      AND match_ids_json = ?
      AND status = 'submitted'
      AND external_ticket_id IS NOT NULL
      AND submission_id != ?
    ORDER BY submitted_at DESC
    LIMIT 1
  `);

  const updateSubmissionRealSummary = repo.db.prepare(`
    UPDATE yankee_submission_audit
    SET real_submit_summary_json = ?
    WHERE submission_id = ?
  `);

  const updateSubmissionStatus = repo.db.prepare(`
    UPDATE yankee_submissions
    SET status = ?, warnings = ?
    WHERE submission_id = ?
  `);

  const getSubmissionWithAudit = repo.db.prepare(`
    SELECT s.*, a.external_validation_json, a.blocking_json, a.real_submit_summary_json
    FROM yankee_submissions s
    LEFT JOIN yankee_submission_audit a ON a.submission_id = s.submission_id
    WHERE s.run_id = ? AND s.submission_id = ?
    LIMIT 1
  `);

  const getSubmissionFullDetail = repo.db.prepare(`
    SELECT s.submission_id, s.run_id, s.submitted_at, s.is_dry_run, s.stake_per_ticket,
           s.tickets_count, s.stake_total, s.status, s.warnings, s.tickets_json, s.settled_at,
           a.mode, a.validation_scope, a.blocking_json, a.external_validation_json,
           a.repair_history_json, a.effective_overrides_json, a.real_submit_summary_json
    FROM yankee_submissions s
    LEFT JOIN yankee_submission_audit a ON a.submission_id = s.submission_id
    WHERE s.run_id = ? AND s.submission_id = ?
    LIMIT 1
  `);

  const getSubmissionTicketsBySubmissionId = repo.db.prepare(`
    SELECT submission_ticket_id, ticket_idx, ticket_hash, match_ids_json, stake_brl,
           expected_ticket_odd, actual_ticket_odd, status, attempts, external_ticket_id,
           payload_hash, submitted_at, last_attempt_at, error
    FROM yankee_submission_tickets
    WHERE submission_id = ?
    ORDER BY ticket_idx
  `);

  const getLastSubmissionEffectiveOverrides = repo.db.prepare(`
    SELECT a.submission_id, a.effective_overrides_json, s.submitted_at
    FROM yankee_submission_audit a
    JOIN yankee_submissions s ON s.submission_id = a.submission_id
    WHERE a.run_id = ?
      AND a.mode = 'auto_yankee'
      AND a.effective_overrides_json IS NOT NULL
      AND a.effective_overrides_json != '{}'
    ORDER BY s.submitted_at DESC
    LIMIT 1
  `);

  function resolveInheritedOverrides({ runId, bodyOverrides, reset }) {
    if (reset === true) return { overrides: {}, source: 'reset', inheritedFromSubmissionId: null };
    if (bodyOverrides !== undefined && bodyOverrides !== null) {
      return { overrides: bodyOverrides, source: 'explicit', inheritedFromSubmissionId: null };
    }
    const last = getLastSubmissionEffectiveOverrides.get(runId);
    if (!last) return { overrides: {}, source: 'none', inheritedFromSubmissionId: null };
    const parsed = parseJsonOr(last.effective_overrides_json, {});
    const excluded = Array.isArray(parsed?.excluded_match_ids) ? parsed.excluded_match_ids : [];
    if (excluded.length === 0) return { overrides: {}, source: 'none', inheritedFromSubmissionId: null };
    return { overrides: parsed, source: 'inherited', inheritedFromSubmissionId: last.submission_id };
  }

  function validationTicketByIdx(externalValidation) {
    const map = new Map();
    for (const ticket of externalValidation?.tickets || []) map.set(Number(ticket.ticket_idx), ticket);
    return map;
  }

  function persistSubmissionAuditAndTickets({
    submissionId,
    runId,
    mode,
    validationScope,
    blocking,
    externalValidation,
    repairHistory,
    effectiveOverrides,
    tickets,
    stake,
    isDryRun,
    ticketSelection,
  }) {
    insertSubmissionAudit.run(
      submissionId,
      runId,
      mode,
      validationScope,
      JSON.stringify(blocking || []),
      externalValidation ? JSON.stringify(externalValidation) : null,
      JSON.stringify(repairHistory || []),
      JSON.stringify(effectiveOverrides || {}),
      null,
    );

    const validationMap = validationTicketByIdx(externalValidation);
    const selectedTicketIdxs = new Set();
    if (!isDryRun) {
      const selected = selectSubmittableValidationTickets(externalValidation, tickets, ticketSelection);
      for (const item of selected.selected) selectedTicketIdxs.add(Number(item.validationTicket.ticket_idx));
    }
    for (const ticket of tickets || []) {
      const validationTicket = validationMap.get(Number(ticket.ticket_idx));
      const status = isDryRun
        ? (validationTicket?.status === 'ok' ? 'dry_ok' : 'failed')
        : (validationTicket?.status === 'ok'
            ? (selectedTicketIdxs.has(Number(ticket.ticket_idx)) ? 'pending' : 'skipped')
            : 'failed');
      const submissionTicketId = `${submissionId}:T${String(ticket.ticket_idx).padStart(2, '0')}`;
      insertSubmissionTicket.run(
        submissionTicketId,
        submissionId,
        runId,
        Number(ticket.ticket_idx),
        stableHash(ticket),
        JSON.stringify(ticket.match_ids || []),
        Number(ticket.stake_brl ?? stake),
        Number.isFinite(Number(ticket.ticket_odd)) ? Number(ticket.ticket_odd) : null,
        Number.isFinite(Number(validationTicket?.actual_ticket_odd)) ? Number(validationTicket.actual_ticket_odd) : null,
        status,
        submissionTicketId,
      );
    }
  }

  async function submitRealTickets({ runId, submissionId, externalValidation, sourceTickets, stake, ticketSelection }) {
    const summary = { enabled: isRealSubmitEnabled(), submit_channel: isBrowserSubmitEnabled() ? 'browser' : 'fetch', attempted: 0, submitted: 0, failed: 0, skipped: 0, duplicates_skipped: 0, duplicates: [], errors: [] };
    const validationTickets = externalValidation?.tickets || [];
    const selection = selectSubmittableValidationTickets(externalValidation, sourceTickets, ticketSelection);
    summary.ticket_selection = selection.ticket_selection;
    summary.submittable_total = selection.submittable_total;
    summary.selected_total = selection.selected_total;
    summary.selected_ticket_idxs = selection.selected.map(({ validationTicket }) => Number(validationTicket.ticket_idx));
    summary.skipped = Math.max(0, validationTickets.length - selection.selected_total);
    if (!summary.enabled) return summary;
    if (selection.submittable_total === 0) {
      summary.errors.push('no_validated_tickets_to_submit');
      return summary;
    }
    if (selection.selected_total === 0) {
      summary.errors.push('no_tickets_selected_for_submit');
      return summary;
    }
    if (!isExternalValidationPassed(externalValidation)) {
      summary.errors.push(`external_validation_partial_only:${selection.submittable_total}/${validationTickets.length}`);
    }

    for (const { validationTicket, sourceTicket } of selection.selected) {
      const submissionTicketId = `${submissionId}:T${String(validationTicket.ticket_idx).padStart(2, '0')}`;
      const matchIdsJson = JSON.stringify(sourceTicket?.match_ids || []);
      const prior = runId
        ? findPriorSubmittedTicketByMatchIds.get(runId, matchIdsJson, submissionId)
        : null;
      if (prior?.external_ticket_id) {
        const reason = `already_submitted:${prior.external_ticket_id}`;
        summary.skipped++;
        summary.duplicates_skipped++;
        summary.duplicates.push({
          ticket_idx: Number(validationTicket.ticket_idx),
          external_ticket_id: prior.external_ticket_id,
          prior_submission_id: prior.submission_id,
          prior_submission_ticket_id: prior.submission_ticket_id,
          submitted_at: prior.submitted_at,
          actual_ticket_odd: Number.isFinite(Number(prior.actual_ticket_odd)) ? Number(prior.actual_ticket_odd) : null,
          stake_brl: Number.isFinite(Number(prior.stake_brl)) ? Number(prior.stake_brl) : null,
        });
        markSubmissionTicketDuplicate.run(prior.external_ticket_id, reason, submissionTicketId);
        continue;
      }

      const claimed = claimSubmissionTicket.run(submissionTicketId);
      if (claimed.changes !== 1) {
        summary.skipped++;
        continue;
      }

      summary.attempted++;
      try {
        const result = await submitValidatedTicket({ validationTicket, stake });
        if (result.confirmed) {
          summary.submitted++;
          markSubmissionTicketSubmitted.run(
            result.external_ticket_id,
            result.payload_hash ?? null,
            result.payload ? JSON.stringify(result.payload) : null,
            result.response_json ? JSON.stringify(result.response_json) : null,
            Number.isFinite(Number(result.actual_odd)) ? Number(result.actual_odd) : null,
            submissionTicketId,
          );
        } else {
          summary.failed++;
          summary.errors.push(result.reason || `ticket_failed:${validationTicket.ticket_idx}`);
          markSubmissionTicketFailed.run(
            result.payload_hash ?? null,
            result.payload ? JSON.stringify(result.payload) : null,
            result.response_json ? JSON.stringify(result.response_json) : null,
            result.reason || 'submit_failed',
            submissionTicketId,
          );
        }
      } catch (error) {
        summary.failed++;
        summary.errors.push(error.message);
        markSubmissionTicketFailed.run(null, null, null, error.message, submissionTicketId);
      }
    }

    return summary;
  }

  async function previewRealTickets({ externalValidation, sourceTickets, stake, ticketSelection }) {
    const selection = selectSubmittableValidationTickets(externalValidation, sourceTickets, ticketSelection);
    const summary = {
      attempted: 0,
      ready: 0,
      failed: 0,
      skipped: Math.max(0, (externalValidation?.tickets || []).length - selection.selected_total),
      submittable_total: selection.submittable_total,
      selected_total: selection.selected_total,
      ticket_selection: selection.ticket_selection,
      errors: [],
    };
    const tickets = [];
    if (selection.submittable_total === 0) summary.errors.push('no_validated_tickets_to_preview');
    if (selection.submittable_total > 0 && selection.selected_total === 0) summary.errors.push('no_tickets_selected_for_preview');

    for (const { validationTicket, sourceTicket } of selection.selected) {
      summary.attempted++;
      try {
        const preview = await buildValidatedTicketSubmitPreview({ validationTicket, stake });
        if (preview.ready) summary.ready++;
        else summary.failed++;
        tickets.push({
          ticket_idx: validationTicket.ticket_idx,
          kind: inferTicketKind(sourceTicket) || null,
          match_ids: sourceTicket?.match_ids ?? [],
          ...preview,
        });
        if (!preview.ready) summary.errors.push(preview.reason || `ticket_preview_failed:${validationTicket.ticket_idx}`);
      } catch (error) {
        summary.failed++;
        summary.errors.push(error.message);
        tickets.push({
          ticket_idx: validationTicket.ticket_idx,
          kind: inferTicketKind(sourceTicket) || null,
          match_ids: sourceTicket?.match_ids ?? [],
          ready: false,
          reason: error.message,
        });
      }
    }
    return { summary, tickets };
  }

  async function buildYankeeSubmissionResult({ runId, stakePerTicket, isDryRun, overrides, manualLegs, ticketSelection, resetOverrides }) {
    const run = getRunsStore().get(runId);
    if (!run) return { __error: 'run_not_found', __status: 404 };

    const stake = Number(stakePerTicket);
    if (!Number.isFinite(stake) || stake < 1 || stake > 100) {
      return { __error: 'invalid_stake_per_ticket_range_1_100', __status: 400 };
    }

    const isManual = manualLegs != null;
    const validationConfig = getExternalValidationConfig();
    const maxRepairPasses = numberFromEnv('SCOUTCORE_SB_REPAIR_PASSES', DEFAULT_SB_REPAIR_PASSES);
    const inheritance = isManual
      ? { overrides: overrides ?? {}, source: overrides !== undefined ? 'explicit' : 'none', inheritedFromSubmissionId: null }
      : resolveInheritedOverrides({ runId, bodyOverrides: overrides, reset: resetOverrides });
    const effectiveInputOverrides = inheritance.overrides;
    const buildResult = isManual
      ? {
          yankee: buildManualYankeeFromRunSlots({ run, legs: manualLegs, stakePerTicket: stake }),
          externalValidation: null,
          repairHistory: [],
          overrides: effectiveInputOverrides,
        }
      : await buildAutoYankeeWithSuperbetRepair({
          run,
          repo,
          overrides: effectiveInputOverrides,
          validationConfig,
          maxRepairPasses,
        });
    const yankee = buildResult.yankee;
    if (yankee.error) return { __error: yankee.error, __status: 400 };
    if (yankee.__error) return yankee;
    enrichWithSettlement(repo, runId, yankee);

    const tickets = Array.isArray(yankee.tickets) ? yankee.tickets : [];
    const warnings = Array.isArray(yankee.board?.warnings) ? [...yankee.board.warnings] : [];
    let externalValidation = buildResult.externalValidation;
    const repairHistory = Array.isArray(buildResult.repairHistory) ? buildResult.repairHistory : [];
    for (const step of repairHistory) {
      warnings.push(`superbet_repair_pass:${step.pass}:excluded_matches:${step.excluded_match_ids.length}`);
    }

    // Validação de submissão (não bloqueia dry-run; bloqueia submit real)
    const blocking = [];
    if (tickets.length === 0) blocking.push('no_tickets_in_yankee');
    const boardStatus = yankee.board?.board_status;
    if (boardStatus && boardStatus !== 'ready' && boardStatus !== 'ok') {
      blocking.push(`board_status:${boardStatus}`);
    }

    try {
      if (!externalValidation && tickets.length > 0) {
        externalValidation = await validateYankeeAgainstSuperbet({
          repo,
          run,
          yankee,
          ...validationConfig,
        });
      }
      if (externalValidation) {
        warnings.push(
          `superbet_validated:${externalValidation.summary.tickets_ok}/${externalValidation.summary.tickets_total}_tickets`
        );
        if (externalValidation.summary.boards_failed > 0) {
          blocking.push(`superbet_boards_failed:${externalValidation.summary.boards_failed}`);
        }
        if (externalValidation.summary.gaps_total > 0) {
          blocking.push(`superbet_gaps:${externalValidation.summary.gaps_total}`);
        }
      }
    } catch (error) {
      warnings.push(`superbet_validation_error:${error.message}`);
      blocking.push('superbet_validation_unavailable');
    }

    const stakeTotal = +(tickets.length * stake).toFixed(2);
    let realSubmitSummary = null;
    let status = computeYankeeSubmissionStatus({ isDryRun, blocking, externalValidation, realSubmitSummary });

    const submissionId = `sub-${runId}-${randomUUID().slice(0, 8)}`;
    const ticketsJson = JSON.stringify(tickets);
    let warningsJson = warnings.length ? JSON.stringify(warnings) : null;
    const effectiveOverrides = buildResult.overrides ?? effectiveInputOverrides ?? {};
    if (inheritance.source === 'inherited') {
      const excludedCount = Array.isArray(effectiveInputOverrides?.excluded_match_ids)
        ? effectiveInputOverrides.excluded_match_ids.length : 0;
      warnings.push(`overrides_inherited:from=${inheritance.inheritedFromSubmissionId}:excluded=${excludedCount}`);
    }

    insertSubmission.run(
      submissionId,
      runId,
      isDryRun ? 1 : 0,
      stake,
      tickets.length,
      stakeTotal,
      status,
      warningsJson,
      ticketsJson,
    );

    persistSubmissionAuditAndTickets({
      submissionId,
      runId,
      mode: isManual ? 'manual_yankee' : 'auto_yankee',
      validationScope: externalValidation ? 'local_board_plus_superbet_catalog' : 'local_board_only',
      blocking,
      externalValidation,
      repairHistory,
      effectiveOverrides,
      tickets,
      stake,
      isDryRun,
      ticketSelection,
    });

    if (!isDryRun && countSubmittableValidationTickets(externalValidation) > 0) {
      realSubmitSummary = await submitRealTickets({
        runId,
        submissionId,
        externalValidation,
        sourceTickets: tickets,
        stake,
        ticketSelection,
      });
      if (!realSubmitSummary.enabled) warnings.push('real_submit_disabled:set_SCOUTCORE_BOOKLINE_REAL_SUBMIT_true');
      if (realSubmitSummary.failed > 0) warnings.push(`real_submit_failed:${realSubmitSummary.failed}`);
      if (realSubmitSummary.submitted > 0) warnings.push(`real_submit_confirmed:${realSubmitSummary.submitted}`);
      status = computeYankeeSubmissionStatus({ isDryRun, blocking, externalValidation, realSubmitSummary });
      warningsJson = warnings.length ? JSON.stringify(warnings) : null;
      updateSubmissionRealSummary.run(JSON.stringify(realSubmitSummary), submissionId);
      updateSubmissionStatus.run(status, warningsJson, submissionId);
    }

    return {
      submission_id: submissionId,
      run_id: runId,
      is_dry_run: isDryRun,
      status,
      mode: isManual ? 'manual_yankee' : 'auto_yankee',
      stake_per_ticket: stake,
      tickets_count: tickets.length,
      stake_total: stakeTotal,
      blocking,
      can_submit_real: blocking.length === 0 && isExternalValidationPassed(externalValidation),
      warnings,
      validation_scope: externalValidation ? 'local_board_plus_superbet_catalog' : 'local_board_only',
      external_validation: externalValidation,
      repair_history: repairHistory,
      effective_overrides: effectiveOverrides,
      effective_overrides_source: inheritance.source,
      effective_overrides_inherited_from: inheritance.inheritedFromSubmissionId,
      real_submit_summary: realSubmitSummary,
      board: yankee.board ?? null,
      tickets,
    };
  }

  app.post('/v1/runs/:id/yankee/dry-run', async (req, reply) => {
    const { id } = req.params;
    const { stake_per_ticket = 3, overrides, manual_legs, reset_overrides } = req.body ?? {};
    const out = await buildYankeeSubmissionResult({
      runId: id, stakePerTicket: stake_per_ticket, isDryRun: true, overrides, manualLegs: manual_legs, resetOverrides: reset_overrides,
    });
    if (out.__error) return reply.code(out.__status).send({ error: out.__error });
    return out;
  });

  app.post('/v1/runs/:id/yankee/manual/dry-run', async (req, reply) => {
    const { id } = req.params;
    const { stake_per_ticket = 3, legs, manual_legs } = req.body ?? {};
    const out = await buildYankeeSubmissionResult({
      runId: id,
      stakePerTicket: stake_per_ticket,
      isDryRun: true,
      manualLegs: legs ?? manual_legs,
    });
    if (out.__error) return reply.code(out.__status).send({ error: out.__error });
    return out;
  });

  app.post('/v1/runs/:id/yankee/submit', async (req, reply) => {
    const { id } = req.params;
    const body = req.body ?? {};
    const { stake_per_ticket = 3, overrides, confirm, manual_legs, reset_overrides } = body;
    // Camada extra de proteção server-side: exige confirm=true no body
    // (a UI já tem o double-confirm de 15s; isto evita curl acidental).
    if (confirm !== true) {
      return reply.code(400).send({ error: 'confirm_required', hint: 'set confirm:true in body' });
    }
    const out = await buildYankeeSubmissionResult({
      runId: id,
      stakePerTicket: stake_per_ticket,
      isDryRun: false,
      overrides,
      manualLegs: manual_legs,
      ticketSelection: ticketSelectionFromBody(body),
      resetOverrides: reset_overrides,
    });
    if (out.__error) return reply.code(out.__status).send({ error: out.__error });
    if (out.status === 'rejected') {
      return reply.code(409).send(out);
    }
    return out;
  });

  app.post('/v1/runs/:id/yankee/submit-preview', async (req, reply) => {
    const { id } = req.params;
    const body = req.body ?? {};
    const { dry_run_submission_id, stake_per_ticket = 3 } = body;
    if (!dry_run_submission_id) {
      return reply.code(400).send({ error: 'dry_run_submission_id_required' });
    }
    const stake = Number(stake_per_ticket);
    if (!Number.isFinite(stake) || stake < 1 || stake > 100) {
      return reply.code(400).send({ error: 'invalid_stake_per_ticket_range_1_100' });
    }
    const row = getSubmissionWithAudit.get(id, dry_run_submission_id);
    if (!row) return reply.code(404).send({ error: 'dry_run_submission_not_found' });
    if (!row.is_dry_run) return reply.code(400).send({ error: 'submission_is_not_dry_run' });
    const externalValidation = parseJsonOr(row.external_validation_json, null);
    const sourceTickets = parseJsonOr(row.tickets_json, []);
    const preview = await previewRealTickets({
      externalValidation,
      sourceTickets,
      stake,
      ticketSelection: ticketSelectionFromBody(body),
    });
    return {
      run_id: id,
      dry_run_submission_id,
      mode: 'submit_preview_no_post',
      real_submit_enabled: isRealSubmitEnabled(),
      ...preview,
    };
  });

  app.post('/v1/runs/:id/yankee/submissions/:submissionId/retry-real', async (req, reply) => {
    const { id, submissionId } = req.params;
    const body = req.body ?? {};
    const { confirm } = body;
    if (confirm !== true) {
      return reply.code(400).send({ error: 'confirm_required', hint: 'set confirm:true in body' });
    }
    const row = getSubmissionWithAudit.get(id, submissionId);
    if (!row) return reply.code(404).send({ error: 'submission_not_found' });
    const externalValidation = parseJsonOr(row.external_validation_json, null);
    const blocking = parseJsonOr(row.blocking_json, []);
    const sourceTickets = parseJsonOr(row.tickets_json, []);
    if (blocking.length > 0 || !isExternalValidationPassed(externalValidation)) {
      return reply.code(409).send({
        error: 'submission_not_retryable',
        blocking,
        external_summary: externalValidation?.summary ?? null,
      });
    }
    const realSubmitSummary = await submitRealTickets({
      runId: id,
      submissionId,
      externalValidation,
      sourceTickets,
      stake: Number(row.stake_per_ticket),
      ticketSelection: ticketSelectionFromBody(body),
    });
    const status = computeYankeeSubmissionStatus({ isDryRun: false, blocking: [], externalValidation, realSubmitSummary });
    const warnings = [];
    if (!realSubmitSummary.enabled) warnings.push('real_submit_disabled:set_SCOUTCORE_BOOKLINE_REAL_SUBMIT_true');
    if (realSubmitSummary.failed > 0) warnings.push(`real_submit_failed:${realSubmitSummary.failed}`);
    if (realSubmitSummary.submitted > 0) warnings.push(`real_submit_confirmed:${realSubmitSummary.submitted}`);
    updateSubmissionRealSummary.run(JSON.stringify(realSubmitSummary), submissionId);
    updateSubmissionStatus.run(status, warnings.length ? JSON.stringify(warnings) : row.warnings, submissionId);
    return { submission_id: submissionId, run_id: id, status, warnings, real_submit_summary: realSubmitSummary };
  });

  app.post('/v1/runs/:id/yankee/manual/submit', async (req, reply) => {
    const { id } = req.params;
    const body = req.body ?? {};
    const { stake_per_ticket = 3, legs, manual_legs, confirm } = body;
    if (confirm !== true) {
      return reply.code(400).send({ error: 'confirm_required', hint: 'set confirm:true in body' });
    }
    const out = await buildYankeeSubmissionResult({
      runId: id,
      stakePerTicket: stake_per_ticket,
      isDryRun: false,
      manualLegs: legs ?? manual_legs,
      ticketSelection: ticketSelectionFromBody(body),
    });
    if (out.__error) return reply.code(out.__status).send({ error: out.__error });
    if (out.status === 'rejected') {
      return reply.code(409).send(out);
    }
    return out;
  });

  app.get('/v1/runs/:id/yankee/submissions', async (req, _reply) => {
    const { id } = req.params;
    const rows = repo.db.prepare(`
      SELECT submission_id, run_id, submitted_at, is_dry_run, stake_per_ticket,
             tickets_count, stake_total, status, warnings
      FROM yankee_submissions
      WHERE run_id = ?
      ORDER BY submitted_at DESC
    `).all(id);
    return {
      run_id: id,
      items: rows.map((r) => ({
        ...r,
        is_dry_run: !!r.is_dry_run,
        warnings: r.warnings ? JSON.parse(r.warnings) : [],
      })),
    };
  });

  app.get('/v1/runs/:id/yankee/submissions/:submissionId', async (req, reply) => {
    const { id, submissionId } = req.params;
    const row = getSubmissionFullDetail.get(id, submissionId);
    if (!row) return reply.code(404).send({ error: 'submission_not_found' });
    const ticketsAudit = getSubmissionTicketsBySubmissionId.all(submissionId).map((t) => ({
      ...t,
      match_ids: parseJsonOr(t.match_ids_json, []),
      match_ids_json: undefined,
    }));
    return {
      submission_id: row.submission_id,
      run_id: row.run_id,
      submitted_at: row.submitted_at,
      settled_at: row.settled_at,
      is_dry_run: !!row.is_dry_run,
      mode: row.mode,
      validation_scope: row.validation_scope,
      stake_per_ticket: row.stake_per_ticket,
      tickets_count: row.tickets_count,
      stake_total: row.stake_total,
      status: row.status,
      warnings: parseJsonOr(row.warnings, []),
      blocking: parseJsonOr(row.blocking_json, []),
      effective_overrides: parseJsonOr(row.effective_overrides_json, {}),
      repair_history: parseJsonOr(row.repair_history_json, []),
      external_validation: parseJsonOr(row.external_validation_json, null),
      real_submit_summary: parseJsonOr(row.real_submit_summary_json, null),
      tickets: parseJsonOr(row.tickets_json, []),
      tickets_audit: ticketsAudit,
    };
  });
}
