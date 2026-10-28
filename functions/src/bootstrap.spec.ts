import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apps: [] as unknown[],
  initializeApp: vi.fn(),
  initializeSignerApp: vi.fn(),
  settings: vi.fn(),
  warn: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  cert: vi.fn(),
  defaultToken: vi.fn(),
  signedToken: vi.fn(),
  defaultApp: { name: '[DEFAULT]', options: { projectId: 'test-project' } },
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock('firebase-admin', () => ({
  apps: mocks.apps,
  initializeApp: mocks.initializeApp,
  credential: { cert: mocks.cert },
  app: () => mocks.defaultApp,
  auth: () => ({ createCustomToken: mocks.defaultToken }),
  firestore: Object.assign(
    () => ({ settings: mocks.settings }),
    { FieldValue: {} },
  ),
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: mocks.initializeSignerApp,
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ createCustomToken: mocks.signedToken }),
}));

vi.mock('firebase-functions/logger', () => ({
  warn: mocks.warn,
}));

describe('initializeFirebase', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.apps.length = 0;
    mocks.initializeApp.mockReset().mockImplementation((options, name = '[DEFAULT]') => {
      const app = { name, options };
      mocks.apps.push(app);
      return app;
    });
    mocks.initializeSignerApp.mockReset().mockImplementation((options, name) => {
      const app = { name, options };
      mocks.apps.push(app);
      return app;
    });
    mocks.settings.mockReset();
    mocks.warn.mockReset();
    mocks.existsSync.mockReset().mockReturnValue(false);
    mocks.readFileSync.mockReset().mockReturnValue('{"type":"service_account","project_id":"test-project"}');
    mocks.cert.mockReset().mockReturnValue({ localSigner: true });
    mocks.defaultToken.mockReset().mockResolvedValue('default-token');
    mocks.signedToken.mockReset().mockResolvedValue('signed-token');
    vi.stubEnv('GCLOUD_PROJECT', 'test-project');
    vi.stubEnv('FUNCTIONS_EMULATOR', '');
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '');
    vi.spyOn(process, 'cwd').mockReturnValue('/repo/functions');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('initializes Firebase and Firestore once', async () => {
    const { initializeFirebase } = await import('./bootstrap');

    initializeFirebase();
    initializeFirebase();

    expect(mocks.initializeApp).toHaveBeenCalledOnce();
    expect(mocks.initializeApp).toHaveBeenCalledWith({
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
      storageBucket: 'quantified-self-io',
    });
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.settings).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.cert).not.toHaveBeenCalled();
  });

  it('validates isolated emulator routing before initializing Admin', async () => {
    vi.stubEnv('QS_ISOLATED_LOCAL_RUNTIME', 'true');
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('GCLOUD_PROJECT', 'demo-quantified-self-local');
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-quantified-self-local' }));
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
    vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199');
    vi.stubEnv('CLOUD_TASKS_EMULATOR_HOST', '127.0.0.1:9499');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', 'remote.example.test:8081');
    const { initializeFirebase } = await import('./bootstrap');
    expect(() => initializeFirebase()).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8081');
    initializeFirebase();
    expect(mocks.initializeApp).toHaveBeenCalledWith({
      projectId: 'demo-quantified-self-local',
      databaseURL: 'https://demo-quantified-self-local.firebaseio.com',
      storageBucket: 'demo-quantified-self-local.appspot.com',
    });
  });

  it('uses the ignored repository-root key for Functions emulation with hosted Auth', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    const keyPath = resolve('/repo/quantified-self-io-firebase-adminsdk.json');
    mocks.existsSync.mockImplementation(candidate => candidate === keyPath);
    const { createFirebaseCustomToken } = await import('./bootstrap');

    await expect(createFirebaseCustomToken('target', { impersonatedBy: 'admin' })).resolves.toBe('signed-token');
    await expect(createFirebaseCustomToken('admin')).resolves.toBe('signed-token');

    expect(mocks.readFileSync).toHaveBeenCalledExactlyOnceWith(keyPath, 'utf8');
    expect(mocks.cert).toHaveBeenCalledExactlyOnceWith({ type: 'service_account', project_id: 'test-project' });
    expect(mocks.initializeSignerApp).toHaveBeenCalledExactlyOnceWith({
      projectId: 'test-project',
      credential: { localSigner: true },
    }, 'emulator-hosted-auth-signer');
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.signedToken).toHaveBeenNthCalledWith(1, 'target', { impersonatedBy: 'admin' });
    expect(mocks.signedToken).toHaveBeenNthCalledWith(2, 'admin');
    expect(mocks.defaultToken).not.toHaveBeenCalled();
  });

  it('prefers an explicitly configured service-account key over the repository fallback', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/external/credentials.json');
    mocks.existsSync.mockReturnValue(true);
    const { createFirebaseCustomToken } = await import('./bootstrap');

    await createFirebaseCustomToken('target');

    expect(mocks.existsSync).toHaveBeenCalledExactlyOnceWith('/external/credentials.json');
    expect(mocks.cert).toHaveBeenCalledOnce();
  });

  it.each(['impersonated_service_account', 'external_account'])(
    'preserves SDK handling for explicitly configured %s ADC', async type => {
      vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/external/credentials.json');
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(JSON.stringify({ type }));
      const { createFirebaseCustomToken } = await import('./bootstrap');

      await expect(createFirebaseCustomToken('target')).resolves.toBe('default-token');

      expect(mocks.cert).not.toHaveBeenCalled();
      expect(mocks.initializeApp).not.toHaveBeenCalled();
    },
  );

  it('uses ADC signing when the optional repository key is unavailable', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    const { createFirebaseCustomToken } = await import('./bootstrap');

    await expect(createFirebaseCustomToken('target')).resolves.toBe('default-token');

    expect(mocks.cert).not.toHaveBeenCalled();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it('does not switch identities when an explicit credential path is unavailable', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/external/missing.json');
    const { createFirebaseCustomToken } = await import('./bootstrap');

    expect(() => createFirebaseCustomToken('target')).toThrow('GOOGLE_APPLICATION_CREDENTIALS file is unavailable');

    expect(mocks.existsSync).toHaveBeenCalledExactlyOnceWith('/external/missing.json');
    expect(mocks.cert).not.toHaveBeenCalled();
    expect(mocks.defaultToken).not.toHaveBeenCalled();
  });

  it('uses a separate signer when Firebase CLI injects user ADC', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/firebase/user-credentials.json');
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockImplementation(path => JSON.stringify(path === '/firebase/user-credentials.json'
      ? { type: 'authorized_user' } : { type: 'service_account', project_id: 'test-project' }));
    const { initializeFirebase, createFirebaseCustomToken } = await import('./bootstrap');

    initializeFirebase();
    expect(mocks.readFileSync).not.toHaveBeenCalled();
    await expect(createFirebaseCustomToken('target')).resolves.toBe('signed-token');

    expect(mocks.initializeApp).toHaveBeenNthCalledWith(1, {
      projectId: 'test-project',
      databaseURL: 'https://test-project.firebaseio.com',
      storageBucket: 'quantified-self-io',
    });
    expect(mocks.initializeApp).toHaveBeenCalledOnce();
    expect(mocks.initializeSignerApp).toHaveBeenCalledExactlyOnceWith({
      projectId: 'test-project', credential: { localSigner: true },
    }, 'emulator-hosted-auth-signer');
  });

  it.each(['', '/external/credentials.json'])(
    'rejects keys for another project without altering the default app (%s)', async configuredPath => {
      vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', configuredPath);
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue('{"type":"service_account","project_id":"other-project"}');
      const { initializeFirebase, createFirebaseCustomToken } = await import('./bootstrap');

      initializeFirebase();
      expect(() => createFirebaseCustomToken('target')).toThrow('must match the Functions emulator project');

      expect(mocks.cert).not.toHaveBeenCalled();
      expect(mocks.initializeApp).toHaveBeenCalledOnce();
      expect(mocks.initializeApp.mock.calls[0][0]).not.toHaveProperty('credential');
      expect(mocks.defaultToken).not.toHaveBeenCalled();
    },
  );

  it('never loads a local key in deployed runtimes, even with explicit credentials configured', async () => {
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/external/credentials.json');
    mocks.existsSync.mockReturnValue(true);
    const { createFirebaseCustomToken } = await import('./bootstrap');

    await expect(createFirebaseCustomToken('target')).resolves.toBe('default-token');

    expect(mocks.readFileSync).not.toHaveBeenCalled();
    expect(mocks.cert).not.toHaveBeenCalled();
  });

  it('needs no signing key when the Auth emulator is enabled', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
    mocks.existsSync.mockReturnValue(true);
    const { createFirebaseCustomToken } = await import('./bootstrap');

    await expect(createFirebaseCustomToken('target')).resolves.toBe('default-token');

    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.cert).not.toHaveBeenCalled();
  });

  it('reports malformed local credentials without exposing file contents', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue('sensitive malformed credential contents');
    const { createFirebaseCustomToken } = await import('./bootstrap');

    expect(() => createFirebaseCustomToken('target')).toThrow('Unable to read local Firebase signing credentials.');
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it('uses an existing Firebase app while still applying Firestore settings', async () => {
    mocks.apps.push({ name: '[DEFAULT]' });
    const { initializeFirebase } = await import('./bootstrap');

    initializeFirebase();

    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.settings).toHaveBeenCalledOnce();
  });

  it('retains startup when Firestore settings were already applied', async () => {
    const settingsError = new Error('Firestore settings already configured');
    mocks.settings.mockImplementation(() => {
      throw settingsError;
    });
    const { initializeFirebase } = await import('./bootstrap');

    expect(() => initializeFirebase()).not.toThrow();
    expect(mocks.warn).toHaveBeenCalledWith(
      'Firestore settings already set or could not be set:',
      settingsError,
    );
  });
});
