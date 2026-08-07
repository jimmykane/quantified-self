import assert from 'node:assert/strict';
import test from 'node:test';
import { findForbiddenCredentialPaths } from './check-staged-credential-files.mjs';

test('rejects staged credential and local-configuration paths', () => {
  const forbiddenPaths = findForbiddenCredentialPaths([
    '.env',
    'functions/.env.production',
    'functions/.secret.local',
    'nested/.runtimeconfig.json',
    'keys/firebase_service_account.json',
    'certs/localhost.key',
    'src/environments/mapbox-token.local.ts',
  ]);

  assert.deepEqual(forbiddenPaths, [
    '.env',
    'certs/localhost.key',
    'functions/.env.production',
    'functions/.secret.local',
    'keys/firebase_service_account.json',
    'nested/.runtimeconfig.json',
    'src/environments/mapbox-token.local.ts',
  ]);
});

test('allows the documented value-free template and ordinary source files', () => {
  const forbiddenPaths = findForbiddenCredentialPaths([
    'functions/.secret.local.example',
    'functions/src/secrets.ts',
    'README.md',
  ]);

  assert.deepEqual(forbiddenPaths, []);
});
