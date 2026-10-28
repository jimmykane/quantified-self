import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localEnvironment } from './local.mjs';
const keys = { STRIPE_BILLING_KEY: 'sk_test_synthetic', STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_synthetic' };
test('local launcher rejects live/missing keys and scrubs cloud credentials and project overrides', () => {
  for (const key of ['sk_live_synthetic', 'rk_live_synthetic', '', undefined]) assert.throws(() => localEnvironment({ ...keys, STRIPE_BILLING_KEY: key }));
  const env = localEnvironment(keys, { HOME: '/tmp', PATH: '/bin', GOOGLE_APPLICATION_CREDENTIALS: '/private', GCLOUD_PROJECT: 'production', STRIPE_SECRET_KEY: 'sk_live_private' });
  assert.equal(env.GCLOUD_PROJECT, 'demo-stripe-billing'); assert.match(env.GOOGLE_APPLICATION_CREDENTIALS, /no-cloud-credentials[.]json$/);
  assert.notEqual(env.GOOGLE_APPLICATION_CREDENTIALS, '/private');
  assert.equal(env.STRIPE_SECRET_KEY, keys.STRIPE_BILLING_KEY);
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'QS_BILLING_FUNCTIONS_HOST']) assert.match(env[key], /^127\.0\.0\.1:/);
});
test('billing frontend configuration carries no live Firebase, analytics or map credentials', () => {
  const source = readFileSync(new URL('../../src/environments/environment.billing-test.ts', import.meta.url), 'utf8');
  assert.match(source, /demo-stripe-billing/); assert.match(source, /useAuthEmulator: true/); assert.match(source, /useFunctionsEmulator: true/);
  assert.doesNotMatch(source, /AIza|pk\.ey|quantified-self-io|mapbox-token/);
  const angular = JSON.parse(readFileSync(new URL('../../angular.json', import.meta.url), 'utf8'));
  const serve = angular.projects['track-tools'].architect.serve.configurations['billing-test'];
  assert.equal(serve.ssl, false);
  assert.equal(serve.buildTarget, 'track-tools:build:billing-test');
});
