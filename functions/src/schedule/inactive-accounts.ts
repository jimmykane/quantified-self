import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { INACTIVITY_CONTINUATION } from '../users/inactivity-policy';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { getBillingStripe } from '../stripe/client';
import { runInactivitySweep } from '../users/inactivity';

const runtime = { region: 'europe-west2', memory: '512MiB', timeoutSeconds: 540, concurrency: 1, maxInstances: 1 } as const;

async function processBatch(continuationId?: string): Promise<void> {
    try {
        const summary = await runInactivitySweep({ db: admin.firestore(), auth: admin.auth(), stripe: getBillingStripe }, continuationId);
        // Counts/fixed categories only. Never log candidate UIDs, addresses, provider payloads or raw errors.
        logger.info('[AccountInactivity]', { telemetryVersion: 1, ...summary });
    } catch {
        logger.error('[AccountInactivity]', { telemetryVersion: 1, outcome: 'failed' });
        throw new Error('account_inactivity_failed');
    }
}

export const processInactiveAccounts = onSchedule({
    ...runtime, schedule: 'every 24 hours', retryCount: 0, secrets: FUNCTION_SECRET_BINDINGS.processInactiveAccounts,
}, () => processBatch());

export const continueInactiveAccounts = onDocumentCreated({
    ...runtime, document: INACTIVITY_CONTINUATION, retry: true, secrets: FUNCTION_SECRET_BINDINGS.continueInactiveAccounts,
}, async event => {
    const id = event.data?.get('id');
    if (typeof id === 'string' && id.length) await processBatch(id);
});
