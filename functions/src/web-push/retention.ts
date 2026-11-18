const DAY = 86400000;
// Keep duplicate/rate fences beyond the longest notification replay window (30 days).
export const NOTIFICATION_RETENTION_MS = 31 * DAY;
export const TRAINING_RESULT_RETENTION_MS = 2 * DAY;
/** Firestore serializes Date as Timestamp, the type required by its expireAt TTL policy. */
export const notificationExpiry = (now: number) => new Date(now + NOTIFICATION_RETENTION_MS);
export const trainingResultExpiry = (createdAt: number) => new Date(createdAt + TRAINING_RESULT_RETENTION_MS);
// Keep unresolved workout receipts until the workout cannot qualify, including timezone offsets.
export const trainingIssueExpiry = (now: number, localDate: string, previous?: Date | { toMillis(): number }) =>
  new Date(Math.max(now + NOTIFICATION_RETENTION_MS, (Number.isFinite(Date.parse(localDate)) ? Date.parse(localDate) + 3 * DAY : 0),
    previous instanceof Date ? previous.getTime() : previous?.toMillis() ?? 0));
