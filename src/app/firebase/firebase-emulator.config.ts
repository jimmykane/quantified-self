import type { FirebaseFirestoreType } from './firestore';
import { connectFirestoreEmulator } from './firestore';
import type { FirebaseStorageType } from './storage';
import { connectStorageEmulator } from './storage';
import { environment } from '../../environments/environment';

function getEmulatorConfiguration() {
  if (environment.backendMode !== 'emulator') {
    return null;
  }
  if (!environment.emulatorConfig) {
    throw new Error('[firebase] Emulator mode requires emulatorConfig.');
  }
  return environment.emulatorConfig;
}

export function maybeConnectFirestoreEmulator(firestore: FirebaseFirestoreType): FirebaseFirestoreType {
  const emulatorConfig = getEmulatorConfiguration();
  if (emulatorConfig) {
    connectFirestoreEmulator(firestore, emulatorConfig.host, emulatorConfig.ports.firestore);
  }
  return firestore;
}

export function maybeConnectStorageEmulator(storage: FirebaseStorageType): FirebaseStorageType {
  const emulatorConfig = getEmulatorConfiguration();
  if (emulatorConfig) {
    connectStorageEmulator(storage, emulatorConfig.host, emulatorConfig.ports.storage);
  }
  return storage;
}
