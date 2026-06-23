import * as admin from 'firebase-admin';
import { Timestamp as FirestoreTimestamp } from 'firebase-admin/firestore';

/**
 * Global Time-To-Live (TTL) configuration for the project.
 * All values are specified in DAYS.
 */
export const TTL_CONFIG = {
    MAIL_IN_DAYS: 90,
    QUEUE_ITEM_IN_DAYS: 7,
    PENDING_DISCONNECT_QUEUE_ITEM_IN_DAYS: 35,
    ORPHANED_TOKEN_IN_DAYS: 90,
    FAILED_JOBS_IN_DAYS: 30,
    SPORTS_LIB_REPARSE_JOBS_IN_DAYS: 30,
    AI_INSIGHTS_PROMPT_REPAIRS_IN_DAYS: 90,
} as const;


/**
 * Helper to calculate a Firestore Timestamp for expiration based on days from now.
 * @param days - Number of days from now when the document should expire
 * @returns Firestore Timestamp
 */
export function getExpireAtTimestamp(days: number): admin.firestore.Timestamp {
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const namespaceTimestamp = (admin as { firestore?: { Timestamp?: typeof FirestoreTimestamp } }).firestore?.Timestamp;
    const timestampFactory = namespaceTimestamp || FirestoreTimestamp;
    return timestampFactory.fromDate(expiresAt) as admin.firestore.Timestamp;
}
