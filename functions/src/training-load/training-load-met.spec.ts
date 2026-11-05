import { describe, expect, it, vi } from 'vitest';
vi.unmock('@sports-alliance/sports-lib');
import { ActivityUtilities, EventImporterJSON } from '@sports-alliance/sports-lib';
import { defaultAppliedTrainingLoadPolicy, type TrainingLoadLeg } from '../../../shared/training-load-policy';
import { calculateDeferredMet } from './training-load-met';

describe('deferred MET scalar calculation', () => {
  const leg: TrainingLoadLeg = { activityId: 'leg', identity: { startMs: 1000, endMs: 3601000,
    type: 'Walking', duration: 3600, distance: null }, policy: defaultAppliedTrainingLoadPolicy('Walking'),
    recordedTss: 40, evaluations: null, calibration: { version: 2, weight: { status: 'deferred' } } };
  it.each([
    { Energy: 210, 'Timer time': 3600 },
    { Energy: 210, 'Timer time': 1800, Duration: 3600 },
    { Energy: 210, 'Moving time': 1800, Duration: 3600 },
    { Energy: 210, Duration: 3600, 'Pause Time': 1800 },
    { Energy: 210 },
  ])('uses the library MET formula and original timing precedence for %j', stats => {
    const source = { startDate: 1000, endDate: 3601000, type: 'Walking', creator: { name: '' },
      laps: [], streams: [], intensityZones: [], stats };
    const parsed = EventImporterJSON.getActivityFromJSON(source as never);
    ActivityUtilities.getTrainingStressScoreEvaluations(parsed);
    const expected = ActivityUtilities.evaluateTrainingStressScoreWithCalibration(parsed, { bodyMassKg: 70 }).met;
    const before = JSON.stringify(source);
    expect(calculateDeferredMet(leg, source, 70)).toEqual(expected);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('ignores recorded scores and unrelated metrics rather than replacing them or treating them as calibration', () => {
    const source = { stats: { Energy: 210, 'Timer time': 3600, 'Training Stress Score': 40, FTP: 200,
      'Power Normalized': 200, 'Average Heart Rate': 100 } };
    Object.defineProperty(source.stats, 'Power Curve', { enumerable: true, get: () => { throw new Error('Unrelated metric read'); } });
    expect(calculateDeferredMet(leg, source, 70)).toMatchObject({ score: 9, method: 'MET', estimated: true });
  });
});
