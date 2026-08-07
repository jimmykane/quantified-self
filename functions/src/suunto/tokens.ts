//
import * as functions from 'firebase-functions/v1';
import * as tokens from '../tokens';
import { SERVICE_NAME } from './constants';

import { SUUNTO_TOKEN_REFRESH_THRESHOLD_DAYS } from './constants';
import { getDaysAgoTimestamp } from '../shared/date-utils';
import { FUNCTION_SECRET_BINDINGS } from '../secrets';

export const refreshSuuntoAppRefreshTokens = functions.region('europe-west2').runWith({
  timeoutSeconds: 180,
  secrets: FUNCTION_SECRET_BINDINGS.refreshSuuntoAppRefreshTokens,
}).pubsub.schedule('every 12 hours').onRun(async () => {
  // Suunto app refresh tokens should be refreshed every 180days we target at half days before 90 days
  const ninetyDaysAgo = getDaysAgoTimestamp(SUUNTO_TOKEN_REFRESH_THRESHOLD_DAYS);
  await tokens.refreshStaleTokens(SERVICE_NAME, ninetyDaysAgo);
}
);
