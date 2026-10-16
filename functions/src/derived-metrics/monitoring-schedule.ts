import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { observeDerivedMetricsQueue } from './monitoring-probe';

// There is no existing periodic derived-metrics dispatcher to observe stranded
// Firestore generations. This isolated job only reads a bounded, masked sample.
export const observeDerivedMetricsHealth = onSchedule({
    schedule: '*/15 * * * *', timeZone: 'UTC', region: 'europe-west2',
    memory: '512MiB', timeoutSeconds: 60, maxInstances: 1,
}, () => observeDerivedMetricsQueue(admin.firestore()));
