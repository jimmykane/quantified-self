import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { WorkoutReflectionService, WORKOUT_REFLECTION_READ_TIMEOUT_MS } from './workout-reflection.service';
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), read: vi.fn(), cachedRead: vi.fn(), links: vi.fn(), liteFirestore: vi.fn() }));
vi.mock('firebase/firestore/lite', () => ({ getFirestore: mocks.liteFirestore,
  doc: (_db: unknown, path: string) => path, getDoc: mocks.read }));
vi.mock('app/firebase/firestore', async () => {
  const actual = await vi.importActual('app/firebase/firestore');
  return { ...actual, collection: (_db: unknown, ...path: string[]) => path.join('/'),
    query: (path: string, ...constraints: unknown[]) => ({ path, constraints }), where: (...args: unknown[]) => args,
    limit: (value: number) => value, getDocsFromServer: mocks.links, doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }), getDocFromServer: mocks.cachedRead,
    runTransaction: (_db: unknown, callback: (txn: unknown) => Promise<unknown>) => callback({ get: mocks.get, set: mocks.set }) };
});
const recording = { uid: 'owner', eventId: 'e', activityId: 'a', target: 'activity' as const };
const id = '11111111-1111-4111-8111-111111111111';
describe('Private reflection transactions', () => {
  let service: WorkoutReflectionService;
  const auth = { currentUser: { uid: 'owner' } };
  beforeEach(() => {
    vi.clearAllMocks(); auth.currentUser = { uid: 'owner' };
    mocks.liteFirestore.mockReturnValue({});
    mocks.read.mockResolvedValue({ exists: () => false });
    TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: { app: 'reflection-app' } }, { provide: Auth, useValue: auth }] });
    service = TestBed.inject(WorkoutReflectionService);
    mocks.get.mockImplementation(async ({ path }: { path: string }) => ({ exists: () => !path.includes('workoutReflections'),
      data: () => path.includes('/activities/') ? { eventID: 'e' } : {} }));
  });
  it('writes only a private leaf and never event stats, completion or prescriptions', async () => {
    await service.save(recording, 0, id, { note: 'private note' });
    expect(mocks.set).toHaveBeenCalledOnce();
    expect(mocks.set).toHaveBeenCalledWith({ path: 'users/owner/events/e/workoutReflections/activity_a' },
      expect.objectContaining({ revision: 1, note: 'private note' }));
  });

  it('reads the exact leaf through uncached Lite with the same Firebase app', async () => {
    const saved = { schemaVersion: 1, revision: 4, deleted: false, mutationId: id, note: 'current' };
    mocks.cachedRead.mockResolvedValue({ exists: () => false });
    mocks.read.mockResolvedValue({ exists: () => true, data: () => saved });
    expect(await service.read(recording)).toEqual(saved);
    expect(mocks.liteFirestore).toHaveBeenCalledWith('reflection-app');
    expect(mocks.read).toHaveBeenCalledWith('users/owner/events/e/workoutReflections/activity_a');
    expect(mocks.cachedRead).not.toHaveBeenCalled();
    mocks.read.mockResolvedValue({ exists: () => false });
    expect(await service.read(recording)).toBeNull();
  });

  it('rejects an unavailable leaf instead of inventing revision zero or waiting indefinitely', async () => {
    mocks.read.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.read(recording)).rejects.toThrow('unavailable');
    vi.useFakeTimers();
    try {
      mocks.read.mockImplementationOnce(() => new Promise(() => undefined));
      const pending = expect(service.read(recording)).rejects.toThrow('Timeout');
      await vi.advanceTimersByTimeAsync(WORKOUT_REFLECTION_READ_TIMEOUT_MS);
      await pending;
    } finally { vi.useRealTimers(); }
  });
  it('rejects cross-owner, changed activity membership and missing events before writing', async () => {
    auth.currentUser = { uid: 'other' }; await expect(service.read(recording)).rejects.toThrow('account');
    auth.currentUser = { uid: 'owner' };
    mocks.get.mockResolvedValue({ exists: () => true, data: () => ({ eventID: 'other' }) });
    await expect(service.save(recording, 0, id, { note: 'private note' })).rejects.toThrow('available');
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
  it('checks the owner again after lazy loading before issuing the read', async () => {
    const pending = service.read(recording);
    auth.currentUser = { uid: 'other' };
    await expect(pending).rejects.toThrow('account');
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
