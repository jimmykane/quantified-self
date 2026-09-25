import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { standardWorkoutReferenceFitFixture } from '../delivery/test-support/suunto-fit-fixture';

const deletion = vi.hoisted(() => vi.fn());
const authority = vi.hoisted(() => vi.fn());
vi.mock('../../shared/user-deletion-guard', () => ({ getUserDeletionGuardStateInTransaction: deletion }));
vi.mock('../delivery/connection', () => ({ readTrainingDeliveryAuthority: authority }));

import { readFITWorkoutReferenceEvidence, retainGarminFITWorkoutReferences } from './fit-workout-evidence';

describe('provider-neutral FIT workout-reference evidence', () => {
  it('reads standard training-file and workout definitions through Sports Lib without narrowing unsigned IDs', () => {
    const evidence = readFITWorkoutReferenceEvidence(standardWorkoutReferenceFitFixture());
    expect(evidence).toMatchObject({ status: 'ok', diagnostics: [], suuntoGuides: [], sessions: [] });
    expect(evidence.trainingFiles).toEqual([{ type: 5, manufacturer: 1, product: 2, serialNumber: 0xfffffffe,
      timeCreatedUnixMs: 631065723000, timestampUnixMs: 631065724000 }]);
    expect(evidence.workouts).toEqual([{ name: 'Intervals', sport: 2, subSport: 8, numValidSteps: 4 }]);
  });

  it('retains Garmin references as account-bound candidate evidence without a recorded activity', async () => {
    deletion.mockResolvedValue({ shouldSkip: false });
    authority.mockResolvedValue({ account: 'garmin-account', token: { data: () => ({ tokenCredentialGeneration: 'generation' }) },
      connection: { state: 'connected', destinationKey: 'opaque' } });
    const writes = vi.fn();
    const ref = (path: string): any => ({ path, collection: (part: string) => ref(`${path}/${part}`), doc: (part: string) => ref(`${path}/${part}`) });
    const tx = { set: writes, get: vi.fn(async (target: { path: string }) => target.path.endsWith('/events/event')
      ? { exists: true, data: () => ({}) } : target.path.endsWith(`/metaData/${ServiceNames.GarminAPI}`)
        ? { exists: true, data: () => ({ serviceName: ServiceNames.GarminAPI, serviceUserID: 'garmin-account',
          serviceActivityFileID: 'source-file', serviceActivityFileType: 'FIT' }) }
        : { exists: false, data: () => undefined }) };
    const db = { collection: (path: string) => ref(path), runTransaction: (callback: (value: unknown) => unknown) => callback(tx) } as unknown as Firestore;
    const retained = await retainGarminFITWorkoutReferences(db, 'uid', 'event', 'garmin-account', 'generation',
      { activityFileID: 'source-file', activityFileType: 'FIT' },
      standardWorkoutReferenceFitFixture(), [], 123);
    expect(retained).toBe(true);
    expect(writes).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: 'users/uid/events/event/trainingCompletionEvidence/fit' }),
      expect.objectContaining({ reader: 'sports-lib', sourceProvider: 'garmin', correlationState: 'candidate_only',
        trainingFiles: { 'FIT Training File References': { references: [expect.objectContaining({ serialNumber: 0xfffffffe })] } },
        capturedAtMs: 123 }),
    );
  });

  it('fails closed for malformed input and stale Garmin authority without affecting the activity parser', async () => {
    expect(readFITWorkoutReferenceEvidence(Buffer.from('not-fit'))).toEqual({ status: 'invalid', diagnostics: ['invalid_header'],
      trainingFiles: [], workouts: [], suuntoGuides: [], sessions: [] });
    deletion.mockResolvedValue({ shouldSkip: false });
    authority.mockResolvedValue({ account: 'other', token: { data: () => ({ tokenCredentialGeneration: 'generation' }) },
      connection: { state: 'connected', destinationKey: 'opaque' } });
    const set = vi.fn();
    const ref = (path: string): any => ({ path, collection: (part: string) => ref(`${path}/${part}`), doc: (part: string) => ref(`${path}/${part}`) });
    const tx = { set, get: vi.fn(async () => ({ exists: true, data: () => ({}) })) };
    const db = { collection: (path: string) => ref(path), runTransaction: (callback: (value: unknown) => unknown) => callback(tx) } as unknown as Firestore;
    await expect(retainGarminFITWorkoutReferences(db, 'uid', 'event', 'garmin-account', 'generation',
      { activityFileID: 'source-file', activityFileType: 'FIT' },
      standardWorkoutReferenceFitFixture())).resolves.toBe(false);
    expect(set).not.toHaveBeenCalled();
  });
});
