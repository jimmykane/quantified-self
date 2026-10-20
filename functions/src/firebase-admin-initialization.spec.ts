import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import * as admin from 'firebase-admin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeFirebase } from './bootstrap';

vi.unmock('firebase-admin');

describe('Firebase Admin custom-token signing', () => {
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    await Promise.all(admin.apps.map(app => app!.delete()));
    vi.unstubAllEnvs();
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('signs hosted-Auth impersonation and restoration tokens locally with a service-account key', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'qs-local-signing-'));
    const credentialPath = resolve(temporaryDirectory, 'credentials.json');
    writeFileSync(credentialPath, JSON.stringify({
      type: 'service_account',
      project_id: 'test-project',
      client_email: 'synthetic-signer@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }), { mode: 0o600 });
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', credentialPath);

    initializeFirebase();

    // Any metadata or IAM request would require this access-token method.
    const accessToken = vi.spyOn(admin.app().options.credential!, 'getAccessToken')
      .mockRejectedValue(new Error('Token signing must not use the network'));

    for (const [uid, claims] of [
      ['synthetic-target', { impersonatedBy: 'synthetic-admin' }],
      ['synthetic-admin', undefined],
    ] as const) {
      const token = await admin.auth().createCustomToken(uid, claims);
      const [header, payload, signature] = token.split('.');

      expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'RS256' });
      expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({
        uid,
        iss: 'synthetic-signer@test-project.iam.gserviceaccount.com',
        ...(claims ? { claims } : {}),
      });
      expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey,
        Buffer.from(signature, 'base64url'))).toBe(true);
    }
    expect(accessToken).not.toHaveBeenCalled();
  });
});
