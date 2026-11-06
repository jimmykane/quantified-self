import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Auth } from 'app/firebase/auth';
import { Firestore, runTransaction } from 'app/firebase/firestore';
import { getDoc } from 'firebase/firestore/lite';
import { ActivityTypes } from '@sports-alliance/sports-lib';
import { WorkoutPowerSettingsService } from './workout-power-settings.service';
import { AppUserService } from './app.user.service';
vi.mock('app/firebase/firestore', () => ({ Firestore: class {}, doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })), runTransaction: vi.fn() }));
vi.mock('firebase/firestore/lite', () => ({ getFirestore: vi.fn(() => ({})), doc: vi.fn((_db, ...path: string[]) => ({ path: path.join('/') })), getDoc: vi.fn() }));
const profile = { sport: ActivityTypes.Running, provider: 'suunto' as const, source: 'Watch power',
  reference: { kind: 'critical-power' as const, watts: 250 }, referenceDate: '2026-11-01', zoneUpperBoundsWatts: [150, 200] };
const empty = { version: 1 as const, revision: 0, profiles: [] };
describe('private workout power settings persistence', () => {
  let service: WorkoutPowerSettingsService, auth: { currentUser: { uid: string } | null };
  let existing: unknown;
  const set = vi.fn(), user = signal({ uid: 'owner' });
  beforeEach(() => {
    vi.clearAllMocks(); user.set({ uid: 'owner' }); auth = { currentUser: { uid: 'owner' } }; existing = undefined;
    vi.mocked(getDoc).mockResolvedValue({ data: () => ({ workoutPower: undefined }) } as never);
    vi.mocked(runTransaction).mockImplementation(async (_db, update) => update({ get: async () => ({ data: () => ({ workoutPower: existing }) }), set } as never));
    TestBed.configureTestingModule({ providers: [{ provide: Auth, useValue: auth }, { provide: Firestore, useValue: { app: {} } },
      { provide: AppUserService, useValue: { user } }] });
    service = TestBed.inject(WorkoutPowerSettingsService);
  });
  it('uses fresh owner-scoped Lite reads and treats only absent profiles as empty', async () => {
    expect(await service.load('owner')).toEqual(empty);
    expect(getDoc).toHaveBeenCalledWith({ path: 'users/owner/config/settings' });
    vi.mocked(getDoc).mockResolvedValue({ data: () => ({ workoutPower: null }) } as never);
    await expect(service.load('owner')).rejects.toThrow();
    vi.mocked(getDoc).mockRejectedValue(Error('offline'));
    await expect(service.load('owner')).rejects.toThrow('offline');
  });
  it.each([false, true])('reads dated FTP with a frozen millisecond snapshot (native client timestamp: %s)', async nativeTimestamp => {
    const effectiveAtMs = Date.parse('2026-11-01T12:00:00Z');
    const effectiveAt = nativeTimestamp ? { toMillis: () => effectiveAtMs + 0.456 } : effectiveAtMs;
    vi.mocked(getDoc).mockResolvedValueOnce({ data: () => ({ method: 'AUTOMATIC', included: true,
      functionalThresholdPower: 280, revision: 3, effectiveAt }) } as never);
    expect(await service.loadSharedFtp('owner', ActivityTypes.Running)).toEqual({ kind: 'training-ftp', sport: ActivityTypes.Running,
      family: 'running', revision: 3, effectiveAtMs, reference: { kind: 'functional-threshold-power', watts: 280 } });
    expect(getDoc).toHaveBeenCalledExactlyOnceWith({ path: 'users/owner/trainingLoadPolicies/running' });
    expect(set).not.toHaveBeenCalled();
  });
  it('distinguishes missing, invalid and unreadable defaults without borrowing another sport', async () => {
    expect(await service.loadSharedFtp('owner', ActivityTypes.Running)).toBeNull();
    vi.mocked(getDoc).mockResolvedValueOnce({ data: () => ({ functionalThresholdPower: 280 }) } as never);
    await expect(service.loadSharedFtp('owner', ActivityTypes.Cycling)).rejects.toThrow('could not be verified');
    vi.mocked(getDoc).mockRejectedValueOnce(Error('offline'));
    await expect(service.loadSharedFtp('owner', ActivityTypes.Running)).rejects.toThrow('offline');
    vi.mocked(getDoc).mockClear(); expect(await service.loadSharedFtp('owner', ActivityTypes.Rowing)).toBeNull();
    expect(getDoc).not.toHaveBeenCalled();
  });
  it('rejects a late shared FTP response after account change', async () => {
    vi.mocked(getDoc).mockImplementationOnce(async () => { auth.currentUser = null; return { data: () => ({}) } as never; });
    await expect(service.loadSharedFtp('owner', ActivityTypes.Running)).rejects.toThrow('account changed');
    await expect(service.loadSharedFtp('foreign', ActivityTypes.Running)).rejects.toThrow('account changed');
  });
  it('times out a pending shared read without returning a late reference', async () => {
    vi.useFakeTimers();
    try {
      let finish!: (value: unknown) => void;
      vi.mocked(getDoc).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
      const pending = service.loadSharedFtp('owner', ActivityTypes.Running), settled = vi.fn();
      pending.then(settled, () => undefined);
      const failure = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(30001); await failure;
      finish({ data: () => ({ method: 'AUTOMATIC', included: true, functionalThresholdPower: 280,
        revision: 2, effectiveAt: Date.parse('2026-11-01T12:00Z') }) });
      await Promise.resolve(); await Promise.resolve(); expect(settled).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('narrowly merges planning-only settings and recovers an exact uncertain-save retry', async () => {
    const saved = await service.save('owner', empty, [profile]);
    expect(set).toHaveBeenCalledExactlyOnceWith({ path: 'users/owner/config/settings' }, { workoutPower: saved }, { merge: true });
    expect(saved.revision).toBe(1); existing = saved; set.mockClear();
    expect(await service.save('owner', empty, [profile])).toEqual(saved); expect(set).not.toHaveBeenCalled();
  });
  it('rejects another session’s settings without overwriting or resetting revision', async () => {
    existing = { version: 1, revision: 2, profiles: [profile] };
    await expect(service.save('owner', empty, [profile])).rejects.toThrow('changed in another session'); expect(set).not.toHaveBeenCalled();
  });
  it('rejects foreign ownership and session replacement before any write', async () => {
    await expect(service.load('foreign')).rejects.toThrow('account changed');
    await expect(service.save('foreign', empty, [profile])).rejects.toThrow('account changed');
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, update) => { auth.currentUser = { uid: 'owner' }; return update({} as never); });
    await expect(service.save('owner', empty, [profile])).rejects.toThrow('account changed'); expect(set).not.toHaveBeenCalled();
  });
  it('does not write after the account changes during the transactional read', async () => {
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, update) => update({
      get: async () => { auth.currentUser = null; return { data: () => ({}) }; }, set,
    } as never));
    await expect(service.save('owner', empty, [profile])).rejects.toThrow('account changed'); expect(set).not.toHaveBeenCalled();
  });
  it('times out an unconfirmed save and prevents a late callback from writing', async () => {
    vi.useFakeTimers();
    try {
      let proceed!: () => void;
      vi.mocked(runTransaction).mockImplementationOnce(async (_db, update) => {
        await new Promise<void>(resolve => { proceed = resolve; });
        return update({ get: async () => ({ data: () => ({}) }), set } as never);
      });
      const pending = service.save('owner', empty, [profile]);
      const failure = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(30001); await failure;
      proceed(); await Promise.resolve(); await Promise.resolve();
      expect(set).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('discards a late load after account switch', async () => {
    vi.mocked(getDoc).mockImplementationOnce(async () => { auth.currentUser = { uid: 'other' }; return { data: () => ({ workoutPower: empty }) } as never; });
    await expect(service.load('owner')).rejects.toThrow('account changed');
  });
});
