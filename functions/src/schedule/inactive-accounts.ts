import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';
import { getBillingStripe } from '../stripe/client';
import { runInactivitySweep } from '../users/inactivity';

export const processInactiveAccounts = onSchedule({
    schedule: 'every 24 hours', region: 'europe-west2', memory: '512MiB', timeoutSeconds: 540,
    concurrency: 1, maxInstances: 1, retryCount: 0,
    secrets: FUNCTION_SECRET_BINDINGS.processInactiveAccounts,
}, async () => {
    try {
        const summary = await runInactivitySweep({ db: admin.firestore(), auth: admin.auth(), stripe: getBillingStripe });
        // Counts/fixed categories only. Never log candidate UIDs, addresses, provider payloads or raw errors.
        logger.info('[AccountInactivity]', { telemetryVersion: 1, ...summary });
    } catch {
        logger.error('[AccountInactivity]', { telemetryVersion: 1, outcome: 'failed' });
        throw new Error('account_inactivity_failed');
    }
});
