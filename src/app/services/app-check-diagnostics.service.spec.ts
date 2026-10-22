import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppCheckDiagnosticsService } from './app-check-diagnostics.service';
import { LoggerService } from './logger.service';
import { Logger as FirebaseLogger } from '@firebase/logger';
import { appCheckBeforeBreadcrumb } from '../helpers/app-check-console-diagnostics.helper';

const sdk = vi.hoisted(() => ({ onTokenChanged: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('app/firebase/app-check', () => ({ onTokenChanged: sdk.onTokenChanged }));

describe('AppCheckDiagnosticsService', () => {
  const logger = { captureMessage: vi.fn() };
  const unrelatedSDKLogger = new FirebaseLogger('app-check-review-sentinel');
  unrelatedSDKLogger.setLogLevel('silent');
  let service: AppCheckDiagnosticsService;
  let next: (result: { token: string }) => void;
  let error: (failure: unknown) => void;
  let log: (entry: { type: string; level: string; message: string; args?: unknown[] }) => void;
  beforeEach(() => {
    vi.resetAllMocks();
    sdk.onTokenChanged.mockImplementation((_app, onNext, onError) => {
      next = onNext; error = onError; return sdk.unsubscribe;
    });
    log = entry => appCheckBeforeBreadcrumb(
      { category: 'console', level: entry.level === 'warn' ? 'warning' : entry.level },
      { input: [`[2026-10-20T10:00:00.000Z]  ${entry.type}:`, entry.message] },
    );
    TestBed.configureTestingModule({ providers: [{ provide: LoggerService, useValue: logger }] });
    service = TestBed.inject(AppCheckDiagnosticsService);
    service.observeInitialRejections();
    service.observeInitialRejections();
    const app = {} as never;
    service.monitor(app);
    service.monitor(app);
  });
  afterEach(() => vi.restoreAllMocks());

  it('observes the initial rejection once and discards private error fields', () => {
    const failure = Object.assign(new Error('private-message'), {
      code: 'appCheck/initial-throttle',
      customData: { httpStatus: 403, time: '01d:00m:00s', token: 'private-token', uid: 'private-owner' },
    });
    error(failure);
    service.reportFailure(failure, 'token-request');
    error({ code: 'appCheck/throttled', customData: { httpStatus: 403, time: '23h:59m:59s' } });
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);
    expect(logger.captureMessage).toHaveBeenCalledWith('App Check verification failed', expect.objectContaining({
      fingerprint: ['app-check-verification', 'initial-rejection', '403'],
      tags: { appCheckPhase: 'initial-rejection', appCheckErrorCode: 'appCheck/initial-throttle', appCheckHttpStatus: '403',
        appCheckAuthState: 'restoring' },
      contexts: { appCheck: expect.objectContaining({ httpStatus: 403, retryAfterSeconds: 86400, source: 'token-observer', cooldown: true }) },
    }));
    expect(JSON.stringify(logger.captureMessage.mock.calls)).not.toContain('private');
  });

  it('reports an already active cooldown honestly when the initial rejection was unavailable', () => {
    service.reportFailure({ code: 'appCheck/throttled', customData: { httpStatus: 403 } }, 'token-request');
    expect(logger.captureMessage.mock.calls[0][1].tags.appCheckPhase).toBe('cooldown');
  });

  it('starts a new reporting episode only after a usable token arrives', () => {
    next({ token: 'first-private-token' });
    const failure = { code: 'appCheck/recaptcha-error' };
    error(failure); error(failure);
    next({ token: 'fresh-private-token' });
    error(failure);
    expect(logger.captureMessage.mock.calls.filter(call => call[0] === 'App Check verification failed')).toHaveLength(2);
    expect(logger.captureMessage).toHaveBeenCalledWith('App Check verification outcome', expect.objectContaining({
      tags: expect.objectContaining({ appCheckOutcome: 'token-available' }),
    }));
  });

  it('distinguishes unresolved Auth restoration from a resolved signed-out or signed-in state', () => {
    error({ code: 'appCheck/recaptcha-error' });
    expect(logger.captureMessage.mock.calls[0][1].contexts.appCheck.authState).toBe('restoring');
    service.setAuthState('signed-out');
    error({ code: 'appCheck/fetch-network-error' });
    expect(logger.captureMessage.mock.calls[1][1].contexts.appCheck.authState).toBe('signed-out');
    service.setAuthState('signed-in');
    error({ code: 'appCheck/recaptcha-error' });
    expect(logger.captureMessage.mock.calls[2][1].contexts.appCheck.authState).toBe('signed-in');
  });

  it('does not report successes without a failure or treat an empty token as recovery', () => {
    next({ token: '' }); next({ token: 'cached-private-token' });
    service.reportOperationSucceeded('profile-load', service.beginOperation());
    service.reportOperationSucceeded('callable', service.beginOperation());
    expect(logger.captureMessage).not.toHaveBeenCalled();
    error({ code: 'appCheck/recaptcha-error' });
    next({ token: '' });
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('records one bounded recovery with notification count and elapsed time, without serializing tokens', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    next({ token: 'old-private-token' });
    const failure = { code: 'appCheck/recaptcha-error', message: 'private-message', customData: { token: 'private-token' } };
    error(failure); error(failure); service.reportFailure(failure, 'token-request');
    clock.mockReturnValue(6000);
    next({ token: 'new-private-token' }); next({ token: 'new-private-token' });
    expect(logger.captureMessage).toHaveBeenCalledTimes(2);
    expect(logger.captureMessage.mock.calls[1][1]).toMatchObject({
      level: 'info', contexts: { appCheck: { outcome: 'token-available', elapsedMs: 5000,
        failureNotifications: 3, tokenChanged: true } },
    });
    expect(JSON.stringify(logger.captureMessage.mock.calls)).not.toContain('private');
  });

  it('labels the first observed token honestly when there was no earlier token to compare', () => {
    error({ code: 'appCheck/recaptcha-error' });
    next({ token: 'private-token' });
    expect(logger.captureMessage.mock.calls[1][1].contexts.appCheck.tokenChanged).toBeNull();
  });

  it('does not call a cached-token notification a verification recovery', () => {
    next({ token: 'cached-private-token' });
    error({ code: 'appCheck/recaptcha-error' });
    next({ token: 'cached-private-token' }); error({ code: 'appCheck/recaptcha-error' });
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('distinguishes token availability from a blocked operation actually succeeding', () => {
    service.setAuthState('signed-in');
    const attempt = service.beginOperation();
    const failure = { code: 'appCheck/recaptcha-error' };
    error(failure);
    service.reportOperationBlocked(failure, 'profile-load', attempt);
    service.reportOperationBlocked(failure, 'profile-load', attempt);
    next({ token: 'private-token' });
    service.reportOperationSucceeded('profile-load', service.beginOperation());
    service.reportOperationSucceeded('profile-load', service.beginOperation());
    const outcomes = logger.captureMessage.mock.calls.filter(call => call[0] === 'App Check verification outcome');
    expect(outcomes.map(call => call[1].contexts.appCheck.outcome)).toEqual([
      'operation-blocked', 'token-available', 'operation-succeeded',
    ]);
    expect(outcomes[0][1].level).toBe('warning');
    expect(outcomes[2][1].level).toBe('info');
    expect(outcomes[2][1].tags.appCheckOperation).toBe('profile-load');
  });

  it('reports a final server App Check rejection but never attributes generic index or permission errors', () => {
    const attempt = service.beginOperation();
    error({ code: 'appCheck/recaptcha-error' }); logger.captureMessage.mockClear();
    for (const failure of [{ code: 'failed-precondition', message: 'The query requires an index.' },
      { code: 'permission-denied' }, { code: 'functions/internal' }]) {
      service.reportOperationBlocked(failure, 'callable', attempt);
    }
    expect(logger.captureMessage).not.toHaveBeenCalled();
    service.reportOperationBlocked({ code: 'functions/failed-precondition',
      message: 'App Check verification failed. private-message' }, 'callable', attempt);
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);
    expect(logger.captureMessage.mock.calls[0][1].contexts.appCheck.code).toBe('appCheck/unknown');
    expect(JSON.stringify(logger.captureMessage.mock.calls)).not.toContain('private');
  });

  it('requires the same callable to succeed before reporting recovery, without serializing its scope', () => {
    const attempt = service.beginOperation();
    const failure = { code: 'appCheck/recaptcha-error' };
    service.reportOperationBlocked(failure, 'callable', attempt, 'private-scope');
    service.reportOperationBlocked(failure, 'callable', attempt, 'private-scope');
    service.reportOperationSucceeded('callable', service.beginOperation(), 'unrelated-scope');
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);
    service.reportOperationSucceeded('callable', service.beginOperation(), 'private-scope');
    expect(logger.captureMessage).toHaveBeenCalledTimes(2);
    expect(logger.captureMessage.mock.calls[1][1].contexts.appCheck.failureNotifications).toBe(2);
    expect(JSON.stringify(logger.captureMessage.mock.calls)).not.toContain('scope');
  });

  it.each(['callable', 'profile-load'] as const)('requires a %s attempt to start after the latest blocked failure', operation => {
    const earlier = service.beginOperation();
    const failed = service.beginOperation();
    const concurrent = service.beginOperation();
    const failure = { code: 'appCheck/recaptcha-error' };
    service.reportOperationBlocked(failure, operation, failed);
    for (const attempt of [earlier, failed, concurrent]) service.reportOperationSucceeded(operation, attempt);
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);

    const firstRetry = service.beginOperation();
    const failedRetry = service.beginOperation();
    service.reportOperationBlocked(failure, operation, failedRetry);
    service.reportOperationSucceeded(operation, firstRetry);
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);

    const recovery = service.beginOperation();
    service.reportOperationSucceeded(operation, recovery);
    expect(logger.captureMessage).toHaveBeenCalledTimes(2);
    expect(logger.captureMessage.mock.calls[1][1].contexts.appCheck).toMatchObject({
      outcome: 'operation-succeeded', failureNotifications: 2,
    });
    const serialized = JSON.stringify(logger.captureMessage.mock.calls);
    expect(serialized).not.toContain('sequence');
    expect(serialized).not.toContain('authRevision');
  });

  it('drops stale operation completions and clears previous-session recovery state on Auth changes', () => {
    service.setAuthState('signed-in');
    const oldAttempt = service.beginOperation();
    const failure = { code: 'appCheck/recaptcha-error' };
    error(failure); service.reportOperationBlocked(failure, 'callable', oldAttempt);
    logger.captureMessage.mockClear();
    // Same state can also be a switch between signed-in accounts.
    service.setAuthState('signed-in');
    service.reportOperationBlocked(failure, 'callable', oldAttempt);
    service.reportOperationSucceeded('callable', oldAttempt);
    service.reportOperationSucceeded('callable', service.beginOperation());
    next({ token: 'private-token' });
    expect(logger.captureMessage).not.toHaveBeenCalled();
  });

  it('preserves the initial Auth-restoration label when a token arrives after Auth resolves', () => {
    error({ code: 'appCheck/recaptcha-error' });
    service.setAuthState('signed-out');
    next({ token: 'private-token' });
    expect(logger.captureMessage.mock.calls[1][1].contexts.appCheck).toMatchObject({
      authStateAtFailure: 'restoring', authState: 'signed-out',
    });
  });

  it('caps recovery notifications and timing metadata for noisy or long-lived pages', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 25; i += 1) {
      error({ code: 'appCheck/recaptcha-error' });
      clock.mockReturnValue(172_800_000);
      next({ token: `private-token-${i}` });
      clock.mockReturnValue(0);
    }
    const outcomes = logger.captureMessage.mock.calls.filter(call => call[0] === 'App Check verification outcome');
    expect(outcomes).toHaveLength(20);
    expect(outcomes.every(call => call[1].contexts.appCheck.elapsedMs === 86_400_000)).toBe(true);
    expect(sdk.onTokenChanged).toHaveBeenCalledTimes(1);
  });

  it('contains outcome reporting failures and still clears recovered state', () => {
    const attempt = service.beginOperation();
    const failure = { code: 'appCheck/recaptcha-error' };
    error(failure);
    logger.captureMessage.mockImplementation(() => { throw new Error('Sentry unavailable'); });
    expect(() => service.reportOperationBlocked(failure, 'callable', attempt)).not.toThrow();
    expect(() => next({ token: 'private-token' })).not.toThrow();
    expect(() => service.reportOperationSucceeded('callable', service.beginOperation())).not.toThrow();
    logger.captureMessage.mockReset();
    service.reportOperationSucceeded('callable', service.beginOperation());
    expect(logger.captureMessage).not.toHaveBeenCalled();
  });

  it('does not record tokens or unknown errors on success and detaches on destruction', () => {
    next({ token: 'private-token' }); error(new Error('private-message'));
    expect(logger.captureMessage).not.toHaveBeenCalled();
    expect(sdk.onTokenChanged).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
    expect(sdk.unsubscribe).toHaveBeenCalledTimes(1);
    log({ type: '@firebase/app-check', level: 'warn',
      message: 'AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).' });
    expect(logger.captureMessage).not.toHaveBeenCalled();
  });

  it('captures an initial refresh rejection even when the SDK keeps its cached token usable', () => {
    next({ token: 'cached-private-token' });
    log({ type: '@firebase/app-check', level: 'warn',
      message: 'AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).',
      args: ['private-message', { token: 'private-token' }],
    });
    next({ token: 'cached-private-token' });
    error({ code: 'appCheck/throttled', customData: { httpStatus: 403 } });
    expect(logger.captureMessage).toHaveBeenCalledTimes(1);
    expect(logger.captureMessage.mock.calls[0][1].contexts.appCheck.source).toBe('console-breadcrumb');
    expect(JSON.stringify(logger.captureMessage.mock.calls)).not.toContain('private');
  });

  it('ignores other Firebase logs and non-initial or malformed messages', () => {
    const message = 'AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).';
    log({ type: '@firebase/firestore', level: 'warn', message });
    log({ type: '@firebase/app-check', level: 'info', message });
    log({ type: '@firebase/app-check', level: 'warn', message: 'private-token' });
    expect(logger.captureMessage).not.toHaveBeenCalled();
  });

  it('does not throw if reporting fails', () => {
    logger.captureMessage.mockImplementation(() => { throw new Error('reporting unavailable'); });
    expect(() => error({ code: 'appCheck/initial-throttle' })).not.toThrow();
  });

  it('does not format disabled debug logs from unrelated Firebase services', () => {
    const toJSON = vi.fn(() => 'private-document-data');
    unrelatedSDKLogger.debug({ toJSON });
    expect(toJSON).not.toHaveBeenCalled();
    expect(logger.captureMessage).not.toHaveBeenCalled();
  });
});
