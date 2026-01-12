import * as admin from 'firebase-admin';

/**
 * Global Time-To-Live (TTL) configuration for the project.
 * All values are specified in DAYS.
 */
export const TTL_CONFIG = {
    MAIL_IN_DAYS: 90,
    QUEUE_ITEM_IN_DAYS: 14,
} as const;


/**
 * Helper to calculate a Firestore Timestamp for expiration based on days from now.
 * @param days - Number of days from now when the document should expire
 * @returns Firestore Timestamp
 */
export function getExpireAtTimestamp(days: number): admin.firestore.Timestamp {
    return admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    );
}
