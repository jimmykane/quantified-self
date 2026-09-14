import { trainingDeliveryCommandError, trainingDeliveryCopyMessage, trainingDeliveryLatestEvent } from './training-delivery-display.helper';
import type { TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';

describe('Training delivery explanations', () => {
  it.each([
    [10, 20, 20, 'Last attempt'],
    [20, 10, 20, 'Last confirmed'],
    [20, 20, 20, 'Last confirmed'],
    [null, 20, 20, 'Last attempt'],
    [20, null, 20, 'Last confirmed'],
    [null, null, 30, 'Updated'],
    [0, null, 0, 'Last confirmed'],
    [null, 0, 0, 'Last attempt'],
  ] as const)('labels the latest delivery event (confirmed %s, attempted %s)', (lastAcceptedAtMs, lastAttemptAtMs, timestamp, timestampLabel) => {
    expect(trainingDeliveryLatestEvent({ lastAcceptedAtMs, lastAttemptAtMs, updatedAtMs: 30 })).toEqual({ timestamp, timestampLabel });
  });
  it('distinguishes unfinished first delivery from an unconfirmed edit without claiming corruption', () => {
    const status = { status: 'retrying', differsFromQS: true, lastAcceptedAtMs: null } as TrainingDeliveryStatusV1;
    expect(trainingDeliveryCopyMessage(status)).toContain('not fully confirmed');
    expect(trainingDeliveryCopyMessage({ ...status, lastAcceptedAtMs: 1 })).toContain('latest changes');
    expect(trainingDeliveryCopyMessage({ ...status, differsFromQS: false })).toBeNull();
  });
  it('explains inactive-plan withdrawal instead of a changed workout', () => {
    expect(trainingDeliveryCopyMessage({ status: 'paused_plan', differsFromQS: true } as TrainingDeliveryStatusV1)).toContain('awaiting removal');
  });
  it('uses actionable safe errors without exposing raw callable messages', () => {
    expect(trainingDeliveryCommandError({ name: 'TimeoutError' }, false)).toContain('No sync settings were changed');
    expect(trainingDeliveryCommandError({ code: 'functions/aborted' }, false)).toContain('latest version');
    expect(trainingDeliveryCommandError({ code: 'functions/unavailable', message: 'private details' }, false)).not.toContain('private');
    expect(trainingDeliveryCommandError({ name: 'TimeoutError' }, true)).toContain('same request');
    expect(trainingDeliveryCommandError({ name: 'TimeoutError' }, true)).not.toContain('No sync settings');
  });
});
