import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExpectedEmulators, readEmulatorHub, readLocalRuntimeConfiguration } from './local-runtime.mjs';

export function parseRoleArguments(args) {
  let email = '';
  let role = '';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--email') {
      email = args[index + 1]?.trim() ?? '';
      index += 1;
    } else if (args[index] === '--role') {
      role = args[index + 1]?.trim().toLowerCase() ?? '';
      index += 1;
    } else {
      throw new Error(`[local-role] Unknown argument: ${args[index]}`);
    }
  }
  if (!email || !/^\S+@\S+\.\S+$/u.test(email)) {
    throw new Error('[local-role] Pass the fake local account with --email <email>.');
  }
  if (role !== 'free' && role !== 'pro') {
    throw new Error('[local-role] --role must be free or pro.');
  }
  return { email, role };
}

export function buildSyntheticSubscription(Timestamp, now = new Date()) {
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return {
    status: 'active',
    role: 'pro',
    current_period_start: Timestamp.fromDate(now),
    current_period_end: Timestamp.fromDate(periodEnd),
    created: Timestamp.fromDate(now),
    cancel_at_period_end: false,
    localSynthetic: true,
  };
}

async function setBackgroundTriggers(runtimeConfig, enabled) {
  const action = enabled ? 'enableBackgroundTriggers' : 'disableBackgroundTriggers';
  const response = await fetch(`http://${runtimeConfig.host}:${runtimeConfig.ports.hub}/functions/${action}`, {
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(`[local-role] Could not ${enabled ? 'enable' : 'disable'} emulator background triggers.`);
  }
}

export async function updateLocalRole({ email, role }, now = new Date()) {
  const { runtimeConfig } = await readLocalRuntimeConfiguration();
  const registry = await readEmulatorHub(runtimeConfig);
  assertExpectedEmulators(runtimeConfig, registry);

  process.env.GCLOUD_PROJECT = runtimeConfig.projectId;
  process.env.GOOGLE_CLOUD_PROJECT = runtimeConfig.projectId;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `${runtimeConfig.host}:${runtimeConfig.ports.auth}`;
  process.env.FIRESTORE_EMULATOR_HOST = `${runtimeConfig.host}:${runtimeConfig.ports.firestore}`;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = `${runtimeConfig.host}:${runtimeConfig.ports.storage}`;

  const [{ initializeApp, deleteApp }, { getAuth }, { FieldValue, getFirestore, Timestamp }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
    import('firebase-admin/firestore'),
  ]);
  const app = initializeApp({
    projectId: runtimeConfig.projectId,
    storageBucket: `${runtimeConfig.projectId}.appspot.com`,
  }, `local-role-${Date.now()}`);
  let triggersDisabled = false;

  try {
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const user = await auth.getUserByEmail(email);
    const userRef = firestore.doc(`users/${user.uid}`);
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists || userSnapshot.data()?.onboardingCompleted !== true) {
      throw new Error('[local-role] Complete local onboarding before changing the synthetic role.');
    }

    await setBackgroundTriggers(runtimeConfig, false);
    triggersDisabled = true;

    const subscriptionRef = firestore.doc(`customers/${user.uid}/subscriptions/local-pro`);
    const nextClaims = { ...(user.customClaims ?? {}), stripeRole: role };
    delete nextClaims.gracePeriodUntil;

    if (role === 'pro') {
      await subscriptionRef.set(buildSyntheticSubscription(Timestamp, now));
    } else {
      await subscriptionRef.delete().catch(error => {
        if (error?.code !== 5 && error?.code !== 'not-found') {
          throw error;
        }
      });
    }

    await auth.setCustomUserClaims(user.uid, nextClaims);
    await firestore.doc(`users/${user.uid}/system/status`).set({
      claimsUpdatedAt: Timestamp.fromMillis(now.getTime() + 5_000),
      gracePeriodUntil: FieldValue.delete(),
      localSyntheticRole: role,
      localSyntheticRoleUpdatedAt: Timestamp.fromDate(now),
    }, { merge: true });
  } finally {
    if (triggersDisabled) {
      await setBackgroundTriggers(runtimeConfig, true);
    }
    await deleteApp(app);
  }
}

async function main() {
  const options = parseRoleArguments(process.argv.slice(2));
  await updateLocalRole(options);
  console.info(`[local-role] ${options.email} now has the synthetic ${options.role} role. No Stripe object or payment was created.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
