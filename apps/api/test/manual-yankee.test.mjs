import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManualYankeeFromRunSlots,
  countSubmittableValidationTickets,
  collectRepairableDriftMatchIds,
  computeYankeeSubmissionStatus,
  isExternalValidationPassed,
  selectSubmittableValidationTickets,
} from '../src/routes/strategies.mjs';

const slot = (matchIndex, marketIndex = 1, extra = {}) => ({
  match_id: `match-${matchIndex}`,
  market_key: `gols_total_over_${matchIndex}_${marketIndex}.5`,
  home: `Home ${matchIndex}`,
  away: `Away ${matchIndex}`,
  liga: 'Liga Teste',
  date: '2026-05-20',
  family: marketIndex % 2 === 0 ? 'escanteios' : 'gols',
  scope: 'total',
  period: 'FT',
  direction: 'over',
  line: matchIndex + marketIndex / 10,
  fair_prob: 0.58,
  market_odd: 1.7 + matchIndex / 10 + marketIndex / 100,
  edge_pct: 4 + matchIndex + marketIndex / 10,
  confidence: 0.72,
  certified: true,
  ...extra,
});

const run = {
  run_id: 'run-test',
  slots: [slot(1), slot(1, 2), slot(2), slot(3), slot(3, 2), slot(3, 3), slot(4), slot(5)],
};

describe('manual Yankee builder', () => {
  it('keeps legacy repair classifier limited to gap-only historical payloads', () => {
    const repairable = collectRepairableDriftMatchIds({
      tickets: [
        {
          boards: [
            {
              match_id: 'match-drift',
              status: 'error',
              gaps: [{ reason: 'price_drift_combo:18%>8%' }],
            },
            {
              match_id: 'match-drift',
              status: 'error',
              gaps: [{ reason: 'price_drift_combo:18%>8%' }],
            },
            {
              match_id: 'match-ev-negative',
              status: 'error',
              gaps: [{ reason: 'actual_ev_combo:-0.8%<=0%' }],
            },
            {
              match_id: 'match-drift-ev-negative',
              status: 'error',
              gaps: [
                { reason: 'price_drift_combo:18%>8%' },
                { reason: 'actual_ev_combo:-0.8%<=0%' },
              ],
            },
            {
              match_id: 'match-market-gap',
              status: 'error',
              gaps: [{ reason: 'market_or_selection_missing_in_superbet' }],
            },
            {
              match_id: 'match-mixed',
              status: 'error',
              gaps: [
                { reason: 'price_drift_combo:12%>8%' },
                { reason: 'quote_inactive:UNKNOWN/ACTIVE' },
              ],
            },
            {
              match_id: 'match-ok',
              status: 'ok',
              gaps: [],
            },
          ],
        },
      ],
    });

    assert.deepEqual(repairable, ['match-drift', 'match-ev-negative', 'match-drift-ev-negative']);
  });

  it('treats price drift warning as submittable when there are no blocking gaps', () => {
    const validation = {
      summary: { tickets_total: 1, tickets_ok: 1, boards_failed: 0, gaps_total: 0 },
      tickets: [
        {
          ticket_idx: 0,
          status: 'ok',
          boards: [
            {
              match_id: 'match-drift-warning',
              status: 'ok',
              gaps: [],
              warnings: ['price_drift_combo:18%>8%'],
            },
          ],
        },
      ],
    };

    assert.equal(isExternalValidationPassed(validation), true);
    assert.equal(computeYankeeSubmissionStatus({ isDryRun: true, blocking: [], externalValidation: validation }), 'external_passed');
  });

  it('does not call a failed dry-run validated', () => {
    const failedValidation = {
      summary: { tickets_total: 12, tickets_ok: 5, boards_failed: 4, gaps_total: 4 },
      tickets: [
        { ticket_idx: 1, status: 'ok' },
        { ticket_idx: 2, status: 'ok' },
        { ticket_idx: 3, status: 'ok' },
        { ticket_idx: 4, status: 'ok' },
        { ticket_idx: 5, status: 'ok' },
        { ticket_idx: 6, status: 'error' },
      ],
    };
    const passedValidation = {
      summary: { tickets_total: 12, tickets_ok: 12, boards_failed: 0, gaps_total: 0 },
      tickets: [{ ticket_idx: 1, status: 'ok' }],
    };

    assert.equal(isExternalValidationPassed(failedValidation), false);
    assert.equal(isExternalValidationPassed(passedValidation), true);
    assert.equal(countSubmittableValidationTickets(failedValidation), 5);
    assert.equal(computeYankeeSubmissionStatus({ isDryRun: true, blocking: ['superbet_gaps:4'], externalValidation: failedValidation }), 'external_failed');
    assert.equal(computeYankeeSubmissionStatus({ isDryRun: true, blocking: [], externalValidation: passedValidation }), 'external_passed');
    assert.equal(
      computeYankeeSubmissionStatus({
        isDryRun: false,
        blocking: ['superbet_gaps:4'],
        externalValidation: failedValidation,
      }),
      'partial_ready_for_real_submit'
    );
    assert.equal(
      computeYankeeSubmissionStatus({
        isDryRun: false,
        blocking: ['superbet_gaps:4'],
        externalValidation: failedValidation,
        realSubmitSummary: { enabled: true, attempted: 5, submitted: 5, failed: 0, skipped: 7 },
      }),
      'partial_submitted'
    );
    assert.equal(
      computeYankeeSubmissionStatus({
        isDryRun: false,
        blocking: [],
        externalValidation: passedValidation,
        realSubmitSummary: { enabled: true, attempted: 0, submitted: 0, failed: 0, skipped: 1 },
      }),
      'submit_failed'
    );
  });

  it('selects only the requested fourfold ticket for a safe real-flow test', () => {
    const validation = {
      tickets: [
        { ticket_idx: 0, status: 'ok' },
        { ticket_idx: 1, status: 'ok' },
        { ticket_idx: 2, status: 'error' },
        { ticket_idx: 11, status: 'ok' },
        { ticket_idx: 12, status: 'ok' },
      ],
    };
    const sourceTickets = [
      { ticket_idx: 0, boards: [{}, {}, {}, {}] },
      { ticket_idx: 1, kind: 'double' },
      { ticket_idx: 2, kind: 'double' },
      { ticket_idx: 11, kind: 'triple' },
      { ticket_idx: 12, kind: 'fourfold' },
    ];

    const selection = selectSubmittableValidationTickets(validation, sourceTickets, {
      ticket_kind: 'fourfold',
      max_tickets: 1,
    });

    assert.equal(selection.submittable_total, 4);
    assert.equal(selection.selected_total, 1);
    assert.equal(selection.skipped_by_filter, 3);
    assert.equal(selection.selected[0].validationTicket.ticket_idx, 0);
    assert.equal(selection.selected[0].sourceTicket.boards.length, 4);
  });

  it('does not widen selection when ticket_kind is invalid', () => {
    const validation = {
      tickets: [
        { ticket_idx: 0, status: 'ok' },
        { ticket_idx: 1, status: 'ok' },
      ],
    };
    const sourceTickets = [
      { ticket_idx: 0, boards: [{}, {}, {}, {}] },
      { ticket_idx: 1, kind: 'double' },
    ];

    const selection = selectSubmittableValidationTickets(validation, sourceTickets, {
      ticket_kind: 'fourfolds',
      max_tickets: 1,
    });

    assert.equal(selection.submittable_total, 2);
    assert.equal(selection.selected_total, 0);
    assert.equal(selection.skipped_by_filter, 2);
  });

  it('builds a classic Yankee from 4 matches with 1 to 4 markets per match', () => {
    const requested = [run.slots[0], run.slots[1], run.slots[2], run.slots[3], run.slots[4], run.slots[5], run.slots[6]];
    const result = buildManualYankeeFromRunSlots({
      run,
      stakePerTicket: 3,
      legs: requested.map((item) => ({
        match_id: item.match_id,
        market_key: item.market_key,
      })),
    });

    assert.equal(result.source, 'manual_yankee');
    assert.equal(result.board.ready_combos.length, 4);
    assert.equal(result.board.ready_combos[0].n_legs, 2);
    assert.equal(result.board.ready_combos[2].n_legs, 3);
    assert.equal(result.board.stats.manual_markets_count, 7);
    assert.equal(result.tickets.length, 11);
    assert.equal(result.tickets.filter((ticket) => ticket.kind === 'double').length, 6);
    assert.equal(result.tickets.filter((ticket) => ticket.kind === 'triple').length, 4);
    assert.equal(result.tickets.filter((ticket) => ticket.kind === 'fourfold').length, 1);
    assert.equal(result.tickets.every((ticket) => ticket.stake_brl === 3), true);
    assert.deepEqual(result.tickets[0].match_ids, ['match-1', 'match-2']);
    assert.equal(result.tickets[0].boards[0].legs.length, 2);
  });

  it('rejects selections that are not present in the persisted run slots', () => {
    const result = buildManualYankeeFromRunSlots({
      run,
      stakePerTicket: 3,
      legs: [
        { match_id: run.slots[0].match_id, market_key: run.slots[0].market_key },
        { match_id: run.slots[2].match_id, market_key: run.slots[2].market_key },
        { match_id: run.slots[3].match_id, market_key: run.slots[3].market_key },
        { match_id: 'match-x', market_key: 'fake_market' },
      ],
    });

    assert.equal(result.__status, 400);
    assert.match(result.__error, /^manual_leg_not_found_in_run:/);
  });

  it('rejects fewer than 4 distinct matches', () => {
    const duplicateRun = {
      run_id: 'run-duplicate',
      slots: [
        slot(1),
        slot(1, 2, { market_key: 'btts_sim', family: 'btts', direction: 'sim', line: null }),
        slot(2),
        slot(3),
      ],
    };
    const result = buildManualYankeeFromRunSlots({
      run: duplicateRun,
      stakePerTicket: 3,
      legs: duplicateRun.slots.map((item) => ({
        match_id: item.match_id,
        market_key: item.market_key,
      })),
    });

    assert.equal(result.__status, 400);
    assert.equal(result.__error, 'manual_yankee_requires_4_distinct_matches');
  });

  it('rejects more than 4 markets in the same match', () => {
    const oversizedRun = {
      run_id: 'run-oversized',
      slots: [
        slot(1, 1), slot(1, 2), slot(1, 3), slot(1, 4), slot(1, 5),
        slot(2, 1), slot(3, 1), slot(4, 1),
      ],
    };
    const result = buildManualYankeeFromRunSlots({
      run: oversizedRun,
      stakePerTicket: 3,
      legs: oversizedRun.slots.map((item) => ({
        match_id: item.match_id,
        market_key: item.market_key,
      })),
    });

    assert.equal(result.__status, 400);
    assert.equal(result.__error, 'manual_match_exceeds_4_legs:match-1');
  });
});
