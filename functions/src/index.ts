'use strict';

// Firebase Setup
import * as admin from 'firebase-admin';

let storageBucket = 'quantified-self-io';
if (process.env.FIREBASE_CONFIG) {
  try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    if (firebaseConfig.storageBucket) {
      storageBucket = firebaseConfig.storageBucket;
    }
  } catch (e) {
    console.warn('Could not parse FIREBASE_CONFIG, using default bucket');
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
    console.warn('Service account not found, initializing with default credentials');
    admin.initializeApp({
      databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
      storageBucket: 'quantified-self-io',
    });
  }
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
  getGarminHealthAPIAuthRequestTokenRedirectURI,
  requestAndSetGarminHealthAPIAccessToken,
} from './garmin/auth/wrapper';

// Coros Queue & History
export {
  addCOROSAPIHistoryToQueue,
} from './coros/history-to-queue';

export {
  insertCOROSAPIWorkoutDataToQueue,
  parseCOROSAPIHistoryImportWorkoutQueue,
  parseCOROSAPIWorkoutQueue,
} from './coros/queue';

// Suunto Queue & History
export {
  addSuuntoAppHistoryToQueue,
} from './suunto/history-to-queue';

export {
  insertSuuntoAppActivityToQueue,
  parseSuuntoAppActivityQueue,
  parseSuuntoAppHistoryImportActivityQueue,
} from './suunto/queue';

// Garmin Queue & Backfill
export {
  insertGarminHealthAPIActivityFileToQueue,
  parseGarminHealthAPIActivityQueue,
} from './garmin/queue';

export {
  backfillHealthAPIActivities,
} from './garmin/backfill';

// Tokens
export { refreshCOROSAPIRefreshTokens } from './coros/tokens';
export { refreshSuuntoAppRefreshTokens } from './suunto/tokens';

// Suunto Utils
export { stWorkoutDownloadAsFit } from './suunto/st-workout-download-as-fit';
export { importActivityToSuuntoApp } from './suunto/activities';

// Events
export { cleanupEventFile } from './events/cleanup';

// Missing / Deleted Functions (Not Exported)
// - addCookieAndRedirect
// - getSuuntoAPIAuthCode

