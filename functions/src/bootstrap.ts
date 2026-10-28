import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as admin from 'firebase-admin';
import { initializeApp as initializeSignerApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import * as logger from 'firebase-functions/logger';

// Firebase still advertises the legacy `.appspot.com` default in
// FIREBASE_CONFIG. Storage writes intentionally use the migrated EU bucket.
const PRIMARY_STORAGE_BUCKET = 'quantified-self-io';
const EMULATOR_SIGNER_APP = 'emulator-hosted-auth-signer';
let initialized = false;

function readLocalCredential(credentialPath: string): Record<string, unknown> {
  try {
    const credential: unknown = JSON.parse(readFileSync(credentialPath, 'utf8'));
    if (credential && typeof credential === 'object' && !Array.isArray(credential)) {
      return credential as Record<string, unknown>;
    }
  } catch {
    // Never include parser errors or credential contents in logs or responses.
  }
  throw new Error('Unable to read local Firebase signing credentials. Provide valid service-account JSON outside functions/.');
}

function emulatorHostedAuthSigner(): App | undefined {
  if (process.env.FUNCTIONS_EMULATOR !== 'true' || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    return undefined;
  }

  const existingSigner = admin.apps.find(app => app?.name === EMULATOR_SIGNER_APP);
  if (existingSigner) return existingSigner;

  // Only token signing uses this key. The default app retains ADC for Auth
  // lookups, Firestore, Storage, and every other backend operation.
  const configuredPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  // The Functions emulator runs with functions/ as its working directory.
  const repositoryKeyPath = resolve('../quantified-self-io-firebase-adminsdk.json');
  let credentialPath = configuredPath ? resolve(configuredPath) : repositoryKeyPath;
  if (!existsSync(credentialPath)) {
    if (configuredPath) throw new Error('The configured GOOGLE_APPLICATION_CREDENTIALS file is unavailable.');
    return undefined;
  }

  let credential = readLocalCredential(credentialPath);
  if (configuredPath && credential.type === 'authorized_user') {
    // Firebase CLI can inject its user ADC here. Keep that identity on the
    // default app while using the optional repository key solely for signing.
    credentialPath = repositoryKeyPath;
    if (!existsSync(credentialPath)) return undefined;
    credential = readLocalCredential(credentialPath);
  }
  // Impersonated and external-account ADC keep their normal SDK signer.
  if (credential.type !== 'service_account') return undefined;

  const projectId = admin.app().options.projectId;
  if (!projectId || credential.project_id !== projectId) {
    throw new Error('Local Firebase signing credentials must match the Functions emulator project.');
  }

  // Firebase CLI serializes options passed to the namespaced initializer,
  // including private keys. The modular initializer avoids that logging shim.
  return initializeSignerApp({
    projectId,
    credential: admin.credential.cert(credential),
  }, EMULATOR_SIGNER_APP);
}

export function createFirebaseCustomToken(uid: string, claims?: object): Promise<string> {
  const signer = emulatorHostedAuthSigner();
  const auth = signer ? getAuth(signer) : admin.auth();
  return claims === undefined ? auth.createCustomToken(uid) : auth.createCustomToken(uid, claims);
}

export function initializeFirebase(): void {
  if (initialized) return;

  if (admin.apps.length === 0) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT,
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
