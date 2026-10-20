import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      tags: { appCheckPhase: 'initial-rejection', appCheckErrorCode: 'appCheck/initial-throttle', appCheckHttpStatus: '403' },
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
    expect(logger.captureMessage).toHaveBeenCalledTimes(2);
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
