import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apps: [] as unknown[],
  initializeApp: vi.fn(),
  settings: vi.fn(),
  warn: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  cert: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock('firebase-admin', () => ({
  apps: mocks.apps,
  initializeApp: mocks.initializeApp,
  credential: { cert: mocks.cert },
  firestore: Object.assign(
    () => ({ settings: mocks.settings }),
    { FieldValue: {} },
  ),
}));

vi.mock('firebase-functions/logger', () => ({
  warn: mocks.warn,
}));

describe('initializeFirebase', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.apps.length = 0;
    mocks.initializeApp.mockReset().mockImplementation(() => {
      mocks.apps.push({ name: '[DEFAULT]' });
    });
    mocks.settings.mockReset();
    mocks.warn.mockReset();
    mocks.existsSync.mockReset().mockReturnValue(false);
    mocks.readFileSync.mockReset().mockReturnValue('{"type":"service_account"}');
    mocks.cert.mockReset().mockReturnValue({ localSigner: true });
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
      databaseURL: 'https://test-project.firebaseio.com',
      storageBucket: 'quantified-self-io',
    });
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.settings).toHaveBeenCalledWith({ ignoreUndefinedProperties: true });
    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.cert).not.toHaveBeenCalled();
  });

  it('uses the ignored repository-root key for Functions emulation with hosted Auth', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    const keyPath = resolve('/repo/quantified-self-io-firebase-adminsdk.json');
    mocks.existsSync.mockImplementation(candidate => candidate === keyPath);
    const { initializeFirebase } = await import('./bootstrap');

    initializeFirebase();
    initializeFirebase();

    expect(mocks.cert).toHaveBeenCalledExactlyOnceWith(keyPath);
    expect(mocks.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      credential: { localSigner: true },
    }));
  });

  it('prefers an explicitly configured service-account key over the repository fallback', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/external/credentials.json');
    mocks.existsSync.mockReturnValue(true);
    const { initializeFirebase } = await import('./bootstrap');

    initializeFirebase();

    expect(mocks.existsSync).toHaveBeenCalledExactlyOnceWith('/external/credentials.json');
    expect(mocks.cert).toHaveBeenCalledWith('/external/credentials.json');
  });

  it.each(['authorized_user', 'impersonated_service_account', 'external_account'])(
    'preserves SDK handling for explicitly configured %s ADC', async type => {
      vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/external/credentials.json');
      mocks.existsSync.mockReturnValue(true);
      mocks.readFileSync.mockReturnValue(JSON.stringify({ type }));
      const { initializeFirebase } = await import('./bootstrap');

      initializeFirebase();

      expect(mocks.cert).not.toHaveBeenCalled();
      expect(mocks.initializeApp.mock.calls[0][0]).not.toHaveProperty('credential');
    },
  );

  it.each(['', '/external/missing.json'])(
    'keeps ADC startup when the optional key is unavailable (%s)', async configuredPath => {
      vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
      vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', configuredPath);
      const { initializeFirebase } = await import('./bootstrap');

      initializeFirebase();

      expect(mocks.cert).not.toHaveBeenCalled();
      expect(mocks.initializeApp.mock.calls[0][0]).not.toHaveProperty('credential');
      if (configuredPath) {
        expect(mocks.existsSync).toHaveBeenCalledExactlyOnceWith(configuredPath);
      }
    },
  );

  it('never loads a local key in deployed runtimes, even with explicit credentials configured', async () => {
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', '/external/credentials.json');
    mocks.existsSync.mockReturnValue(true);
    const { initializeFirebase } = await import('./bootstrap');

    initializeFirebase();

    expect(mocks.readFileSync).not.toHaveBeenCalled();
    expect(mocks.cert).not.toHaveBeenCalled();
  });

  it('needs no signing key when the Auth emulator is enabled', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
    mocks.existsSync.mockReturnValue(true);
    const { initializeFirebase } = await import('./bootstrap');

    initializeFirebase();

    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.cert).not.toHaveBeenCalled();
  });

  it('reports malformed local credentials without exposing file contents', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue('sensitive malformed credential contents');
    const { initializeFirebase } = await import('./bootstrap');

    expect(() => initializeFirebase()).toThrow('Unable to read local Firebase signing credentials.');
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
