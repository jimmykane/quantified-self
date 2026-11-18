import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getUserDeletionGuardedDocumentsInTransaction } from '../shared/user-deletion-guard';

export const DRY_RUN_MATCHES = 'inactivityDryRunMatches';
export interface DryRunDraft {
    id: string;
    slot: 'a' | 'b';
    settingsRevision: number;
    eligibleCount: number;
}

// The two slots bound storage per account and keep the published report intact
// while another scan runs. A fresh ID hides any rows left by an abandoned scan.
export function dryRunDraft(config: DocumentSnapshot): DryRunDraft {
    const revision = config.get('settingsRevision') ?? 0;
    const draft = config.get('dryRunDraft') as DryRunDraft | undefined;
    if (draft && draft.settingsRevision === revision) return draft;
    return { id: randomUUID(), slot: config.get('lastCompletedDryRun.slot') === 'a' ? 'b' : 'a', settingsRevision: revision, eligibleCount: 0 };
}

export async function recordDryRunPage(db: Firestore, tx: Transaction, config: DocumentSnapshot,
    draft: DryRunDraft, eligibleUids: string[], finishedAt: Timestamp | null): Promise<void> {
    if (config.get('dryRunDraft.id') !== draft.id || (config.get('settingsRevision') ?? 0) !== draft.settingsRevision)
        throw new Error('inactivity_run_superseded');

    const matches = await Promise.all([...new Set(eligibleUids)].map(async uid => {
        const ref = db.doc(`users/${uid}/${DRY_RUN_MATCHES}/${draft.slot}`);
        const { guard, snapshots: [existing] } = await getUserDeletionGuardedDocumentsInTransaction(db, tx, uid, [ref]);
        return guard.shouldSkip || existing.get('scanId') === draft.id ? null : ref;
    }));
    let eligibleCount: number = config.get('dryRunDraft.eligibleCount');
    for (const ref of matches) {
        if (!ref) continue;
        tx.set(ref, { scanId: draft.id });
        eligibleCount++;
    }
    if (finishedAt) {
        tx.update(config.ref, { lastCompletedDryRun: { id: draft.id, slot: draft.slot, eligibleCount, finishedAt },
            dryRunDraft: FieldValue.delete() });
    } else {
        tx.update(config.ref, { 'dryRunDraft.eligibleCount': eligibleCount });
    }
}
