import { TestBed } from '@angular/core/testing';
import { Auth } from 'app/firebase/auth';
import { Firestore } from 'app/firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUserInterface } from '../models/app-user.interface';
import { UserProfileVerificationService } from './user-profile-verification.service';

const sdk = vi.hoisted(() => ({ getFirestore: vi.fn(), doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('firebase/firestore/lite', () => sdk);

describe('UserProfileVerificationService', () => {
  const agreements = { acceptedPrivacyPolicy: true, acceptedDataPolicy: true, acceptedTos: true };
  let service: UserProfileVerificationService;
  let auth: { currentUser: { uid: string } | null };
  const app = {};

  beforeEach(() => {
    vi.resetAllMocks();
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
    const profile = { uid: 'u1', ...agreements } as AppUserInterface;
    expect(await service.verifyIfIncomplete('u1', profile)).toBe(profile);
    expect(sdk.getFirestore).not.toHaveBeenCalled();
    expect(sdk.getDoc).not.toHaveBeenCalled();
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
