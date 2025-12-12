'use strict';

// Firebase Setup
import * as admin from 'firebase-admin';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const serviceAccount = require('../service-account.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    let storageBucket = 'quantified-self-io';
    if(process.env.FIREBASE_CONFIG) {
    try {
      const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
      if (firebaseConfig.storageBucket) {
        storageBucket = firebaseConfig.storageBucket;
      }
    } catch (e) {
      console.warn('Could not parse FIREBASE_CONFIG, using default bucket');
    }
  }

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

export * from './suunto/st-workout-download-as-fit';
export * from './suunto/auth/wrapper';
export * from './garmin/auth/wrapper';
export * from './coros/auth/wrapper';
export * from './tokens';
// export * from "./delete-old-user-tokens"
export * from './suunto/queue';
export * from './suunto/history-to-queue';
export * from './suunto/routes';
export * from './suunto/activities';
export * from './suunto/get-suunto-fit-file';
export * from './garmin/queue';
export * from './garmin/backfill';
export * from './coros/history-to-queue';
export * from './coros/queue';
// export * from "./re-queue"
// export * from "./migrations"


// @todo perhaps this is not a good place to add these
export { determineRedirectURI } from './utils';
export { isCorsAllowed } from './utils';
export { setAccessControlHeadersOnResponse } from './utils';
export { setEvent } from './utils';
export { updateToProcessed } from './queue';
export { increaseRetryCountForQueueItem } from './queue';
export { refreshSuuntoAppRefreshTokens } from './suunto/tokens';
export { refreshCOROSAPIRefreshTokens } from './coros/tokens';
export { testEventUpload } from './test-upload';

