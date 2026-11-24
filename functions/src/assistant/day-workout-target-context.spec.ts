import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { defaultDayWorkoutControls } from '../../../shared/day-workout';
import type { WorkoutRelativeHeartRateTargetV1 } from '../../../shared/planned-workout';
import type { DayWorkoutContext } from './day-workout-context';
import { withWorkoutTargetContext } from './day-workout-target-context';

const now = new Date('2026-11-24T10:00:00Z');
const controls = { ...defaultDayWorkoutControls('2026-11-24', 'UTC'), target: 'heart-rate' as const };
const policy = { method: 'AUTOMATIC', included: true, revision: 2, effectiveAt: new Date('2026-11-23T10:00:00Z') };
const nearby: WorkoutRelativeHeartRateTargetV1 = { kind: 'heart-rate', mode: 'relative', minimumPercent: 60, maximumPercent: 70,
  reference: { kind: 'max-heart-rate', bpm: 180 } };
const context = (references: DayWorkoutContext['references'] = []): DayWorkoutContext => ({
  evidence: { references }, references, usedContext: [], missingContext: [], previousStrength: [],
});

function database() {
  const get = vi.fn();
  const revisionGet = vi.fn();
  const where = vi.fn().mockReturnThis(), orderBy = vi.fn().mockReturnThis(), limit = vi.fn().mockReturnThis();
  const collection = vi.fn(() => ({ where, orderBy, limit, get: revisionGet }));
  const doc = vi.fn(() => ({ get, collection }));
  return { db: { doc } as unknown as FirebaseFirestore.Firestore, doc, get, revisionGet, collection, where, orderBy, limit };
}

describe('workout heart-rate references', () => {
  let mock: ReturnType<typeof database>;
  beforeEach(() => { mock = database(); });

  it.each([
    { lactateThresholdHR: 170, maxHeartRate: 190, expected: { kind: 'threshold-heart-rate', bpm: 170 } },
    { maxHeartRate: 190, expected: { kind: 'max-heart-rate', bpm: 190 } },
  ])('uses saved calibration without a scheduled workout: $expected.kind', async ({ expected, ...saved }) => {
    mock.get.mockResolvedValue({ data: () => ({ ...policy, ...saved, restingHeartRate: 55, private: 'hidden' }) });
    const result = await withWorkoutTargetContext('owner', { ...controls, trainingContext: false, activityContext: false }, now, context(), mock.db);
    expect(mock.doc).toHaveBeenCalledExactlyOnceWith('users/owner/trainingLoadPolicies/running');
    expect(mock.collection).not.toHaveBeenCalled();
    expect(result.references).toEqual([{ ...nearby, minimumPercent: 100, maximumPercent: 100, reference: expected }]);
    expect(result.evidence).toEqual({ references: result.references });
    expect(result.usedContext).toHaveLength(1);
    expect(result.missingContext).toEqual([]);
  });

  it('uses the dated revision for the final sport when a new setting takes effect during generation', async () => {
    mock.get.mockResolvedValue({ data: () => ({ ...policy, effectiveAt: new Date(now.getTime() + 1_000), lactateThresholdHR: 175 }) });
    mock.revisionGet.mockResolvedValue({ docs: [{ data: () => ({ ...policy, lactateThresholdHR: 160 }) }] });
    const result = await withWorkoutTargetContext('owner', { ...controls, sport: ActivityTypes.Cycling }, now, context([nearby]), mock.db);
    expect(mock.doc).toHaveBeenCalledExactlyOnceWith('users/owner/trainingLoadPolicies/cycling');
    expect(mock.collection).toHaveBeenCalledExactlyOnceWith('revisions');
    expect(mock.where).toHaveBeenCalledWith('effectiveAt', '<=', expect.objectContaining({ seconds: now.getTime() / 1_000 }));
    expect(mock.orderBy).toHaveBeenCalledExactlyOnceWith('effectiveAt', 'desc');
    expect(mock.limit).toHaveBeenCalledExactlyOnceWith(1);
    expect(result.references.map(target => target.reference)).toEqual([{ kind: 'threshold-heart-rate', bpm: 160 }]);
  });

  it('ignores unreadable calibration and falls back to a compatible schedule reference', async () => {
    mock.get.mockRejectedValue(new Error('offline'));
    const result = await withWorkoutTargetContext('owner', controls, now, context([nearby]), mock.db);
    expect(result.references).toEqual([nearby]);
    expect(result.usedContext[0]).toContain('nearby workout');
    expect(result.missingContext).toEqual([]);
  });

  it.each([undefined, { ...policy, restingHeartRate: 50 }, { ...policy, maxHeartRate: -1 },
    { ...policy, maxHeartRate: 190, revision: 0 }, { ...policy, maxHeartRate: 190, effectiveAt: undefined }])(
    'keeps effort guidance when the saved policy has no usable reference: %j', async saved => {
      mock.get.mockResolvedValue({ data: () => saved });
      const result = await withWorkoutTargetContext('owner', controls, now, context(), mock.db);
      expect(result.references).toEqual([]);
      expect(result.usedContext).toEqual([]);
      expect(result.missingContext[0]).toContain('Settings → Training load defaults');
      expect(mock.collection).not.toHaveBeenCalled();
    },
  );

  it('skips reference reads for event advice even with Heart rate selected', async () => {
    await withWorkoutTargetContext('owner', controls, now, { ...context(), adviceOnly: true }, mock.db);
    expect(mock.doc).not.toHaveBeenCalled();
  });
});
