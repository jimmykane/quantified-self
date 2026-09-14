import { trainingDeliveryCommandError, trainingDeliveryCopyMessage } from './training-delivery-display.helper';
import type { TrainingDeliveryStatusV1 } from '@shared/training-provider-delivery';

describe('Training delivery explanations', () => {
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
