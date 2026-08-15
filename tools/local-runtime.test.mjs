import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertNoLocalSecrets,
  buildEmulatorArguments,
  createIsolatedLocalProcessEnvironment,
  LOCAL_SECRET_SENTINEL,
  parseEnvAssignments,
  validateRuntimeConfiguration,
} from './local-runtime.mjs';

const runtimeConfig = {
  projectId: 'demo-quantified-self-local',
  host: '127.0.0.1',
  ports: { app: 4200, auth: 9099, functions: 5001, firestore: 8081, storage: 9199, tasks: 9499, ui: 4000, hub: 4400 },
};

function firebaseConfig() {
  return {
    functions: { source: 'functions' },
    firestore: { rules: 'firestore.rules' },
    storage: { rules: 'storage.rules' },
    emulators: {
      singleProjectMode: true,
      auth: { host: '127.0.0.1', port: 9099 },
      functions: { host: '127.0.0.1', port: 5001 },
      firestore: { host: '127.0.0.1', port: 8081 },
      storage: { host: '127.0.0.1', port: 9199 },
      tasks: { host: '127.0.0.1', port: 9499 },
      ui: { host: '127.0.0.1', port: 4000 },
      hub: { host: '127.0.0.1', port: 4400 },
    },
  };
}

test('accepts a matching demo-project configuration', () => {
  assert.doesNotThrow(() => validateRuntimeConfiguration(runtimeConfig, firebaseConfig()));
});

test('rejects real projects, extensions, and endpoint drift', () => {
  assert.throws(() => validateRuntimeConfiguration({ ...runtimeConfig, projectId: 'quantified-self-io' }, firebaseConfig()), /demo-/u);
  assert.throws(() => validateRuntimeConfiguration(runtimeConfig, { ...firebaseConfig(), extensions: {} }), /extensions/u);
  const drifted = firebaseConfig();
  drifted.emulators.firestore.port = 8080;
  assert.throws(() => validateRuntimeConfiguration(runtimeConfig, drifted), /firestore/u);
});

test('parses dotenv assignments without treating quoted empties as secrets', () => {
  assert.deepEqual(
    [...parseEnvAssignments("A=\nB=''\nC=\"value\"\n# ignored\n").entries()],
    [['A', ''], ['B', ''], ['C', 'value']],
  );
});

test('refuses configured and inherited secrets without exposing their values', () => {
  const secret = 'STRIPE_SECRET_KEY=sk_do_not_print\nGEMINI_API_KEY=\n';
  assert.throws(
    () => assertNoLocalSecrets(secret, { GEMINI_API_KEY: 'another-secret' }),
    error => error.message.includes('STRIPE_SECRET_KEY')
      && error.message.includes('GEMINI_API_KEY')
      && !error.message.includes('sk_do_not_print')
      && !error.message.includes('another-secret'),
  );
});

test('accepts only the explicit non-secret emulator sentinel', () => {
  assert.doesNotThrow(() => assertNoLocalSecrets(
    `STRIPE_SECRET_KEY=${LOCAL_SECRET_SENTINEL}\n`,
    {},
  ));
});

test('masks inherited cloud credentials in child processes', async () => {
  const isolation = await createIsolatedLocalProcessEnvironment({
    GOOGLE_APPLICATION_CREDENTIALS: '/private/production.json',
    GCLOUD_PROJECT: 'production-project',
  });
  try {
    assert.notEqual(isolation.environment.GOOGLE_APPLICATION_CREDENTIALS, '/private/production.json');
    assert.match(isolation.environment.GOOGLE_APPLICATION_CREDENTIALS, /intentionally-missing-adc\.json$/u);
    assert.equal(isolation.environment.GCLOUD_PROJECT, undefined);
    assert.equal(isolation.environment.GOOGLE_CLOUD_PROJECT, undefined);
    assert.equal(isolation.environment.NO_GCE_CHECK, 'true');
  } finally {
    await isolation.cleanup();
  }
});

test('builds explicit local-only Firebase CLI arguments', () => {
  assert.deepEqual(buildEmulatorArguments(runtimeConfig, false), [
    'emulators:start',
    '--config', 'firebase.local.json',
    '--project', 'demo-quantified-self-local',
    '--only', 'auth,functions,firestore,storage,tasks',
    '--export-on-exit', '.local/firebase-emulator-data',
  ]);
  assert.ok(buildEmulatorArguments(runtimeConfig, true).includes('--import'));
});
