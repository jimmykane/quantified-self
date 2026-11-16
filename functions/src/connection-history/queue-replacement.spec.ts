import { describe, expect, it } from 'vitest';
import { replacesSupersededHistoryWork } from './queue-replacement';

describe('history queue replacement', () => {
  const manual = { connectionHistoryRunId: 'manual-run', firebaseUserID: 'owner', reimportCompletedActivities: true };

  it.each([undefined, 'old-history'])('refetches completed live/legacy or history recordings on explicit manual import (%s)', oldRun => {
    expect(replacesSupersededHistoryWork({ firebaseUserID: 'owner', connectionHistoryRunId: oldRun, processed: true }, manual)).toBe(true);
  });

  it.each([
    { firebaseUserID: 'owner', processed: false },
    { firebaseUserID: 'other', processed: true },
    { processed: true },
    { firebaseUserID: 'owner', connectionHistoryRunId: 'manual-run', processed: true },
    { firebaseUserID: 'owner', processed: true, skippedReason: 'provider_auth_required', resultStatus: 'skipped' },
    { firebaseUserID: 'owner', processed: true, resultStatus: 'manual_reconciliation_required' },
  ])('does not reopen live work, another owner, this run, or non-successful live outcomes: %j', existing => {
    expect(replacesSupersededHistoryWork(existing, manual)).toBe(false);
  });

  it('rechecks a verified live-feed copy on a new manual import, once per run', () => {
    const copy = { firebaseUserID: 'owner', processed: true, resultStatus: 'skipped', skippedReason: 'cross_provider_duplicate' };
    expect(replacesSupersededHistoryWork(copy, manual)).toBe(true);
    expect(replacesSupersededHistoryWork(copy, { ...manual, reimportCompletedActivities: false })).toBe(false);
    expect(replacesSupersededHistoryWork({ ...copy, connectionHistoryRunId: manual.connectionHistoryRunId }, manual)).toBe(false);
    expect(replacesSupersededHistoryWork({ ...copy, resultStatus: 'success' }, manual)).toBe(false);
    expect(replacesSupersededHistoryWork({ ...copy, skippedReason: 'outbound_provider_echo' }, manual)).toBe(false);
  });

  it('preserves automatic deduplication and existing superseded-run recovery', () => {
    const automatic = { ...manual, reimportCompletedActivities: false };
    expect(replacesSupersededHistoryWork({ firebaseUserID: 'owner', connectionHistoryRunId: 'old', processed: true }, automatic)).toBe(false);
    expect(replacesSupersededHistoryWork({ firebaseUserID: 'owner', connectionHistoryRunId: 'old', processed: false }, automatic)).toBe(true);
  });
});
