import assert from 'node:assert/strict';
import test from 'node:test';
import { freshDelivery, instant, report } from './cohort.mjs';

const start = Date.UTC(2026, 10, 16), day = 86_400_000;
const event = (uid, name, elapsed) => ({ uid, name, at: start + elapsed });
test('uses the first observed selection, distinct users, a mature 24h denominator and dated receipts', () => {
  const output = report({ from: start, until: start + 2 * day, asOf: start + 2 * day,
    events: [event('a','onboarding_sync_selected',0), event('a','onboarding_sync_selected',800),
      event('b','onboarding_sync_selected',day + 1), event('c','onboarding_sync_selected',0),
      event('x','onboarding_sync_selected',-500), event('x','onboarding_sync_selected',500),
      event('a','onboarding_compare_selected',0), event('a','comparison_result_opened',200),
      event('a','onboarding_analyze_selected',0), event('a','recorded_workout_opened',-10)],
    deliveries: [event('a','',-1),event('a','',day),event('c','',day+1),event('a','',day+3)],
    cancellations: [event('a','',-2000),event('a','',0),event('c','',day+2000)] });
  assert.equal(output.sync.starters,3);
  assert.equal(output.sync.pending24h,1);
  assert.equal(output.sync.observed24hShare,.5);
  assert.equal(output.sync.cancellationOrder.cancellationBeforeFirstObservedResult,1);
  assert.equal(output.sync.cancellationOrder.resultBeforeCancellation,1);
  assert.equal(output.compare.cancellationOrder.sameInstant,1);
  assert.equal(output.analyze.cancellationOrder.cancellationWithoutObservedResult,1);
});
test('distinguishes unavailable cancellation data and empty denominators', () => {
  const x=report({from:start,until:start+day,asOf:start+day,events:[],deliveries:[],cancellations:null});
  assert.equal(x.sync.cancellationOrder,null);
  assert.equal(x.sync.observed24hShare,null);
  assert.match(x.sync.receiptCoverage,/lower bound/);
});

test('accepts only genuine provider confirmations and rejects ambiguous time units', () => {
  assert.equal(freshDelivery({ resultStatus: 'success', destinationInfoCode: 'ALREADY_EXISTS' }), false);
  assert.equal(freshDelivery({ resultStatus: 'manual_reconciliation_required' }), false);
  assert.equal(freshDelivery({ resultStatus: 'success', destinationInfoCode: null }), true);
  assert.throws(() => instant(start / 1000));
  assert.throws(() => instant('2026-11-16T06:00:00'));
});
