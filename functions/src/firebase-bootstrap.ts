import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { resolveServiceAccountPath } from './firebase-admin-config';

const PRIMARY_STORAGE_BUCKET = 'quantified-self-io';
let firebaseConfigStorageBucket: string | null = null;
let firebaseConfigProjectId: string | null = null;

if (process.env.FIREBASE_CONFIG) {
  try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    if (firebaseConfig.storageBucket) {
      firebaseConfigStorageBucket = `${firebaseConfig.storageBucket}`;
    }
    if (firebaseConfig.projectId) {
      firebaseConfigProjectId = `${firebaseConfig.projectId}`;
    }
  } catch (e) {
    logger.warn('Could not parse FIREBASE_CONFIG while resolving Firebase configuration');
  }
}

if (firebaseConfigStorageBucket && firebaseConfigStorageBucket !== PRIMARY_STORAGE_BUCKET) {
  logger.warn('Ignoring FIREBASE_CONFIG.storageBucket to keep storage writes on primary bucket', {
    firebaseConfigStorageBucket,
    primaryStorageBucket: PRIMARY_STORAGE_BUCKET,
  });
}

try {
  admin.app();
} catch (e) {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || firebaseConfigProjectId || undefined;
  try {
    const serviceAccountPath = resolveServiceAccountPath();
    if (serviceAccountPath) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
        databaseURL: `https://${projectId}.firebaseio.com`,
        storageBucket: PRIMARY_STORAGE_BUCKET,
      });
    } else {
      throw new Error('service-account.json not found');
    }
  } catch (error) {
    logger.warn('Service account not found, initializing with default credentials');
    admin.initializeApp({
      projectId,
      databaseURL: `https://${projectId}.firebaseio.com`,
      storageBucket: PRIMARY_STORAGE_BUCKET,
    });
  }
}

// Configure Firestore to ignore undefined properties when writing documents.
try {
  admin.firestore().settings({ ignoreUndefinedProperties: true });
} catch (e) {
  logger.warn('Firestore settings already set or could not be set:', e);
}
