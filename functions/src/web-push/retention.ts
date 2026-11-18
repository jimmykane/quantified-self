import { NOTIFICATION_RETENTION_MS } from '../../../shared/web-push';
export { NOTIFICATION_RETENTION_MS };
const DAY = 86400000;
export const TRAINING_RESULT_RETENTION_MS = 2 * DAY;
/** Firestore serializes Date as Timestamp, the type required by its expireAt TTL policy. */
export const notificationExpiry = (now: number) => new Date(now + NOTIFICATION_RETENTION_MS);
export const trainingResultExpiry = (createdAt: number) => new Date(createdAt + TRAINING_RESULT_RETENTION_MS);
// Keep unresolved workout receipts until the workout cannot qualify, including timezone offsets.
export function trainingIssueExpiry(now: number, localDate: string): Date {
  const workout = Date.parse(localDate);
  return new Date(Math.max(now + NOTIFICATION_RETENTION_MS, Number.isFinite(workout) ? workout + 3 * DAY : 0));
}
