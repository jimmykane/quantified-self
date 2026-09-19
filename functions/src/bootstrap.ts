import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

// Firebase still advertises the legacy `.appspot.com` default in
// FIREBASE_CONFIG. Storage writes intentionally use the migrated EU bucket.
const PRIMARY_STORAGE_BUCKET = 'quantified-self-io';
let initialized = false;

export function initializeFirebase(): void {
  if (initialized) return;

  if (admin.apps.length === 0) {
    admin.initializeApp({
      databaseURL: `https://${process.env.GCLOUD_PROJECT}.firebaseio.com`,
      storageBucket: PRIMARY_STORAGE_BUCKET,
    });
  }

  // Configure Firestore to ignore undefined properties when writing documents.
  // This handles activity/event data that may have undefined fields
  // (e.g., TCX files may have undefined creator.manufacturer).
  // Undefined fields are silently skipped, not stored.
  // Note: The frontend (Angular app) also has this setting enabled in app.module.ts.
  try {
    admin.firestore().settings({ ignoreUndefinedProperties: true });
  } catch (error) {
    logger.warn('Firestore settings already set or could not be set:', error);
  }

  initialized = true;
}
