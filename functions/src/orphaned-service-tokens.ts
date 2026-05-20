import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { getExpireAtTimestamp, TTL_CONFIG } from './shared/ttl-config';

export const ORPHANED_SERVICE_TOKENS_COLLECTION_NAME = 'orphaned_service_tokens';

export async function archiveOrphanedServiceToken(
    uid: string,
    serviceName: ServiceNames,
    originalTokenId: string,
    tokenData: Record<string, unknown>,
    error: unknown,
): Promise<void> {
    const db = admin.firestore();
    const docId = `${serviceName}_${uid}_${originalTokenId}`;
    const errorString = error instanceof Error
        ? error.message
        : `${error || 'Unknown Error'}`;

    try {
        await db.collection(ORPHANED_SERVICE_TOKENS_COLLECTION_NAME).doc(docId).set({
            serviceName,
            uid,
            originalTokenId,
            token: tokenData || {},
            archivedAt: admin.firestore.Timestamp.now(),
            expireAt: getExpireAtTimestamp(TTL_CONFIG.ORPHANED_TOKEN_IN_DAYS),
            lastError: errorString,
        });
        logger.info(`[Cleanup] Archived orphaned token ${originalTokenId} for ${serviceName} user ${uid} due to error: ${errorString}`);
    } catch (archiveError) {
        logger.error(`[Cleanup] Failed to archive orphaned token ${originalTokenId} for ${uid}`, archiveError);
    }
}
