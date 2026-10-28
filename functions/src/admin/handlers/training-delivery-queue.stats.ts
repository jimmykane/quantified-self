import type { Firestore, Query } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { PLANNED_WORKOUT_PROVIDER_IDS } from '../../../../shared/planned-workout-providers';
import type { TrainingDeliveryQueueStats } from '../../../../shared/admin-queue-stats';
import { TRAINING_DELIVERY_STATUSES } from '../../../../shared/training-provider-delivery';
import { DELIVERY_QUEUE } from '../../training-plans/delivery/contracts';

const OUTCOME_STATUSES = ['delivered', 'retrying', 'failed', 'needs_attention'] as const;

async function count(query: Query): Promise<number> {
    return (await query.count().get()).data().count;
}

const emptyOutcomes = () => ({ delivered: 0, retrying: 0, failed: 0, needsAttention: 0 });

/** Bounded aggregate reads only. Never enumerate user records or return remote IDs or error bodies. */
export async function getTrainingDeliveryQueueStats(db: Firestore, nowMs: number): Promise<TrainingDeliveryQueueStats> {
    const queue = db.collection(DELIVERY_QUEUE);
    const providers = PLANNED_WORKOUT_PROVIDER_IDS.map(provider => ({ provider, queued: 0, ...emptyOutcomes() }));
    const result: TrainingDeliveryQueueStats = {
        jobsAvailable: false,
        jobs: { total: 0, due: 0, reconcile: 0, delivery: 0, verification: 0, oldestDueLagMs: 0 },
        statusCountsAvailable: false,
        outcomes: emptyOutcomes(),
        providers,
    };

    try {
        const [total, due, reconcile, delivery, verification, ...byProvider] = await Promise.all([
            count(queue),
            count(queue.where('dueAtMs', '<=', nowMs)),
            ...(['reconcile', 'delivery', 'verification'] as const).map(kind => count(queue.where('kind', '==', kind))),
            ...PLANNED_WORKOUT_PROVIDER_IDS.map(provider => count(queue.where('provider', '==', provider))),
        ]);
        const oldestDue = await queue.where('dueAtMs', '<=', nowMs).orderBy('dueAtMs', 'asc').limit(1).get();
        const oldestDueAtMs = oldestDue.empty ? nowMs : Number(oldestDue.docs[0].data()?.dueAtMs);
        result.jobs = {
            total, due, reconcile, delivery, verification,
            oldestDueLagMs: Number.isFinite(oldestDueAtMs) ? Math.max(0, nowMs - oldestDueAtMs) : 0,
        };
        providers.forEach((item, index) => { item.queued = byProvider[index]; });
        result.jobsAvailable = true;
    } catch (error) {
        logger.warn('[admin/getQueueStats] Training delivery job counts unavailable', error);
    }

    try {
        const statuses = db.collectionGroup(TRAINING_DELIVERY_STATUSES);
        const outcomeQuery = (query: Query, status: typeof OUTCOME_STATUSES[number]) => {
            const matching = query.where('status', '==', status);
            // A repair paused after repeated confirmed deletions can retain `delivered`
            // while the owner projection correctly says the remote copy is missing.
            return status === 'delivered' ? matching.where('hasRemoteCopy', '==', true) : matching;
        };
        const [all, ...perProvider] = await Promise.all([
            Promise.all(OUTCOME_STATUSES.map(status => count(outcomeQuery(statuses, status)))),
            ...PLANNED_WORKOUT_PROVIDER_IDS.map(provider => Promise.all(OUTCOME_STATUSES.map(status =>
                count(outcomeQuery(statuses.where('provider', '==', provider), status))))),
        ]);
        const toOutcomes = (counts: number[]) => ({
            delivered: counts[0], retrying: counts[1], failed: counts[2], needsAttention: counts[3],
        });
        result.outcomes = toOutcomes(all);
        providers.forEach((item, index) => Object.assign(item, toOutcomes(perProvider[index])));
        result.statusCountsAvailable = true;
    } catch (error) {
        // A missing collection-group index must not hide every other admin queue.
        logger.warn('[admin/getQueueStats] Training delivery outcome counts unavailable', error);
    }
    return result;
}
