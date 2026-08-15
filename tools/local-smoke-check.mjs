import process from 'node:process';
import {
  initializeApp as initializeClientApp,
  deleteApp as deleteClientApp,
} from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import {
  connectStorageEmulator,
  getBytes,
  getStorage,
  ref,
} from 'firebase/storage';
import {
  deleteApp as deleteAdminApp,
  initializeApp as initializeAdminApp,
} from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { readLocalRuntimeConfiguration } from './local-runtime.mjs';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[local-smoke] ${message}`);
  }
}

async function main() {
  const { runtimeConfig } = await readLocalRuntimeConfiguration();
  const { host, ports, projectId } = runtimeConfig;

  process.env.GCLOUD_PROJECT = projectId;
  process.env.GOOGLE_CLOUD_PROJECT = projectId;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${host}:${ports.auth}`;
  process.env.FIRESTORE_EMULATOR_HOST = `${host}:${ports.firestore}`;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = `${host}:${ports.storage}`;

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clientApp = initializeClientApp({
    apiKey: 'demo-local-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: `${projectId}.appspot.com`,
    appId: `local-smoke-${suffix}`,
  }, `local-smoke-client-${suffix}`);
  const adminApp = initializeAdminApp({
    projectId,
    storageBucket: `${projectId}.appspot.com`,
  }, `local-smoke-admin-${suffix}`);

  const auth = getAuth(clientApp);
  const firestore = getFirestore(clientApp);
  const storage = getStorage(clientApp);
  const functions = getFunctions(clientApp, 'europe-west2');
  connectAuthEmulator(auth, `http://${host}:${ports.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, host, ports.firestore);
  connectStorageEmulator(storage, host, ports.storage);
  connectFunctionsEmulator(functions, host, ports.functions);

  let clientUser;
  let storageFile;
  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      `local-smoke-${suffix}@example.test`,
      `Local-smoke-${suffix}!`,
    );
    clientUser = credential.user;
    console.info('[local-smoke] Auth emulator check passed.');

    const adminFirestore = getAdminFirestore(adminApp);
    await adminFirestore.doc(`users/${clientUser.uid}`).set({
      onboardingCompleted: true,
      localSmoke: true,
    });
    await adminFirestore.doc(`users/${clientUser.uid}/legal/agreements`).set({
      acceptedPrivacyPolicy: true,
      acceptedDataPolicy: true,
      acceptedTos: true,
    });

    const clientUserSnapshot = await getDoc(doc(firestore, `users/${clientUser.uid}`));
    assert(clientUserSnapshot.exists(), 'Authenticated Firestore read failed.');
    console.info('[local-smoke] Firestore emulator check passed.');

    const storagePath = `users/${clientUser.uid}/local-smoke/probe.txt`;
    storageFile = getAdminStorage(adminApp).bucket().file(storagePath);
    await storageFile.save(Buffer.from('local-storage-ok', 'utf8'), { contentType: 'text/plain' });
    const storageBytes = await getBytes(ref(storage, storagePath));
    assert(Buffer.from(storageBytes).toString('utf8') === 'local-storage-ok', 'Authenticated Storage read failed.');
    console.info('[local-smoke] Storage emulator check passed.');

    const quotaResult = await httpsCallable(functions, 'getAssistantQuotaStatus')();
    assert(quotaResult?.data && typeof quotaResult.data === 'object', 'Callable Functions check returned no data.');
    console.info('[local-smoke] Callable Functions check passed.');

    const idToken = await clientUser.getIdToken();
    const uploadResponse = await fetch(
      `http://${host}:${ports.functions}/${projectId}/europe-west2/uploadActivity`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/octet-stream',
          Origin: `http://${host}:${ports.app}`,
        },
        body: Buffer.from([0]),
      },
    );
    assert(uploadResponse.status === 400, `Expected authenticated upload validation to return HTTP 400, received ${uploadResponse.status}.`);

    console.info('[local-smoke] Auth, Firestore, Storage, callable Functions, and local HTTP upload checks passed.');
    console.info('[local-smoke] The HTTP upload succeeded without an App Check token only inside the Functions emulator.');
  } finally {
    if (storageFile) {
      await storageFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    }
    // emulators:exec tears down this ephemeral project. Avoid firing account
    // cleanup integrations merely to remove data that is about to disappear.
    await Promise.all([
      deleteClientApp(clientApp),
      deleteAdminApp(adminApp),
    ]);
  }
}

main().catch(error => {
  const code = error && typeof error === 'object' && 'code' in error ? ` (${error.code})` : '';
  console.error(error instanceof Error ? `${error.message}${code}` : error);
  process.exitCode = 1;
});
