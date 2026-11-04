import * as admin from 'firebase-admin';
import { ServiceNames } from '@sports-alliance/sports-lib';
import { isServiceUnavailableForSyncConnection } from '../../../shared/service-connection';
import { SLEEP_PROVIDERS } from '../../../shared/sleep';
import { COROSAPI_ACCESS_TOKENS_COLLECTION_NAME } from '../coros/constants';
import { generateIDFromParts } from '../shared/id-generator';
import { getUserDeletionGuardStateInTransaction } from '../shared/user-deletion-guard';
import { doesServiceDisconnectOperationPermitTokenUse } from '../service-token-store';
import { ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD, doesOAuthCredentialGenerationAuthorizeToken } from '../token-refresh-coordinator';
import { SLEEP_SYNC_QUEUE_COLLECTION_NAME, SLEEP_SYNC_RECENT_WINDOW_DAYS } from './constants';
import { addSleepSyncQueueItem } from './queue';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const COROS_POLL_STATE_DOCUMENT = 'system/corosDailyPolling';

interface PollWindow {
    startMs: number;
    endMs: number;
    pollAtMs: number;
    reconciliation: boolean;
}
interface PendingPoll extends PollWindow {
    queueId: string;
    dedupeKey: string;
}
interface PollState {
    bindingKey: string;
    lastSuccessfulEndMs: number | null;
    lastReconciledEndMs: number | null;
    lastScheduledSlotMs: number;
    pending: PendingPoll;
}

function validTime(value: unknown, nowMs: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= nowMs;
}

/** Include every current provider-local date, through UTC+14, without assuming a user timezone. */
export function getCOROSPollWindow(nowMs: number, lastSuccessfulEndMs?: unknown, lastReconciledEndMs?: unknown): PollWindow {
    const pollAtMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
    const earliestMs = pollAtMs - SLEEP_SYNC_RECENT_WINDOW_DAYS * DAY_MS;
    const reconciliation = !validTime(lastSuccessfulEndMs, pollAtMs)
        || !validTime(lastReconciledEndMs, pollAtMs) || pollAtMs - lastReconciledEndMs >= DAY_MS;
    const overlapStartMs = validTime(lastSuccessfulEndMs, pollAtMs)
        ? Math.floor(lastSuccessfulEndMs / DAY_MS) * DAY_MS - DAY_MS
        : earliestMs;
    return { startMs: reconciliation ? earliestMs : Math.max(earliestMs, overlapStartMs),
        endMs: pollAtMs + 14 * HOUR_MS, pollAtMs, reconciliation };
}

function pendingPoll(value: unknown, lastScheduledSlotMs: unknown): PendingPoll | null {
    if (!value || typeof value !== 'object') return null;
    const data = value as PendingPoll;
    // Retain receipts/admission retries from the original UTC-only scheduler.
    const pollAtMs = data.pollAtMs ?? lastScheduledSlotMs;
    return /^[a-f0-9]{64}$/.test(data.queueId) && typeof data.dedupeKey === 'string'
        && Number.isSafeInteger(data.startMs) && Number.isSafeInteger(data.endMs)
        && typeof pollAtMs === 'number' && Number.isSafeInteger(pollAtMs)
        && data.startMs > 0 && data.startMs < pollAtMs && data.endMs >= pollAtMs
        && data.endMs <= pollAtMs + DAY_MS && typeof data.reconciliation === 'boolean'
        ? { ...data, pollAtMs } : null;
}

/**
 * One outstanding routine poll per account. The worker's committed success is
 * the receipt for BOTH Sleep and Health; admission and lastPollAtMs are not coverage.
 * State is backend-only and removed by recursive user cleanup.
 */
export async function enqueueCOROSDailyPoll(userID: string, providerUserId: string, nowMs = Date.now()): Promise<boolean> {
    const db = admin.firestore();
    const user = db.collection('users').doc(userID);
    const pollingRef = db.doc(`users/${userID}/${COROS_POLL_STATE_DOCUMENT}`);
    const metaRef = user.collection('meta').doc(ServiceNames.COROSAPI);
    const rootRef = db.collection(COROSAPI_ACCESS_TOKENS_COLLECTION_NAME).doc(userID);
    const tokenRef = rootRef.collection('tokens').doc(providerUserId);
    const reserved = await db.runTransaction(async tx => {
        if ((await getUserDeletionGuardStateInTransaction(db, tx, userID, nowMs)).shouldSkip) return null;
        const [stateSnapshot, meta, root, token] = await tx.getAll(pollingRef, metaRef, rootRef, tokenRef);
        if (!root.exists || !token.exists || !doesServiceDisconnectOperationPermitTokenUse(root.data(), undefined, nowMs)
            || isServiceUnavailableForSyncConnection(meta.data())
            || meta.get('providerUserId') !== providerUserId
            || (token.get('openId') != null && token.get('openId') !== '' && token.get('openId') !== providerUserId)
            || !doesOAuthCredentialGenerationAuthorizeToken(root.data(), token.get('tokenCredentialGeneration'))) return null;
        const bindingKey = await generateIDFromParts([userID, providerUserId,
            String(meta.get('connectionStateGeneration') ?? ''), String(token.get('tokenCredentialGeneration') ?? '')]);
        const fences = { corosTokenCredentialGeneration: token.get('tokenCredentialGeneration') ?? null,
            corosRootOAuthCredentialGeneration: root.get(ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD) ?? null,
            corosConnectionStateGeneration: meta.get('connectionStateGeneration') ?? null };
        const saved = stateSnapshot.data() as PollState | undefined;
        const state = saved?.bindingKey === bindingKey ? saved : undefined;
        const slotMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
        if (typeof state?.lastScheduledSlotMs === 'number' && state.lastScheduledSlotMs > slotMs) return null;
        let lastSuccessfulEndMs = validTime(state?.lastSuccessfulEndMs, slotMs) ? state.lastSuccessfulEndMs : null;
        let lastReconciledEndMs = validTime(state?.lastReconciledEndMs, slotMs) ? state.lastReconciledEndMs : null;
        const pending = pendingPoll(state?.pending, state?.lastScheduledSlotMs);
        if (pending) {
            const queue = await tx.get(db.collection(SLEEP_SYNC_QUEUE_COLLECTION_NAME).doc(pending.queueId));
            if (queue.exists && queue.get('processed') !== true) return null; // Includes retries and active leases.
            if (queue.exists && queue.get('resultStatus') === 'success'
                && queue.get('userID') === userID && queue.get('providerUserId') === providerUserId
                && queue.get('provider') === SLEEP_PROVIDERS.COROSAPI && queue.get('type') === 'coros_poll'
                && queue.get('rangeStartMs') === pending.startMs && queue.get('rangeEndMs') === pending.endMs
                && validTime(pending.pollAtMs, slotMs)) {
                lastSuccessfulEndMs = Math.max(lastSuccessfulEndMs ?? 0, pending.pollAtMs);
                if (pending.reconciliation) lastReconciledEndMs = Math.max(lastReconciledEndMs ?? 0, pending.pollAtMs);
            }
            if (state?.lastScheduledSlotMs === slotMs) {
                // Recover admission that failed before creating its durable queue row.
                if (!queue.exists && !(await tx.get(db.collection('failed_jobs').doc(pending.queueId))).exists)
                    return { pending, bindingKey, guards: lifecycleGuards(), fences };
                return null;
            }
        }
        const window = getCOROSPollWindow(slotMs, lastSuccessfulEndMs, lastReconciledEndMs);
        const dedupeKey = `coros-routine:${bindingKey}:${slotMs}`;
        const queueId = await generateIDFromParts([SLEEP_PROVIDERS.COROSAPI, 'coros_poll', providerUserId, dedupeKey]);
        const nextPending: PendingPoll = { ...window, queueId, dedupeKey };
        tx.set(pollingRef, { bindingKey, lastSuccessfulEndMs, lastReconciledEndMs,
            lastScheduledSlotMs: slotMs, pending: nextPending });
        return { pending: nextPending, bindingKey, guards: lifecycleGuards(), fences };

        function lifecycleGuards() {
            return [
                { documentRef: rootRef, expectedFields: {
                    [ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD]: root.get(ACTIVE_OAUTH_CREDENTIAL_GENERATION_FIELD),
                    disconnectOperationGeneration: root.get('disconnectOperationGeneration'),
                } },
                { documentRef: tokenRef, expectedFields: { openId: token.get('openId'),
                    tokenCredentialGeneration: token.get('tokenCredentialGeneration') } },
                { documentRef: metaRef, expectedFields: { providerUserId,
                    connectionState: meta.get('connectionState'), connectionStateGeneration: meta.get('connectionStateGeneration') } },
            ];
        }
    });
    if (!reserved) return false;
    await addSleepSyncQueueItem({
        type: 'coros_poll', provider: SLEEP_PROVIDERS.COROSAPI, userID, providerUserId,
        rangeStartMs: reserved.pending.startMs, rangeEndMs: reserved.pending.endMs,
        ...reserved.fences,
        dedupeKey: reserved.pending.dedupeKey, dispatchImmediately: true, preserveExisting: true,
        requiredDocumentFieldValues: [...reserved.guards, { documentRef: pollingRef,
            expectedFields: { bindingKey: reserved.bindingKey, lastScheduledSlotMs: reserved.pending.pollAtMs } }],
    });
    return true;
}
