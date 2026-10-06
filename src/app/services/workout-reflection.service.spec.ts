import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { WorkoutReflectionService } from './workout-reflection.service';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), read: vi.fn(), links: vi.fn() }));
vi.mock('app/firebase/firestore', async () => {
  const actual = await vi.importActual('app/firebase/firestore');
  return { ...actual, collection: (_db: unknown, ...path: string[]) => path.join('/'),
    query: (path: string, ...constraints: unknown[]) => ({ path, constraints }), where: (...args: unknown[]) => args,
    limit: (value: number) => value, getDocsFromServer: mocks.links, doc: (_db: unknown, ...path: string[]) => path.join('/'), getDocFromServer: mocks.read,
    runTransaction: (_db: unknown, callback: (txn: unknown) => Promise<unknown>) => callback({ get: mocks.get, set: mocks.set }) };
});
const recording = { uid: 'owner', eventId: 'e', activityId: 'a', target: 'activity' as const };
const id = '11111111-1111-4111-8111-111111111111';
describe('Private reflection transactions', () => {
  let service: WorkoutReflectionService;
  const auth = { currentUser: { uid: 'owner' } };
  beforeEach(() => {
    vi.clearAllMocks(); auth.currentUser = { uid: 'owner' };
    TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }, { provide: Auth, useValue: auth }] });
    service = TestBed.inject(WorkoutReflectionService);
    mocks.get.mockImplementation(async (path: string) => ({ exists: () => !path.includes('workoutReflections'),
      data: () => path.includes('/activities/') ? { eventID: 'e' } : {} }));
  });
  it('writes only a private leaf and never event stats, completion or prescriptions', async () => {
    await service.save(recording, 0, id, { effort: 0, note: null });
    expect(mocks.set).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith('users/owner/events/e/workoutReflections/activity_a',
      expect.objectContaining({ effort: 0, revision: 1, note: null }));
  });
  it('rejects cross-owner, changed activity membership and missing events before writing', async () => {
    auth.currentUser = { uid: 'other' }; await expect(service.read(recording)).rejects.toThrow('account');
    auth.currentUser = { uid: 'owner' };
    mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ eventID: 'other' }) });
    await expect(service.save(recording, 0, id, { effort: 4, note: null })).rejects.toThrow('available');
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('uses only one exact completion link for the selected target and rejects ambiguity or excessive reads', async () => {
    const link = { schemaVersion: 1, workoutId: 'w', planId: null, provider: 'suunto', matchMethod: 'provider_marker',
      eventId: 'e', activityId: 'a', sourceSessionIndex: 0, activityStartAtMs: 1, scheduledLocalDate: '2026-10-06',
      workoutRevisionAtLink: 1, timing: 'on_date', linkedAtMs: 1, updatedAtMs: 1 };
    const result = (values: unknown[], size = values.length) => ({ size, docs: values.map(value => ({ data: () => value })) });
    mocks.links.mockResolvedValue(result([link]));
    expect(await service.hasExactWorkoutLink(recording)).toBe(true);
    expect(mocks.links).toHaveBeenCalledWith({ path: 'users/owner/trainingWorkoutCompletions', constraints: [['eventId', '==', 'e'], 26] });
    expect(await service.hasExactWorkoutLink({ ...recording, target: 'recording' })).toBe(false);
    for (const values of [[{ ...link, activityId: 'other' }], [{ ...link, eventId: 'other' }], [link, link], [{ ...link, schemaVersion: 2 }],
      [link, { ...link, schemaVersion: 2 }], [link, { ...link, eventId: 'other' }]]) {
      mocks.links.mockResolvedValue(result(values)); expect(await service.hasExactWorkoutLink(recording)).toBe(false);
    }
    mocks.links.mockResolvedValue(result([link, { ...link, activityId: 'other' }]));
    expect(await service.hasExactWorkoutLink(recording)).toBe(true);
    mocks.links.mockResolvedValue(result([link], 26)); expect(await service.hasExactWorkoutLink(recording)).toBe(false);
    mocks.links.mockResolvedValue(result([{ ...link, activityId: null }]));
    expect(await service.hasExactWorkoutLink({ ...recording, target: 'recording' })).toBe(true);
  });

  it('does not return a prior owner response after a delayed read', async () => {
    mocks.read.mockImplementation(async () => {
      auth.currentUser = { uid: 'other' }; return { exists: () => false };
    });
    await expect(service.read(recording)).rejects.toThrow('account');
  });
});
