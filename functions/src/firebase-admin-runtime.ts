const PRIMARY_STORAGE_BUCKET = 'quantified-self-io';

const REQUIRED_EMULATOR_HOSTS = [
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
  'FIRESTORE_EMULATOR_HOST',
  'CLOUD_TASKS_EMULATOR_HOST',
] as const;

export interface FirebaseAdminRuntime {
  isEmulator: boolean;
  projectId: string | undefined;
  databaseURL: string;
  storageBucket: string;
}

function getHost(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const closingBracket = trimmed.indexOf(']');
    return closingBracket > 0 ? trimmed.slice(1, closingBracket) : '';
  }
  return trimmed.slice(0, trimmed.lastIndexOf(':'));
}

function isLoopbackEmulatorAddress(value: string | undefined): boolean {
  if (!value || !/^.+:\d+$/u.test(value.trim())) {
    return false;
  }
  const host = getHost(value);
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function getFirebaseConfigProjectId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as { projectId?: unknown };
    return typeof parsed.projectId === 'string' ? parsed.projectId : undefined;
  } catch {
    throw new Error('[firebase-admin] FIREBASE_CONFIG is invalid JSON.');
  }
}

export function resolveFirebaseAdminRuntime(
  environment: NodeJS.ProcessEnv = process.env,
): FirebaseAdminRuntime {
  const projectId = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  if (environment.FUNCTIONS_EMULATOR !== 'true') {
    return {
      isEmulator: false,
      projectId,
      databaseURL: `https://${projectId}.firebaseio.com`,
      storageBucket: PRIMARY_STORAGE_BUCKET,
    };
  }

  if (!projectId?.startsWith('demo-')) {
    throw new Error('[firebase-admin] Functions emulator requires a demo-* project ID.');
  }
  const firebaseConfigProjectId = getFirebaseConfigProjectId(environment.FIREBASE_CONFIG);
  if (firebaseConfigProjectId && firebaseConfigProjectId !== projectId) {
    throw new Error('[firebase-admin] FIREBASE_CONFIG project does not match the emulator project.');
  }
  for (const name of REQUIRED_EMULATOR_HOSTS) {
    if (!isLoopbackEmulatorAddress(environment[name])) {
      throw new Error(`[firebase-admin] ${name} must point to a loopback emulator.`);
    }
  }

  return {
    isEmulator: true,
    projectId,
    databaseURL: `https://${projectId}.firebaseio.com`,
    storageBucket: `${projectId}.appspot.com`,
  };
}
