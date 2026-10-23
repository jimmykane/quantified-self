import { describe, expect, it } from 'vitest';
import { appCheckFailureDetails, initialAppCheckRejectionFromLog, isAppCheckVerificationFailure } from './app-check-error.helper';

describe('appCheckFailureDetails', () => {
  it('requires explicit App Check evidence before attributing a blocked operation', () => {
    expect(isAppCheckVerificationFailure({ code: 'appCheck/recaptcha-error' })).toBe(true);
    expect(isAppCheckVerificationFailure({ code: 'functions/failed-precondition', message: 'App Check verification failed.' })).toBe(true);
    for (const error of [null, {}, { code: 'failed-precondition', message: 'The query requires an index.' },
      { code: 'permission-denied' }, { code: 'functions/internal', message: 'App Check verification failed.' }]) {
      expect(isAppCheckVerificationFailure(error)).toBe(false);
    }
  });
  it('recognizes only the exact SDK initial-rejection log grammar', () => {
    const warning = 'AppCheck: 403 error. Attempts allowed again after 01d:00m:00s (appCheck/initial-throttle).';
    expect(initialAppCheckRejectionFromLog(warning)).toEqual({
      code: 'appCheck/initial-throttle', httpStatus: 403, retryAfterSeconds: 86400, cooldown: true, retryable: false,
    });
    for (const invalid of [null, {}, 'private-token', warning + ' private-token',
      warning.replace('01d', '02d'), warning.replace('403', '999'), warning.replace('initial-throttle', 'throttled')]) {
      expect(initialAppCheckRejectionFromLog(invalid)).toBeNull();
    }
  });
  it.each(['initial-throttle', 'throttled'])('never fast-retries a rejected %s, including short SDK cooldowns', code => {
    for (const httpStatus of [403, 404]) {
      expect(appCheckFailureDetails({ code: `appCheck/${code}`, customData: { httpStatus, time: '00m:02s' } }))
        .toEqual({ code: `appCheck/${code}`, httpStatus, retryAfterSeconds: 2, cooldown: true, retryable: false });
    }
  });

  it.each(['initial-throttle', 'throttled'])('allows a bounded wait for temporary %s failures', code => {
    for (const httpStatus of [408, 429, 500, 503]) {
      expect(appCheckFailureDetails({ code: `appCheck/${code}`, customData: { httpStatus, time: '00m:02s' } })?.retryable).toBe(true);
      for (const time of [undefined, 'private-value', '00m:11s', '01d:00m:00s']) {
        expect(appCheckFailureDetails({ code: `appCheck/${code}`, customData: { httpStatus, time } })?.retryable).toBe(false);
      }
    }
  });

  it.each([['01d:00m:00s', 86400], ['23h:55m:31s', 86131], ['02m:03s', 123], ['00m:00s', 0]])(
    'accepts the SDK duration %s', (time, expected) => {
      expect(appCheckFailureDetails({ code: 'appCheck/throttled', customData: { time } })?.retryAfterSeconds).toBe(expected);
    });

  it.each(['private-token', '02d:00m:00s', '01d:01h:00m:00s', '24h:00m:00s', '00m:99s', '99m:00s', -1, null])(
    'discards malformed or excessive cooldown values (%j)', time => {
      expect(appCheckFailureDetails({ code: 'appCheck/throttled', customData: { time } })?.retryAfterSeconds).toBeNull();
    });

  it.each([403, 404, 400, 401])('does not retry a rejected token exchange (%s)', httpStatus => {
    expect(appCheckFailureDetails({ code: 'appCheck/fetch-status-error', customData: { httpStatus } })?.retryable).toBe(false);
  });

  it.each([408, 429, 500, 503, undefined])('allows bounded retries for a transient exchange failure (%s)', httpStatus => {
    expect(appCheckFailureDetails({ code: 'appCheck/fetch-status-error', customData: { httpStatus } })?.retryable).toBe(true);
  });

  it('retains network retries but requires user action for reCAPTCHA and configuration failures', () => {
    expect(appCheckFailureDetails({ code: 'appCheck/fetch-network-error' })?.retryable).toBe(true);
    for (const code of ['recaptcha-error', 'already-initialized', 'use-before-activation', 'private-code']) {
      expect(appCheckFailureDetails({ code: `appCheck/${code}` })?.retryable).toBe(false);
    }
  });

  it('excludes arbitrary SDK data from diagnostics', () => {
    const result = appCheckFailureDetails({
      code: 'appCheck/private-code', message: 'private-message', stack: 'private-stack',
      customData: { httpStatus: '403', time: 'private-time', token: 'private-token', uid: 'private-owner' },
    });
    expect(result).toEqual({ code: 'appCheck/unknown', httpStatus: 403, retryAfterSeconds: null, cooldown: false, retryable: false });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(appCheckFailureDetails({ code: 'appCheck/throttled', customData: { httpStatus: '403 private-token' } })?.httpStatus).toBeNull();
  });

  it.each([null, undefined, 'private-error', { code: 'permission-denied' }])('ignores non-App Check errors (%j)', error => {
    expect(appCheckFailureDetails(error)).toBeNull();
  });
});
