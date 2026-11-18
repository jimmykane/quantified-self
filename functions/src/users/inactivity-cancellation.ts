import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { INACTIVITY_COLLECTION, timestampMillis } from './inactivity-policy';

/** Called from subscription events as well as periodic reads, so a brief restored membership
 * between scans cannot leave an old warning valid. Old redeliveries cannot cancel newer notices. */
export async function invalidateInactivityWarning(db: Firestore, uid: string, changedAt: number): Promise<void> {
    await db.runTransaction(async tx => {
        const [guard, episode] = await Promise.all([
            getUserDeletionGuardStateInTransaction(db, tx, uid), tx.get(db.doc(`users/${uid}/${INACTIVITY_COLLECTION}/state`)),
        ]);
        const queuedAt = timestampMillis(episode.get('queuedAt'));
        if (guard.shouldSkip || !['queued', 'warned'].includes(episode.get('state')) || queuedAt === null || changedAt <= queuedAt) return;
        tx.update(episode.ref, { state: 'cancelled', nextCheckAt: FieldValue.delete(), cancelledAt: FieldValue.serverTimestamp() });
    });
}
