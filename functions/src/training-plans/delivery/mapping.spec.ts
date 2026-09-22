import { describe, expect, it } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { assessTrainingDeliveryMapping } from './mapping';
import type { ScheduledWorkoutV1 } from '../../../../shared/training-plans';
import { productionDeliveryRuntime } from './runtime';
const workout: ScheduledWorkoutV1 = { schemaVersion: 1, id: 'w', planId: null, localDate: '2026-09-10', revision: 1,
  title: 'Easy run', lifecycle: 'planned', createdAtMs: 1, updatedAtMs: 1, structure: { version: 1, sport: ActivityTypes.Running,
    nodes: [{ kind: 'step', id: 'a', purpose: 'work', ending: { kind: 'time', seconds: 600 }, targets: [] }] } };
describe('Training delivery mapping and production boundary', () => {
  it.each(['garmin', 'coros', 'wahoo', 'suunto'] as const)('%s uses serializer-level assessment independently of rollout', provider => {
    const assessment = assessTrainingDeliveryMapping(provider, workout, 'destination', 'UTC');
    expect(assessment.level).toBe('exact');
    expect(assessment.digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it('enables only the public Wahoo transport for an ordinary authenticated owner', () => {
    const runtime = productionDeliveryRuntime({} as never);
    expect(runtime.transport('wahoo', 'owner')).toMatchObject({ mappingVersion: 'wahoo-plans-v4', horizonDays: 6 });
    for (const provider of ['garmin', 'coros', 'suunto'] as const) expect(runtime.transport(provider, 'owner')).toBeNull();
  });
  it('captures serializer-specific losses, not only structure capability warnings', () => {
    const result = assessTrainingDeliveryMapping('suunto', { ...workout, title: 'Run 🏃🏽' }, 'destination', 'UTC');
    expect(result.level).toBe('degraded'); expect(result.issues.length).toBeGreaterThan(0);
  });
  it('keeps the exact authored sport while reporting Garmin family folding', () => {
    const result = assessTrainingDeliveryMapping('garmin', {
      ...workout,
      structure: { ...workout.structure, sport: ActivityTypes.MountainBiking },
    }, 'destination', 'UTC');
    expect(result.level).toBe('degraded');
    expect(result.issues).toContain('Garmin receives Mountain Biking as a Cycling workout because its Training API has no exact Mountain Biking profile.');
  });
  it('treats Downhill Cycling as an approval-bound Garmin family fold instead of unsupported', () => {
    const downhill = {
      ...workout,
      structure: { ...workout.structure, sport: ActivityTypes.DownhillCycling },
    };
    const result = assessTrainingDeliveryMapping('garmin', downhill, 'destination', 'UTC');
    expect(result.level).toBe('degraded');
    expect(result.issues).toContain('Garmin receives Downhill Cycling as a Cycling workout because its Training API has no exact Downhill Cycling profile.');
    expect(downhill.structure.sport).toBe(ActivityTypes.DownhillCycling);
  });
});
