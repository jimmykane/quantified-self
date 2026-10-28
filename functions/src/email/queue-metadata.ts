import { FieldValue } from 'firebase-admin/firestore';

/** New mail only: merge into its existing create/write, never reset a retained delivery. */
export function newEmailDeliveryFields() {
  return { queuedAt: FieldValue.serverTimestamp(), delivery: {
    state: 'PENDING' as const, startTime: FieldValue.serverTimestamp(), attempts: 0, error: null,
  } };
}
