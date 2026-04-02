import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppCheckReadinessService } from './app-check-readiness.service';
import { AppCheck } from 'app/firebase/app-check';

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

  function configureTestingModule(options: { provideAppCheck?: boolean } = {}): AppCheckReadinessService {
    const providers: any[] = [AppCheckReadinessService];

    if (options.provideAppCheck !== false) {
      providers.push({ provide: AppCheck, useValue: appCheckMock });
    }

    TestBed.configureTestingModule({ providers });
    return TestBed.inject(AppCheckReadinessService);
  }

  beforeEach(() => {
    appCheckMock = {};
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

  it('should clear the memoized readiness promise after a failure', async () => {
    hoisted.mockGetAppCheckToken
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValueOnce({ token: 'app-check-token' });

    await expect(service.ensureReady()).rejects.toThrow('bootstrap failed');
    await expect(service.ensureReady()).resolves.toBeUndefined();

    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledTimes(2);
  });

  it('should return a usable token through getToken', async () => {
    await expect(service.getToken()).resolves.toBe('app-check-token');
    expect(hoisted.mockGetAppCheckToken).toHaveBeenCalledWith(appCheckMock, false);
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
});
