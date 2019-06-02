'use strict';

// Firebase Setup
import * as admin from "firebase-admin";

const serviceAccount = require('./service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
});

export * from "./st-workout-download-as-fit"
export * from "./auth"
export * from "./service-tokens"
export * from "./insert-to-queue"
export * from "./parse-queue"
export * from "./history-to-queue"
export * from "./migrations"

