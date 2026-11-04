import * as admin from 'firebase-admin';

// Wahoo quotas belong to the application, across accounts and API endpoints.
// Reuse the application/day capacity record already read by Training. Preserve
// its rolling counters; this shared cooldown contains no account/request data.
export const WAHOO_RATE_LIMIT_MAX_RESET_SECONDS = 24 * 60 * 60;
const FALLBACK_RESET_SECONDS = 5 * 60;
const RESET_GRACE_SECONDS = 5;

export function normalizeWahooRateLimitResetSeconds(value: number | null): number {
  return value !== null && Number.isFinite(value) && value > 0 && value <= WAHOO_RATE_LIMIT_MAX_RESET_SECONDS
    ? Math.ceil(value)
    : FALLBACK_RESET_SECONDS;
}

function cooldownRef() {
  return admin.firestore().collection('trainingProviderCapacity').doc('wahoo_86400000_app');
}

export async function getWahooRateLimitCooldownSeconds(): Promise<number> {
  const snapshot = await cooldownRef().get();
  const blockedUntilMs = snapshot.data()?.notBeforeMs;
  return Number.isSafeInteger(blockedUntilMs)
    ? Math.max(0, Math.ceil((blockedUntilMs - Date.now()) / 1000))
    : 0;
}

export async function extendWahooRateLimitCooldown(resetAfterSeconds: number | null): Promise<number> {
  const requestedUntilMs = Date.now()
    + (normalizeWahooRateLimitResetSeconds(resetAfterSeconds) + RESET_GRACE_SECONDS) * 1000;
  const ref = cooldownRef();
  const blockedUntilMs = await admin.firestore().runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const currentUntilMs = snapshot.data()?.notBeforeMs;
    const untilMs = Number.isSafeInteger(currentUntilMs)
      ? Math.max(currentUntilMs, requestedUntilMs)
      : requestedUntilMs;
    if (untilMs !== currentUntilMs) transaction.set(ref, { notBeforeMs: untilMs }, { merge: true });
    return untilMs;
  });
  return Math.max(1, Math.ceil((blockedUntilMs - Date.now()) / 1000));
}
