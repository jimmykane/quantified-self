import { describe, expect, it } from 'vitest';
import { TimeoutError } from 'rxjs';
import { calendarReadErrorDetails } from './calendar-read-error.helper';

describe('calendarReadErrorDetails', () => {
  it('identifies the actual RxJS read timeout without its observable data', () => {
    const error = new TimeoutError({ meta: { uid: 'private-owner' }, lastValue: 'private-activity', seen: 0 });
    expect(calendarReadErrorDetails(error)).toEqual({ errorName: 'TimeoutError', errorCode: 'unknown' });
  });

  it.each(['permission-denied', 'unavailable', 'failed-precondition', 'unauthenticated', 'deadline-exceeded'])(
    'preserves the standard Firestore %s code with either SDK prefix form', code => {
      for (const sdkCode of [code, `firestore/${code}`]) {
        const error = { name: 'FirebaseError', code: sdkCode, message: 'users/private-owner/events/private-event' };
        expect(calendarReadErrorDetails(error)).toEqual({ errorName: 'FirebaseError', errorCode: code });
      }
    });

  it('preserves parsing error types without their messages, stacks or extra fields', () => {
    const error = Object.assign(new SyntaxError('private-calendar-date'), { uid: 'private-owner', data: ['private-workout'] });
    expect(calendarReadErrorDetails(error)).toEqual({ errorName: 'SyntaxError', errorCode: 'unknown' });
  });

  it.each([null, undefined, 'private-error-text', 504, { name: 'private-owner', code: 'private-token' }])(
    'reduces unexpected errors to fixed fallback labels (%j)', error => {
      expect(calendarReadErrorDetails(error)).toEqual({ errorName: 'UnknownError', errorCode: 'unknown' });
    });
});
