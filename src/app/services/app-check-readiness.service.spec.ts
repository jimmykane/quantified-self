import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppCheck } from 'app/firebase/app-check';
import { AppCheckDiagnosticsService } from './app-check-diagnostics.service';

const hoisted = vi.hoisted(() => ({
  mockGetAppCheckToken: vi.fn(),
}));

vi.mock('app/firebase/app-check', async (importOriginal) => {
  const actual = await importOriginal<typeof import('app/firebase/app-check')>();
  return {
    ...actual,
    getToken: (...args: unknown[]) => hoisted.mockGetAppCheckToken(...args),
  };
});

describe('AppCheckReadinessService', () => {
  let service: AppCheckReadinessService;
  let appCheckMock: object;
  const diagnostics = { failureRevision: 0, reportFailure: vi.fn() };

  function configureTestingModule(options: { provideAppCheck?: boolean } = {}): AppCheckReadinessService {
    const providers: any[] = [AppCheckReadinessService, { provide: AppCheckDiagnosticsService, useValue: diagnostics }];

    if (options.provideAppCheck !== false) {
      providers.push({ provide: AppCheck, useValue: appCheckMock });
    }

    TestBed.configureTestingModule({ providers });
    return TestBed.inject(AppCheckReadinessService);
  }

  beforeEach(() => {
    appCheckMock = {};
    diagnostics.failureRevision = 0;
    diagnostics.reportFailure.mockReset();
    hoisted.mockGetAppCheckToken.mockReset();
    hoisted.mockGetAppCheckToken.mockResolvedValue({ token: 'app-check-token' });
    service = configureTestingModule();
  });

  it('should report when App Check is configured', () => {
    expect(service.isConfigured()).toBe(true);
  });

  it('should no-op ensureReady when App Check is unavailable', async () => {
    TestBed.resetTestingModule();
    const serviceWithoutAppCheck = configureTestingModule({ provideAppCheck: false });

    await expect(serviceWithoutAppCheck.ensureReady()).resolves.toBeUndefined();
    expect(serviceWithoutAppCheck.isConfigured()).toBe(false);
    expect(hoisted.mockGetAppCheckToken).not.toHaveBeenCalled();
  });

  it('should memoize successful readiness checks', async () => {
    await service.ensureReady();
    await service.ensureReady();

    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(1);
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledWith(appCheckMock, false);
  });

  it('should re-run readiness check when force refresh is requested', async () => {
    await service.ensureReady();
    await service.ensureReady(true);

    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(2);
    expect(hoisted.mockGetAppCheckToken).toHaveBeenNthCalledWith(1, appCheckMock, false);
    expect(hoisted.mockGetAppCheckToken).toHaveBeenNthCalledWith(2, appCheckMock, true);
  });

  it('invalidates memoized readiness after a background verification failure', async () => {
    await service.ensureReady();
    diagnostics.failureRevision += 1;
    const failure = { code: 'appCheck/throttled' };
    hoisted.mockGetAppCheckToken.mockRejectedValueOnce(failure);
    await expect(service.ensureReady()).rejects.toBe(failure);
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(2);
    expect(diagnostics.reportFailure).toHaveBeenCalledWith(failure, 'token-request');
  });

  it('should clear the memoized readiness promise after a failure', async () => {
    hoisted.mockGetAppCheckToken
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValueOnce({ token: 'app-check-token' });

    await expect(service.ensureReady()).rejects.toThrow('bootstrap failed');
    await expect(service.ensureReady()).resolves.toBeUndefined();

    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(2);
  });

  it('should time out a stalled readiness request and allow a later retry', async () => {
    vi.useFakeTimers();
    hoisted.mockGetAppCheckToken
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({ token: 'app-check-token' });

    const stalledAttempt = service.ensureReady();
    const stalledExpectation = expect(stalledAttempt).rejects.toThrow('App Check is taking too long');
    await vi.advanceTimersByTimeAsync(15_000);
    await stalledExpectation;

    await expect(service.ensureReady()).resolves.toBeUndefined();
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('should return a usable token through getToken', async () => {
    await expect(service.getToken()).resolves.toBe('app-check-token');
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledWith(appCheckMock, false);
  });

  it('should bound an individual token request', async () => {
    vi.useFakeTimers();
    hoisted.mockGetAppCheckToken.mockImplementationOnce(() => new Promise(() => undefined));

    const tokenRequest = service.getToken();
    const expectation = expect(tokenRequest).rejects.toThrow('App Check is taking too long');
    await vi.advanceTimersByTimeAsync(15_000);
    await expectation;

    vi.useRealTimers();
  });

  it('should reject getToken when App Check is unavailable', async () => {
    TestBed.resetTestingModule();
    const serviceWithoutAppCheck = configureTestingModule({ provideAppCheck: false });

    await expect(serviceWithoutAppCheck.getToken()).rejects.toThrow('App Check is not configured');
  });

  it('should reject getToken when the SDK returns an empty token', async () => {
    hoisted.mockGetAppCheckToken.mockResolvedValueOnce({ token: '' });

    await expect(service.getToken()).rejects.toThrow('Could not retrieve App Check token.');
  });

  it('shares a pending verification across token and readiness consumers', async () => {
    let resolve!: (value: { token: string }) => void;
    hoisted.mockGetAppCheckToken.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const token = service.getToken();
    const ready = service.ensureReady();
    const secondToken = service.getToken();
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledOnce();
    resolve({ token: 'verified-token' });
    await expect(token).resolves.toBe('verified-token');
    await expect(secondToken).resolves.toBe('verified-token');
    await expect(ready).resolves.toBeUndefined();
    await service.getToken();
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(2);
  });

  it('keeps forced refresh distinct while sharing it with subsequent consumers', async () => {
    let resolveOrdinary!: (value: { token: string }) => void;
    let resolveForced!: (value: { token: string }) => void;
    hoisted.mockGetAppCheckToken
      .mockReturnValueOnce(new Promise(done => { resolveOrdinary = done; }))
      .mockReturnValueOnce(new Promise(done => { resolveForced = done; }));
    const ordinary = service.getToken();
    const forced = service.getToken(true);
    const joined = service.getToken();
    const joinedForced = service.getToken(true);
    expect(hoisted.mockGetAppCheckToken.mock.calls).toEqual([[appCheckMock, false], [appCheckMock, true]]);
    resolveOrdinary({ token: 'old-token' });
    await ordinary;
    resolveForced({ token: 'fresh-token' });
    for (const promise of [forced, joined, joinedForced]) await expect(promise).resolves.toBe('fresh-token');
  });

  it('classifies a stalled verification once and discards its late result before a fresh request', async () => {
    vi.useFakeTimers();
    try {
      let resolveOld!: (value: { token: string }) => void;
      hoisted.mockGetAppCheckToken.mockReturnValueOnce(new Promise(done => { resolveOld = done; }));
      const request = service.getToken();
      const rejected = expect(request).rejects.toMatchObject({ code: 'appCheck/token-timeout' });
      await vi.advanceTimersByTimeAsync(15_000);
      await rejected;
      expect(diagnostics.reportFailure).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ code: 'appCheck/token-timeout' }), 'token-request');
      resolveOld({ token: 'stale-token' });
      await expect(service.getToken()).resolves.toBe('app-check-token');
      expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('does not replace a verification failure when diagnostics throw', async () => {
    const failure = { code: 'appCheck/recaptcha-error' };
    hoisted.mockGetAppCheckToken.mockRejectedValueOnce(failure);
    diagnostics.reportFailure.mockImplementationOnce(() => { throw new Error('diagnostics unavailable'); });
    await expect(service.getToken()).rejects.toBe(failure);
  });
});
