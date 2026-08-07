import * as functions from 'firebase-functions/v1';
import * as tokens from '../tokens';
import { ServiceNames } from '@sports-alliance/sports-lib';

import { GARMIN_TOKEN_REFRESH_THRESHOLD_DAYS } from './constants';
import { getDaysAgoTimestamp } from '../shared/date-utils';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

export const refreshGarminAPIRefreshTokens = functions.region('europe-west2').runWith({
  timeoutSeconds: 180,
  secrets: FUNCTION_SECRET_BINDINGS.refreshGarminAPIRefreshTokens,
}).pubsub.schedule('every 12 hours').onRun(async () => {
    // We target 30 days ago to ensure tokens are kept fresh.
    const thirtyDaysAgo = getDaysAgoTimestamp(GARMIN_TOKEN_REFRESH_THRESHOLD_DAYS);
    await tokens.refreshStaleTokens(ServiceNames.GarminAPI, thirtyDaysAgo);
});
