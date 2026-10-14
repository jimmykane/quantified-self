const ERROR_NAMES = ['Error', 'FirebaseError', 'TimeoutError', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError'] as const;
const FIRESTORE_ERROR_CODES = [
  'cancelled', 'unknown', 'invalid-argument', 'deadline-exceeded', 'not-found', 'already-exists',
  'permission-denied', 'resource-exhausted', 'failed-precondition', 'aborted', 'out-of-range',
  'unimplemented', 'internal', 'unavailable', 'data-loss', 'unauthenticated',
] as const;

/** Error messages, stacks and arbitrary SDK fields can contain private document paths or query data. */
export function calendarReadErrorDetails(error: unknown): {
  errorName: typeof ERROR_NAMES[number] | 'UnknownError';
  errorCode: typeof FIRESTORE_ERROR_CODES[number];
} {
  const value = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : null;
  const code = typeof value?.code === 'string' ? value.code.replace(/^firestore\//, '') : null;
  return {
    errorName: ERROR_NAMES.find(name => name === value?.name) ?? 'UnknownError',
    errorCode: FIRESTORE_ERROR_CODES.find(known => known === code) ?? 'unknown',
  };
}
