import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../environments/environment';
import type { FirebaseFirestoreType } from './firestore';
import type { FirebaseStorageType } from './storage';

const mocks = vi.hoisted(() => ({
  connectFirestoreEmulator: vi.fn(),
  connectStorageEmulator: vi.fn(),
}));

vi.mock('./firestore', async () => ({
  ...(await vi.importActual('./firestore')),
  connectFirestoreEmulator: mocks.connectFirestoreEmulator,
}));
vi.mock('./storage', async () => ({
  ...(await vi.importActual('./storage')),
  connectStorageEmulator: mocks.connectStorageEmulator,
}));

import { maybeConnectFirestoreEmulator, maybeConnectStorageEmulator } from './firebase-emulator.config';

describe('Firebase emulator connectors', () => {
  const originalMode = environment.backendMode;

  beforeEach(() => {
    vi.clearAllMocks();
    environment.backendMode = 'emulator';
  });

  afterAll(() => {
    environment.backendMode = originalMode;
  });

  it('connects Firestore and Storage to the configured loopback endpoints', () => {
    const firestore = {} as FirebaseFirestoreType;
    const storage = {} as FirebaseStorageType;

    expect(maybeConnectFirestoreEmulator(firestore)).toBe(firestore);
    expect(maybeConnectStorageEmulator(storage)).toBe(storage);
    expect(mocks.connectFirestoreEmulator).toHaveBeenCalledWith(firestore, '127.0.0.1', 8081);
    expect(mocks.connectStorageEmulator).toHaveBeenCalledWith(storage, '127.0.0.1', 9199);
  });

  it('does not connect hosted Firebase instances', () => {
    environment.backendMode = 'hosted';

    maybeConnectFirestoreEmulator({} as FirebaseFirestoreType);
    maybeConnectStorageEmulator({} as FirebaseStorageType);

    expect(mocks.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(mocks.connectStorageEmulator).not.toHaveBeenCalled();
  });
});
