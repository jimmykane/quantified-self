import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('firebase-admin');

describe('Firebase Admin custom-token signing', () => {
  let temporaryDirectory: string | undefined;
  let admin: typeof import('firebase-admin');

  beforeEach(async () => {
    vi.resetModules();
    admin = await import('firebase-admin');
    vi.stubEnv('GCLOUD_PROJECT', 'test-project');
  });

  afterEach(async () => {
    await Promise.all(admin.apps.map(app => app!.delete()));
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it.each(['explicit', 'repository', 'cli-user-adc'])(
    'signs impersonation and restoration tokens locally with %s credentials', async source => {
      const { createFirebaseCustomToken, initializeFirebase } = await import('./bootstrap');
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      temporaryDirectory = mkdtempSync(resolve(tmpdir(), 'qs-local-signing-'));
      const credentialPath = resolve(temporaryDirectory, 'quantified-self-io-firebase-adminsdk.json');
      writeFileSync(credentialPath, JSON.stringify({
        type: 'service_account',
        project_id: 'test-project',
        client_email: 'synthetic-signer@test-project.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      }), { mode: 0o600 });
      vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
      vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', source === 'explicit' ? credentialPath : '');
      if (source === 'cli-user-adc') {
        const userAdcPath = resolve(temporaryDirectory, 'user-adc.json');
        writeFileSync(userAdcPath, JSON.stringify({ type: 'authorized_user' }));
        vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', userAdcPath);
      }
      vi.spyOn(process, 'cwd').mockReturnValue(resolve(temporaryDirectory, 'functions'));

      initializeFirebase();

      // Hosted API access keeps ADC; only token signing uses the local key.
      const defaultCredential = admin.app().options.credential;
      expect(defaultCredential).not.toHaveProperty('privateKey');
      expect(admin.firestore().projectId).toBe('test-project');
      const accessToken = vi.spyOn(admin.app().options.credential!, 'getAccessToken')
        .mockRejectedValue(new Error('Token signing must not use the network'));

      for (const [uid, claims] of [
        ['synthetic-target', { impersonatedBy: 'synthetic-admin' }],
        ['synthetic-admin', undefined],
      ] as const) {
        const token = await createFirebaseCustomToken(uid, claims);
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
      expect(admin.app().options.credential).toBe(defaultCredential);
    },
  );
});
