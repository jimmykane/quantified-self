import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { assessTrainingDeliveryMapping } from './mapping';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { productionDeliveryRuntime } from './runtime';
const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'w', planId: null, localDate: '2026-09-10', revision: 1,
  title: 'Easy run', lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running,
    nodes: [{ kind: 'step', id: 'a', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } };
describe('Training delivery mapping and production boundary', () => {
  it.each(['garmin', 'coros', 'wahoo', 'suunto'] as const)('%s uses serializer-level assessment without enabling transport', provider => {
    const assessment = assessTrainingDeliveryMapping(provider, workout, 'destination', 'UTC');
    expect(assessment.level).toBe('exact');
    expect(assessment.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(productionDeliveryRuntime({} as never).transport(provider, 'owner')).toBeNull();
  });
  it('captures serializer-specific losses, not only structure capability warnings', () => {
    const result = assessTrainingDeliveryMapping('suunto', { ...workout, title: 'Run 🏃🏽' }, 'destination', 'UTC');
    expect(result.level).toBe('degraded'); expect(result.issues.length).toBeGreaterThan(0);
  });
});
