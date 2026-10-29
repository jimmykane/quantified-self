import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveFirebaseAdminRuntime } from './firebase-admin-runtime';

describe('resolveFirebaseAdminRuntime', () => {
  beforeEach(() => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.stubEnv('QS_ISOLATED_LOCAL_RUNTIME', 'true');
    vi.stubEnv('GCLOUD_PROJECT', 'demo-quantified-self-local');
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'demo-quantified-self-local' }));
    vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
    vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199');
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8081');
    vi.stubEnv('CLOUD_TASKS_EMULATOR_HOST', '127.0.0.1:9499');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('uses a demo project and bucket in the emulator', () => {
    expect(resolveFirebaseAdminRuntime()).toEqual({
      isEmulator: true,
      projectId: 'demo-quantified-self-local',
      databaseURL: 'https://demo-quantified-self-local.firebaseio.com',
      storageBucket: 'demo-quantified-self-local.appspot.com',
    });
  });

  it('requires the Functions emulator', () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', undefined);
    expect(() => resolveFirebaseAdminRuntime()).toThrow(/Functions emulator/u);
  });

  it('rejects real projects', () => {
    vi.stubEnv('GCLOUD_PROJECT', 'quantified-self-io');
    expect(() => resolveFirebaseAdminRuntime()).toThrow(/demo-/u);
  });

  it('requires a Firestore emulator', () => {
    vi.stubEnv('FIRESTORE_EMULATOR_HOST', undefined);
    expect(() => resolveFirebaseAdminRuntime()).toThrow(/FIRESTORE/u);
  });

  it('rejects non-loopback hosts', () => {
    vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', '10.0.0.2:9199');
    expect(() => resolveFirebaseAdminRuntime()).toThrow(/STORAGE/u);
  });

  it('rejects mismatched Firebase configuration', () => {
    vi.stubEnv('FIREBASE_CONFIG', JSON.stringify({ projectId: 'another-demo' }));
    expect(() => resolveFirebaseAdminRuntime()).toThrow(/does not match/u);
  });

  it('preserves the existing Functions-only emulator profile outside isolated local mode', () => {
    expect(resolveFirebaseAdminRuntime({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'test-project' }).storageBucket).toBe('quantified-self-io');
  });

  it('preserves the production project and bucket outside the emulator', () => {
    expect(resolveFirebaseAdminRuntime({ GCLOUD_PROJECT: 'quantified-self-io' })).toEqual({
      isEmulator: false,
      projectId: 'quantified-self-io',
      databaseURL: 'https://quantified-self-io.firebaseio.com',
      storageBucket: 'quantified-self-io',
    });
  });
});
