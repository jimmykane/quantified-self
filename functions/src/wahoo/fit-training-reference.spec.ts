import { describe, expect, it } from 'vitest';
import { wahooTrainingFitFixture } from '../training-plans/delivery/test-support/wahoo-fit-fixture';
import { readWahooFITTrainingReference } from './fit-training-reference';

const startTimeMs = Date.parse('2026-09-17T07:00:00Z');
const activities = [{ id: 'activity', startTimeMs }];
describe('Sports Lib Wahoo FIT reference consumer', () => {
  it.each([456, null])('retains an exact Plan reference with scheduled Workout %s', workoutId => {
    expect(readWahooFITTrainingReference(wahooTrainingFitFixture({ workoutId }), activities)).toEqual({
      format: 'wahoo-app-plan-v1', planId: '789', workoutId: workoutId === null ? null : '456', startTimeUnixMs: startTimeMs,
    });
  });
  it.each([{ referenceCount: 2 }, { sessionCount: 2 }, { sessionCount: 0 },
    { referenceStartOffsetSeconds: 1 }, { planId: '0' }, { workoutId: 0 }])('rejects ambiguous/malformed evidence %j', options => {
    expect(readWahooFITTrainingReference(wahooTrainingFitFixture(options), activities)).toBeNull();
  });
  it('rejects invalid framing and missing/ambiguous imported activity identity', () => {
    expect(readWahooFITTrainingReference(Buffer.from('not-fit'), activities)).toBeNull();
    for (const rows of [[], [...activities, ...activities], [{ id: '../activity', startTimeMs }],
      [{ id: 'activity', startTimeMs: null }], [{ id: 'activity', startTimeMs: startTimeMs + 1000 }]]) {
      expect(readWahooFITTrainingReference(wahooTrainingFitFixture(), rows)).toBeNull();
    }
  });
});
