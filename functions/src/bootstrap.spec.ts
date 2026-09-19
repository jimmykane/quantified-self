import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apps: [] as unknown[],
  initializeApp: vi.fn(),
  settings: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('firebase-admin', () => ({
  apps: mocks.apps,
  initializeApp: mocks.initializeApp,
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
    process.env.GCLOUD_PROJECT = 'test-project';
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
