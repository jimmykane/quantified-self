import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

// Firebase still advertises the legacy `.appspot.com` default in
// FIREBASE_CONFIG. Storage writes intentionally use the migrated EU bucket.
const PRIMARY_STORAGE_BUCKET = 'quantified-self-io';
let initialized = false;

function emulatorHostedAuthCredential(): admin.credential.Credential | undefined {
  if (process.env.FUNCTIONS_EMULATOR !== 'true' || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    return undefined;
  }

  // Hosted Auth needs signed custom tokens. Keep the optional local key outside
  // the Functions upload source; deployed runtimes and Auth emulation use ADC.
  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  // The Functions emulator runs with functions/ as its working directory.
  const credentialPath = resolve(configuredPath || '../quantified-self-io-firebase-adminsdk.json');
  if (!existsSync(credentialPath)) return undefined;

  let credentialType: unknown;
  try {
    credentialType = JSON.parse(readFileSync(credentialPath, 'utf8'))?.type;
  } catch {
    throw new Error('Unable to read local Firebase signing credentials. Provide valid service-account JSON outside functions/.');
  }

  // User ADC and impersonated credentials must retain their normal SDK handling.
  return credentialType === 'service_account' ? admin.credential.cert(credentialPath) : undefined;
}

export function initializeFirebase(): void {
  if (initialized) return;

  if (admin.apps.length === 0) {
    const credential = emulatorHostedAuthCredential();
    admin.initializeApp({
      ...(credential ? { credential } : {}),
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
