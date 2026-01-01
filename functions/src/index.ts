'use strict';

// Firebase Setup
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

let storageBucket = 'quantified-self-io';
if (process.env.FIREBASE_CONFIG) {
  try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    if (firebaseConfig.storageBucket) {
      storageBucket = firebaseConfig.storageBucket;
    }
  } catch (e) {
    logger.warn('Could not parse FIREBASE_CONFIG, using default bucket');
  }
}

if (admin.apps.length === 0) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const serviceAccount = require('../service-account.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
      storageBucket: storageBucket,
    });
  } catch (e) {
    logger.warn('Service account not found, initializing with default credentials');
    admin.initializeApp({
      databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
      storageBucket: 'quantified-self-io',
    });
  }
}

// Configure Firestore to ignore undefined properties when writing documents.
// This handles activity/event data that may have undefined fields
// (e.g., TCX files may have undefined creator.manufacturer).
// Undefined fields are silently skipped, not stored.
// Note: The frontend (Angular app) also has this setting enabled in app.module.ts.
try {
  admin.firestore().settings({ ignoreUndefinedProperties: true });
} catch (e) {
  logger.warn('Firestore settings already set or could not be set:', e);
}

// Coros Auth
export {
  getCOROSAPIAuthRequestTokenRedirectURI,
  requestAndSetCOROSAPIAccessToken,
  deauthorizeCOROSAPI,
} from './coros/auth/wrapper';

// Suunto Auth
export {
  getSuuntoAPIAuthRequestTokenRedirectURI,
  requestAndSetSuuntoAPIAccessToken,
  deauthorizeSuuntoApp,
} from './suunto/auth/wrapper';

// Garmin Auth
export {
  deauthorizeGarminHealthAPI,
  deauthorizeGarminHealthAPIUsers,
  getGarminHealthAPIAuthRequestTokenRedirectURI,
  requestAndSetGarminHealthAPIAccessToken,
} from './garmin/auth/wrapper';

// Coros Queue & History
export {
  addCOROSAPIHistoryToQueue,
} from './coros/history-to-queue';

export {
  insertCOROSAPIWorkoutDataToQueue,
} from './coros/queue';

export {
  parseCOROSAPIHistoryImportWorkoutQueue,
  parseCOROSAPIWorkoutQueue,
} from './queue';


// Suunto Queue & History
export {
  addSuuntoAppHistoryToQueue,
} from './suunto/history-to-queue';

export {
  insertSuuntoAppActivityToQueue,
} from './suunto/queue';

export {
  parseSuuntoAppActivityQueue,
  parseSuuntoAppHistoryImportActivityQueue,
} from './queue';


// Garmin Queue & Backfill
export {
  insertGarminHealthAPIActivityFileToQueue,
} from './garmin/queue';

export {
  parseGarminHealthAPIActivityQueue,
} from './queue';


export {
  backfillHealthAPIActivities,
} from './garmin/backfill';

// Tokens
export { refreshCOROSAPIRefreshTokens } from './coros/tokens';
export { refreshSuuntoAppRefreshTokens } from './suunto/tokens';

// Suunto Utils
export { stWorkoutDownloadAsFit } from './suunto/st-workout-download-as-fit';
export { importActivityToSuuntoApp } from './suunto/activities';
export { importRouteToSuuntoApp } from './suunto/routes';
export { getSuuntoFITFile } from './suunto/get-suunto-fit-file';

// Events
export { cleanupEventFile } from './events/cleanup';
export { restoreUserClaims } from './stripe/claims';
export { onSubscriptionUpdated } from './stripe/subscriptions';
export { enforceSubscriptionLimits } from './schedule/enforce-subscription-limits';
export { checkSubscriptionNotifications } from './schedule/notifications';
export { cleanupUserAccounts } from './users/cleanup';
export { deleteSelf } from './user/user';
export { listUsers, getQueueStats, getUserCount, setMaintenanceMode, getMaintenanceStatus } from './users/admin';

// Tasks
export { processWorkoutTask } from './tasks/workout-processor';

// Stripe Cleanup
export { cleanupStripeCustomer } from './stripe/cleanup';

