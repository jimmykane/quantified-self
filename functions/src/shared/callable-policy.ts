import { HttpsError } from 'firebase-functions/v2/https';

// Keep callable admission policy independent of activity/import utilities so
// latency-sensitive endpoints can load it without the rest of the backend.
export const ALLOWED_CORS_ORIGINS: (string | RegExp)[] = [
  'https://quantified-self.io',
  'https://beta.quantified-self.io',
  /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+$/
];

/**
 * Global toggle for App Check enforcement.
 * Set to `false` to disable App Check verification for all functions.
 * This is useful for local development or testing.
 *
 * WARNING: Always keep this `true` in production!
 */
export const ENFORCE_APP_CHECK = true;

/**
 * The Firebase Functions emulator sets this flag inside the local worker
 * process. It is not derived from a request value, so it cannot be supplied
 * by a remote caller to weaken production verification.
 */
export function isFunctionsEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true';
}

export function shouldEnforceAppCheck(): boolean {
  return ENFORCE_APP_CHECK && !isFunctionsEmulator();
}

/**
 * Enforces App Check verification if ENFORCE_APP_CHECK is enabled.
 * Throws an HttpsError if verification fails.
 *
 * @param request - The callable request object containing app verification
 * @throws HttpsError with 'failed-precondition' code if App Check fails
 */
export function enforceAppCheck(request: { app?: unknown }): void {
  if (shouldEnforceAppCheck() && !request.app) {
    throw new HttpsError('failed-precondition', 'App Check verification failed.');
  }
}
