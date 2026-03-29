import { connectAuthEmulator } from 'app/firebase/auth';
import type { Auth } from 'firebase/auth';
import { environment } from '../../environments/environment';

export function maybeConnectAuthEmulator(auth: Auth): Auth {
  if (!environment.useAuthEmulator) {
    return auth;
  }

  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  return auth;
}
