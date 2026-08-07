import * as functions from 'firebase-functions/v1';
import * as tokens from '../tokens';
import { SERVICE_NAME } from './constants';

import { COROS_TOKEN_REFRESH_THRESHOLD_DAYS } from './constants';
import { getDaysAgoTimestamp } from '../shared/date-utils';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

export const refreshCOROSAPIRefreshTokens = functions.region('europe-west2').runWith({
  timeoutSeconds: 180,
  secrets: FUNCTION_SECRET_BINDINGS.refreshCOROSAPIRefreshTokens,
}).pubsub.schedule('every 12 hours').onRun(async () => {
  const twentyDaysAgo = getDaysAgoTimestamp(COROS_TOKEN_REFRESH_THRESHOLD_DAYS);
  await tokens.refreshStaleTokens(SERVICE_NAME, twentyDaysAgo);
});
