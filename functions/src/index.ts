'use strict';

// Firebase Setup
import * as admin from "firebase-admin";

const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
});

export * from "./suunto/st-workout-download-as-fit"
export * from "./suunto/auth/wrapper"
export * from "./garmin/auth/wrapper"
export * from "./service-tokens"
export * from "./suunto/insert-to-queue"
export * from "./suunto/parse-queue"
export * from "./suunto/history-to-queue"
export * from "./routes"
export * from "./suunto/get-suunto-fit-file"
export * from "./garmin/queue"
// export * from "./migrations"

export { determineRedirectURI } from './utils';
export { isCorsAllowed } from './utils';
export { setAccessControlHeadersOnResponse } from './utils';
export { setEvent } from './utils';
export { updateToProcessed } from './queue';
export { increaseRetryCountForQueueItem } from './queue';
export { MEMORY } from './queue';
export { TIMEOUT_IN_SECONDS } from './queue';
