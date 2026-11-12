import { TestBed } from '@angular/core/testing';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUserInterface } from '../models/app-user.interface';
import { UserProfileVerificationService } from './user-profile-verification.service';
import { AppUserUtilities } from '../utils/app.user.utilities';
import { loadUserSettingsUtilities } from '../helpers/user-settings.loader';
import { FirebaseError } from 'firebase/app';

vi.mock('../helpers/user-settings.loader', () => ({ loadUserSettingsUtilities: vi.fn() }));

const sdk = vi.hoisted(() => ({ getFirestore: vi.fn(), doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('firebase/firestore/lite', () => sdk);

describe('UserProfileVerificationService', () => {
  const agreements = { acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true };
  let service: UserProfileVerificationService;
  let auth: { currentUser: { uid: string } | null };
  const app = {};

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadUserSettingsUtilities).mockResolvedValue(AppUserUtilities);
    auth = { currentUser: { uid: 'u1' } };
    sdk.getFirestore.mockReturnValue('lite-firestore');
    sdk.doc.mockImplementation((_firestore, path) => path);
    sdk.getDoc.mockImplementation(async path => ({ data: () => ({
      'users/u1': { onboardingCompleted: true, hasSubscribedOnce: true },
      'users/u1/legal/agreements': agreements,
      'users/u1/system/status': { stripeRole: 'pro' },
      'users/u1/config/settings': { appSettings: { unitSetupCompleted: true } },
    })[path] }));
    TestBed.configureTestingModule({ providers: [
      { provide: Auth, useValue: auth },
      { provide: Firestore, useValue: { app } },
    ] });
    service = TestBed.inject(UserProfileVerificationService);
  });

  it('adds no reads for a complete profile', async () => {
    const profile = { uid: 'u1', ...agreements, onboardingCompleted: true } as AppUserInterface;
    expect(await service.verifyIfIncomplete('u1', profile)).toBe(profile);
    expect(sdk.getFirestore).not.toHaveBeenCalled();
    expect(sdk.getDoc).not.toHaveBeenCalled();
    expect(loadUserSettingsUtilities).not.toHaveBeenCalled();
  });

  it('keeps verification pending until existing settings normalization finishes', async () => {
    let complete!: (utilities: typeof AppUserUtilities) => void;
    vi.mocked(loadUserSettingsUtilities).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const finished = vi.fn();
    const verification = service.verifyIfIncomplete('u1', null).then(finished);
    await vi.waitFor(() => expect(loadUserSettingsUtilities).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();
    complete(AppUserUtilities);
    await verification;
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'u1', settings: expect.objectContaining({ appSettings: expect.objectContaining({ unitSetupCompleted: true }) }),
    }));
  });

  it.each(['switch', 'sign out'])('rejects verification on %s while the settings chunk is pending', async change => {
    let complete!: (utilities: typeof AppUserUtilities) => void;
    vi.mocked(loadUserSettingsUtilities).mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const verification = service.verifyIfIncomplete('u1', null);
    const assertion = expect(verification).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(loadUserSettingsUtilities).toHaveBeenCalledOnce());
    auth.currentUser = change === 'switch' ? { uid: 'u2' } : null;
    complete(AppUserUtilities);
    await assertion;
  });

  it('propagates a cached settings import failure without memoizing its verification attempt', async () => {
    const error = Object.assign(new TypeError('Failed to fetch dynamically imported module'), { code: 'account/settings-load-failed' });
    vi.mocked(loadUserSettingsUtilities).mockRejectedValue(error);
    await expect(service.verifyIfIncomplete('u1', null)).rejects.toBe(error);
    await expect(service.verifyIfIncomplete('u1', null)).rejects.toBe(error);
    expect(loadUserSettingsUtilities).toHaveBeenCalledTimes(2);
  });

  it('bounds a stalled settings download with the existing verification deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(loadUserSettingsUtilities).mockReturnValueOnce(new Promise(() => {}));
      const result = service.verifyIfIncomplete('u1', null);
      const assertion = expect(result).rejects.toMatchObject({ code: 'deadline-exceeded' });
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(await service.verifyIfIncomplete('u1', null)).toMatchObject({ uid: 'u1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { hasSubscribedOnce: true },
    { stripeRole: 'basic' },
    { stripeRole: 'pro' },
    { admin: true },
    { isPro: true },
    { gracePeriodUntil: new Date('2099-01-01') },
  ])('adds no reads when agreements and existing access already complete onboarding: %j', async access => {
    const profile = { uid: 'u1', ...agreements, ...access } as AppUserInterface;
    expect(await service.verifyIfIncomplete('u1', profile)).toBe(profile);
    expect(sdk.getDoc).not.toHaveBeenCalled();
  });

  it('verifies missing onboarding history even when the legal document is present', async () => {
    const incomplete = { uid: 'u1', ...agreements, stripeRole: 'free' } as AppUserInterface;
    const profile = await service.verifyIfIncomplete('u1', incomplete);
    expect(profile?.onboardingCompleted).toBe(true);
    expect(sdk.getDoc).toHaveBeenCalledTimes(4);
  });

  it('preserves server-confirmed unfinished onboarding after policies have been accepted', async () => {
    const unfinished = { ...agreements, onboardingCompleted: false, hasSubscribedOnce: false };
    sdk.getDoc.mockImplementation(async path => ({ data: () => path === 'users/u1' ? unfinished : undefined }));
    const profile = await service.verifyIfIncomplete('u1', { uid: 'u1', ...unfinished } as AppUserInterface);
    expect(profile?.onboardingCompleted).toBe(false);
    expect(profile?.hasSubscribedOnce).toBe(false);
    expect(sdk.getDoc).toHaveBeenCalledTimes(4);
  });

  it('recovers an incorrectly missing profile with one shared set of server reads', async () => {
    const first = service.verifyIfIncomplete('u1', null);
    const second = service.verifyIfIncomplete('u1', null);
    expect(second).toBe(first);
    const profile = await first;
    expect(sdk.getFirestore).toHaveBeenCalledWith(app);
    expect(sdk.getDoc).toHaveBeenCalledTimes(4);
    expect(profile).toEqual(expect.objectContaining({ uid: 'u1', ...agreements, onboardingCompleted: true, stripeRole: 'pro' }));
    expect(profile?.settings.appSettings.unitSetupCompleted).toBe(true);
  });

  it('verifies missing agreements even when the profile exists', async () => {
    const profile = await service.verifyIfIncomplete('u1', { uid: 'u1', acceptedTos: false } as AppUserInterface);
    expect(profile?.acceptedTos).toBe(true);
    expect(sdk.getDoc).toHaveBeenCalledTimes(4);
  });

  it('returns null only when the independent reads confirm a missing profile', async () => {
    sdk.getDoc.mockResolvedValue({ data: () => undefined });
    expect(await service.verifyIfIncomplete('u1', null)).toBeNull();
  });

  it('preserves genuine incomplete onboarding and partial legacy profiles', async () => {
    sdk.getDoc.mockImplementation(async path => ({ data: () => path.endsWith('/legal/agreements')
      ? { ...agreements, acceptedTos: false } : undefined }));
    const profile = await service.verifyIfIncomplete('u1', null);
    expect(profile).toEqual(expect.objectContaining({ uid: 'u1', acceptedPrivacyPolicy: true, acceptedTos: false }));
  });

  it('propagates verification failures instead of manufacturing a new user and permits a later retry', async () => {
    const error = Object.assign(new Error('denied'), { code: 'permission-denied' });
    sdk.getDoc.mockRejectedValueOnce(error);
    await expect(service.verifyIfIncomplete('u1', null)).rejects.toBe(error);
    expect(await service.verifyIfIncomplete('u1', null)).toEqual(expect.objectContaining(agreements));
  });

  it('normalizes the Lite fetch rejection for the existing account retry policy and releases the shared request', async () => {
    const cause = new FirebaseError('unknown', 'Request failed with error: undefined');
    sdk.getDoc.mockRejectedValueOnce(cause);
    const first = service.verifyIfIncomplete('u1', null);
    expect(service.verifyIfIncomplete('u1', null)).toBe(first);
    await expect(first).rejects.toMatchObject({ code: 'unavailable', cause });
    expect(await service.verifyIfIncomplete('u1', null)).toMatchObject({ uid: 'u1', ...agreements });
    expect(sdk.getDoc).toHaveBeenCalledTimes(8);
  });

  it.each(['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.'])(
    'normalizes a real Lite SDK fetch rejection (%s) without making any network requests', async message => {
    const { initializeApp, deleteApp } = await import('firebase/app');
    const lite = await vi.importActual<typeof import('firebase/firestore/lite')>('firebase/firestore/lite');
    const firebaseApp = initializeApp({ projectId: 'demo-profile-recovery', apiKey: 'demo-key' }, 'profile-transport-test');
    const firestore = lite.getFirestore(firebaseApp);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError(message));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      sdk.getFirestore.mockReturnValue(firestore);
      sdk.doc.mockImplementation(lite.doc);
      sdk.getDoc.mockImplementation(lite.getDoc);
      await expect(service.verifyIfIncomplete('u1', null)).rejects.toMatchObject({
        code: 'unavailable',
        cause: { name: 'FirebaseError', code: 'unknown', message: `Request failed with error: ${message}` },
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      for (const [url, request] of fetchMock.mock.calls) {
        expect(String(url)).toContain('/projects/demo-profile-recovery/databases/(default)/documents:batchGet');
        expect(request?.method).toBe('POST');
      }
      expect(loadUserSettingsUtilities).not.toHaveBeenCalled();
    } finally {
      await lite.terminate(firestore);
      await deleteApp(firebaseApp);
      fetchMock.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it.each([
    new FirebaseError('unknown', 'Unexpected server response'),
    new FirebaseError('permission-denied', 'Request failed with error: undefined'),
    new FirebaseError('unauthenticated', 'Request failed with error: undefined'),
    new FirebaseError('invalid-argument', 'Request failed with error: undefined'),
    new FirebaseError('permission-denied', 'Request failed with error: Failed to fetch'),
    new FirebaseError('unauthenticated', 'Request failed with error: Load failed'),
    new FirebaseError('invalid-argument', 'Request failed with error: NetworkError when attempting to fetch resource.'),
    new FirebaseError('unknown', 'Request failed with error: Failed to fetch private-resource'),
    new FirebaseError('unknown', 'Request failed with error: fetch failed (arbitrary cause)'),
    Object.assign(new Error('Request failed with error: undefined'), { code: 'unknown' }),
    Object.assign(new Error('Request failed with error: Failed to fetch'), { code: 'unknown' }),
    new TypeError('Failed to fetch'),
  ])('preserves errors outside the exact Lite transport signature: %s', async error => {
    sdk.getDoc.mockRejectedValueOnce(error);
    await expect(service.verifyIfIncomplete('u1', null)).rejects.toBe(error);
  });

  it('does not normalize a settings merge failure that resembles the Lite transport signature', async () => {
    const error = new FirebaseError('unknown', 'Request failed with error: undefined');
    vi.mocked(loadUserSettingsUtilities).mockRejectedValueOnce(error);
    await expect(service.verifyIfIncomplete('u1', null)).rejects.toBe(error);
  });

  it.each(['switch', 'sign out', 'same account session'])('discards a failed Lite request after %s', async change => {
    let reject!: (error: Error) => void;
    sdk.getDoc.mockReturnValueOnce(new Promise((_resolve, rejectRead) => { reject = rejectRead; }));
    const result = service.verifyIfIncomplete('u1', null);
    const discarded = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(sdk.getDoc).toHaveBeenCalledTimes(4));
    auth.currentUser = change === 'sign out' ? null : { uid: change === 'switch' ? 'u2' : 'u1' };
    reject(new FirebaseError('unknown', 'Request failed with error: undefined'));
    await discarded;
    expect(loadUserSettingsUtilities).not.toHaveBeenCalled();
  });

  it('discards verification when the account changes while requests are pending', async () => {
    let resolveRead!: (snapshot: { data: () => undefined }) => void;
    const pending = new Promise<{ data: () => undefined }>(resolve => { resolveRead = resolve; });
    sdk.getDoc.mockReturnValue(pending);
    const result = service.verifyIfIncomplete('u1', null);
    await vi.waitFor(() => expect(sdk.getDoc).toHaveBeenCalledTimes(4));
    auth.currentUser = { uid: 'u2' };
    resolveRead({ data: () => undefined });
    await expect(result).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('does not reuse a pending read after the listener profile changes', async () => {
    let resolveOld!: (snapshot: { data: () => undefined }) => void;
    const oldSnapshot = new Promise<{ data: () => undefined }>(resolve => { resolveOld = resolve; });
    sdk.getDoc.mockReturnValue(oldSnapshot);
    const oldRead = service.verifyIfIncomplete('u1', null);
    await vi.waitFor(() => expect(sdk.getDoc).toHaveBeenCalledTimes(4));

    sdk.getDoc.mockResolvedValue({ data: () => ({ ...agreements, onboardingCompleted: true }) });
    const newRead = service.verifyIfIncomplete('u1', { uid: 'u1', acceptedTos: false } as AppUserInterface);
    resolveOld({ data: () => undefined });

    expect(await oldRead).toBeNull();
    expect(await newRead).toEqual(expect.objectContaining({ onboardingCompleted: true }));
    expect(sdk.getDoc).toHaveBeenCalledTimes(8);
  });

  it('does not reuse an older missing result after a complete listener snapshot', async () => {
    let resolveOld!: (snapshot: { data: () => undefined }) => void;
    sdk.getDoc.mockReturnValue(new Promise(resolve => { resolveOld = resolve; }));
    const oldRead = service.verifyIfIncomplete('u1', null);
    await vi.waitFor(() => expect(sdk.getDoc).toHaveBeenCalledTimes(4));

    const complete = { uid: 'u1', ...agreements, onboardingCompleted: true } as AppUserInterface;
    expect(await service.verifyIfIncomplete('u1', complete)).toBe(complete);
    expect(sdk.getDoc).toHaveBeenCalledTimes(4);
    sdk.getDoc.mockResolvedValue({ data: () => complete });
    const newRead = service.verifyIfIncomplete('u1', null);
    resolveOld({ data: () => undefined });

    expect(await oldRead).toBeNull();
    expect(await newRead).toEqual(expect.objectContaining({ onboardingCompleted: true }));
    expect(sdk.getDoc).toHaveBeenCalledTimes(8);
  });

  it('starts a fresh read when the same account signs in again during verification', async () => {
    let resolveOld!: (snapshot: { data: () => undefined }) => void;
    sdk.getDoc.mockReturnValue(new Promise(resolve => { resolveOld = resolve; }));
    const oldRead = service.verifyIfIncomplete('u1', null);
    const discarded = expect(oldRead).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(sdk.getDoc).toHaveBeenCalledTimes(4));

    auth.currentUser = { uid: 'u1' };
    sdk.getDoc.mockResolvedValue({ data: () => ({ ...agreements, onboardingCompleted: true }) });
    const newRead = service.verifyIfIncomplete('u1', null);
    // Attach both handlers before finishing the old request to avoid an
    // unhandled rejection when a broken implementation shares the promise.
    const recovered = expect(newRead).resolves.toEqual(expect.objectContaining({ onboardingCompleted: true }));
    resolveOld({ data: () => undefined });
    await Promise.all([discarded, recovered]);
    expect(sdk.getDoc).toHaveBeenCalledTimes(8);
  });

  it('releases timed-out verification so a later retry can make a new request', async () => {
    vi.useFakeTimers();
    try {
      sdk.getDoc.mockReturnValue(new Promise(() => undefined));
      const timedOut = expect(service.verifyIfIncomplete('u1', null)).rejects.toMatchObject({ code: 'deadline-exceeded' });
      await vi.advanceTimersByTimeAsync(10_000);
      await timedOut;
      expect(sdk.getDoc).toHaveBeenCalledTimes(4);
      sdk.getDoc.mockResolvedValue({ data: () => undefined });
      expect(await service.verifyIfIncomplete('u1', null)).toBeNull();
      expect(sdk.getDoc).toHaveBeenCalledTimes(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not read another account or an unauthenticated profile', async () => {
    await expect(service.verifyIfIncomplete('u2', null)).rejects.toMatchObject({ code: 'cancelled' });
    auth.currentUser = null;
    await expect(service.verifyIfIncomplete('u1', null)).rejects.toMatchObject({ code: 'cancelled' });
    expect(sdk.getDoc).not.toHaveBeenCalled();
  });
});
