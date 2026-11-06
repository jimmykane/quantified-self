import { connectAuthEmulator } from 'app/firebase/auth';
import type { FirebaseAuthType } from 'app/firebase/auth';
import { environment } from '../../environments/environment';

export function maybeConnectAuthEmulator(auth: FirebaseAuthType): FirebaseAuthType {
  if (!environment.useAuthEmulator) {
    return auth;
  }

  const emulatorConfig = environment.emulatorConfig;
  if (environment.backendMode !== 'emulator' || !emulatorConfig) {
    throw new Error('[auth] Auth emulator was enabled without an isolated emulator configuration.');
  }

  connectAuthEmulator(
    auth,
    `http://${emulatorConfig.host}:${emulatorConfig.ports.auth}`,
    { disableWarnings: true },
  );
  return auth;
}
