import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import type { CountStats } from './types';

function normalizeCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.floor(value));
}

export async function getUserSubcollectionCountStats(
    db: Firestore,
    userUid: string,
    subcollectionName: 'events' | 'routes'
): Promise<CountStats> {
    try {
        const snapshot = await db.collection('users')
            .doc(userUid)
            .collection(subcollectionName)
            .count()
            .get();
        return { total: normalizeCount(snapshot.data().count) };
    } catch {
        logger.warn(`Admin ${subcollectionName} count unavailable`);
        return { total: null };
    }
}
