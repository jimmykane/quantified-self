import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { angularArguments } from './local-angular.mjs';
import { assertExternalPath } from './local-functions.mjs';
import { readLocalEnvironment } from './stripe-billing/local.mjs';
import paths from '../shared/local-secret-paths.js';

test('external-path checks cannot be bypassed by a sibling prefix or symlink back into a checkout', t => {
  const base = mkdtempSync(join(tmpdir(), 'qs-secret-paths-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'checkout'); mkdirSync(root);
  mkdirSync(join(root, '..private'));
  const link = join(base, 'alias'); symlinkSync(root, link, 'dir');
  assert.throws(() => assertExternalPath(join(root, '..private/key.json'), root), /outside/);
  assert.throws(() => assertExternalPath(join(link, 'key.json'), root), /outside/);
});

test('local Angular loads external TLS files while plain HTTP never requires credentials', t => {
  assert.deepEqual(angularArguments(['--help'], { QS_LOCAL_CONFIG_DIR: '/missing' }), ['serve', '--help']);
  assert.deepEqual(angularArguments(['--ssl=false'], { QS_LOCAL_CONFIG_DIR: '/missing' }), ['serve', '--ssl=false']);
  const base = mkdtempSync(join(tmpdir(), 'qs-local-tls-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, 'tls'));
  writeFileSync(join(base, 'tls/localhost.key'), 'synthetic-key');
  writeFileSync(join(base, 'tls/localhost.crt'), 'synthetic-cert');
  const args = angularArguments(['--port', '4200'], { QS_LOCAL_CONFIG_DIR: base });
  assert.ok(args.includes(join(base, 'tls/localhost.key')));
  assert.ok(args.includes(join(base, 'tls/localhost.crt')));
  assert.throws(() => angularArguments([], { QS_LOCAL_CONFIG_DIR: '/missing' }), /unavailable/);
});

test('billing reads only the selected external test profile and keeps its inert ADC outside the checkout', t => {
  const base = mkdtempSync(join(tmpdir(), 'qs-local-billing-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(join(base, 'billing-test.env'), 'STRIPE_BILLING_KEY=sk_test_synthetic\nSTRIPE_BILLING_WEBHOOK_SECRET=whsec_synthetic\n');
  const environment = readLocalEnvironment({ QS_LOCAL_CONFIG_DIR: base, PATH: process.env.PATH });
  assert.equal(environment.STRIPE_BILLING_KEY, 'sk_test_synthetic');
  assert.equal(environment.STRIPE_ADMIN_BILLING_KEY, 'sk_test_synthetic');
  assertExternalPath(environment.GOOGLE_APPLICATION_CREDENTIALS);
  assert.equal(JSON.parse(readFileSync(environment.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')).type, 'authorized_user');
  assert.throws(() => readLocalEnvironment({ QS_LOCAL_CONFIG_DIR: '/missing' }));
});

test('mail signing uses the external identity without switching away from a missing explicit identity', t => {
  const base = mkdtempSync(join(tmpdir(), 'qs-local-mail-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(join(base, 'firebase-adminsdk.json'), 'synthetic');
  assert.equal(paths.localMailCredentialPath({ QS_LOCAL_CONFIG_DIR: base }), join(base, 'firebase-adminsdk.json'));
  writeFileSync(join(base, 'mail-service-account.json'), 'synthetic-mail');
  assert.equal(paths.localMailCredentialPath({ QS_LOCAL_CONFIG_DIR: base }), join(base, 'mail-service-account.json'));
  assert.throws(() => paths.localMailCredentialPath({ QS_LOCAL_CONFIG_DIR: base, GOOGLE_APPLICATION_CREDENTIALS: join(base, 'missing.json') }), /No external/);
});
