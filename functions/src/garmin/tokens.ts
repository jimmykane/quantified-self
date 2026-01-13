import * as functions from 'firebase-functions/v1';
import * as tokens from '../tokens';
import { ServiceNames } from '@sports-alliance/sports-lib';

export const refreshGarminAPIRefreshTokens = functions.region('europe-west2').runWith({ timeoutSeconds: 180 }).pubsub.schedule('every 2 hours').onRun(async () => {
    // We target 30 days ago to ensure tokens are kept fresh.
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await tokens.refreshStaleTokens(ServiceNames.GarminAPI, thirtyDaysAgo);
});
