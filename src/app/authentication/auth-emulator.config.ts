import { connectAuthEmulator } from 'app/firebase/auth';
import type { FirebaseAuthType } from 'app/firebase/auth';
import { environment } from '../../environments/environment';

export function maybeConnectAuthEmulator(auth: FirebaseAuthType): FirebaseAuthType {
  if (!environment.useAuthEmulator) {
    return auth;
  }

  connectAuthEmulator(auth, environment.firebase?.projectId === 'demo-stripe-billing' ? 'http://127.0.0.1:9191' : 'http://localhost:9099', { disableWarnings: true });
  return auth;
}
