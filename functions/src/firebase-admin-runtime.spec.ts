import { describe, expect, it } from 'vitest';
import { resolveFirebaseAdminRuntime } from './firebase-admin-runtime';

function emulatorEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    FUNCTIONS_EMULATOR: 'true',
    GCLOUD_PROJECT: 'demo-quantified-self-local',
    FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-quantified-self-local' }),
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081',
    CLOUD_TASKS_EMULATOR_HOST: '127.0.0.1:9499',
    ...overrides,
  };
}

describe('resolveFirebaseAdminRuntime', () => {
  it('uses a demo project and bucket in the emulator', () => {
    expect(resolveFirebaseAdminRuntime(emulatorEnvironment())).toEqual({
      isEmulator: true,
      projectId: 'demo-quantified-self-local',
      databaseURL: 'https://demo-quantified-self-local.firebaseio.com',
      storageBucket: 'demo-quantified-self-local.appspot.com',
    });
  });

  it('rejects real projects, missing emulators, and non-loopback hosts', () => {
    expect(() => resolveFirebaseAdminRuntime(emulatorEnvironment({ GCLOUD_PROJECT: 'quantified-self-io' }))).toThrow(/demo-/u);
    expect(() => resolveFirebaseAdminRuntime(emulatorEnvironment({ FIRESTORE_EMULATOR_HOST: undefined }))).toThrow(/FIRESTORE/u);
    expect(() => resolveFirebaseAdminRuntime(emulatorEnvironment({ FIREBASE_STORAGE_EMULATOR_HOST: '10.0.0.2:9199' }))).toThrow(/STORAGE/u);
  });

  it('rejects mismatched Firebase configuration', () => {
    expect(() => resolveFirebaseAdminRuntime(emulatorEnvironment({
      FIREBASE_CONFIG: JSON.stringify({ projectId: 'another-demo' }),
    }))).toThrow(/does not match/u);
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
