import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FUNCTIONS_MANIFEST } from '../../../shared/functions-manifest';
import { enforceAppCheck } from '../utils';
import {
    normalizeDerivedMetricKinds,
    type EnsureDerivedMetricsRequest,
    type EnsureDerivedMetricsResponse,
} from '../../../shared/derived-metrics';
import { markDerivedMetricsDirtyAndMaybeQueue } from './derived-metrics.service';

export const ensureDerivedMetrics = onCall({
    region: FUNCTIONS_MANIFEST.ensureDerivedMetrics.region,
    cors: true,
    timeoutSeconds: 120,
    maxInstances: 100,
}, async (request): Promise<EnsureDerivedMetricsResponse> => {
    if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }

    enforceAppCheck(request);

    const uid = request.auth.uid;
    const payload = (request.data || {}) as EnsureDerivedMetricsRequest;
    const metricKinds = normalizeDerivedMetricKinds(payload.metricKinds);
    return markDerivedMetricsDirtyAndMaybeQueue(uid, metricKinds);
});
