import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localRuntimeConfigPath = path.join(repositoryRoot, 'local-runtime.config.json');
export const localFirebaseConfigPath = path.join(repositoryRoot, 'firebase.local.json');
export const localStatePath = path.join(repositoryRoot, '.local', 'firebase-emulator-data');
export const localSecretPath = path.join(repositoryRoot, 'functions', '.secret.local');
export const localSecretExamplePath = path.join(repositoryRoot, 'functions', '.secret.local.example');

const EXPECTED_EMULATORS = ['auth', 'functions', 'firestore', 'storage', 'tasks'];
const DISALLOWED_FIREBASE_KEYS = ['extensions', 'hosting', 'remoteconfig'];
export const LOCAL_SECRET_SENTINEL = 'LOCAL_EMULATOR_DISABLED';
const CLOUD_CREDENTIAL_ENV_NAMES = [
  'FIREBASE_CONFIG',
  'FIREBASE_TOKEN',
  'GCLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
];

export function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function assertPort(value, name) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error(`[local] ${name} must be an unprivileged TCP port.`);
  }
}

export function validateRuntimeConfiguration(runtimeConfig, firebaseConfig) {
  if (!runtimeConfig?.projectId?.startsWith('demo-')) {
    throw new Error('[local] The local Firebase project ID must start with demo-.');
  }
  if (!isLoopbackHost(runtimeConfig.host)) {
    throw new Error('[local] The local runtime must bind to a loopback host.');
  }

  for (const [name, port] of Object.entries(runtimeConfig.ports ?? {})) {
    assertPort(port, `${name} port`);
  }

  for (const key of DISALLOWED_FIREBASE_KEYS) {
    if (Object.hasOwn(firebaseConfig, key)) {
      throw new Error(`[local] firebase.local.json must not contain ${key}.`);
    }
  }
  if (firebaseConfig?.emulators?.singleProjectMode !== true) {
    throw new Error('[local] Firebase single-project emulator mode must be enabled.');
  }
  if (firebaseConfig?.functions?.source !== 'functions') {
    throw new Error('[local] The local Functions source must be functions/.');
  }
  if (!firebaseConfig?.firestore?.rules || !firebaseConfig?.storage?.rules) {
    throw new Error('[local] Firestore and Storage rules must be configured locally.');
  }

  for (const emulator of [...EXPECTED_EMULATORS, 'ui', 'hub']) {
    const configured = firebaseConfig?.emulators?.[emulator];
    if (!configured || configured.host !== runtimeConfig.host || configured.port !== runtimeConfig.ports[emulator]) {
      throw new Error(`[local] ${emulator} emulator configuration does not match local-runtime.config.json.`);
    }
  }

  return runtimeConfig;
}

export function parseEnvAssignments(contents) {
  const assignments = new Map();
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    assignments.set(name, value);
  }
  return assignments;
}

export function assertNoLocalSecrets(secretContents, processEnvironment = process.env) {
  const configuredSecrets = [...parseEnvAssignments(secretContents).entries()]
    .filter(([, value]) => value.length > 0 && value !== LOCAL_SECRET_SENTINEL)
    .map(([name]) => name);
  const inheritedSecrets = [...parseEnvAssignments(secretContents).keys()]
    .filter(name => typeof processEnvironment[name] === 'string' && processEnvironment[name].trim().length > 0);
  const cloudCredentialNames = CLOUD_CREDENTIAL_ENV_NAMES
    .filter(name => typeof processEnvironment[name] === 'string' && processEnvironment[name].trim().length > 0);
  const unsafeNames = [...new Set([...configuredSecrets, ...inheritedSecrets, ...cloudCredentialNames])].sort();

  if (unsafeNames.length > 0) {
    throw new Error(`[local] Refusing to start with cloud credentials or backend secrets configured: ${unsafeNames.join(', ')}.`);
  }
}

export function buildEmulatorArguments(runtimeConfig, importExistingState) {
  const args = [
    'emulators:start',
    '--config', 'firebase.local.json',
    '--project', runtimeConfig.projectId,
    '--only', EXPECTED_EMULATORS.join(','),
  ];
  if (importExistingState) {
    args.push('--import', path.relative(repositoryRoot, localStatePath));
  }
  args.push('--export-on-exit', path.relative(repositoryRoot, localStatePath));
  return args;
}

export async function readLocalRuntimeConfiguration() {
  const [runtimeContents, firebaseContents] = await Promise.all([
    readFile(localRuntimeConfigPath, 'utf8'),
    readFile(localFirebaseConfigPath, 'utf8'),
  ]);
  const runtimeConfig = JSON.parse(runtimeContents);
  const firebaseConfig = JSON.parse(firebaseContents);
  validateRuntimeConfiguration(runtimeConfig, firebaseConfig);
  return { runtimeConfig, firebaseConfig };
}

export async function ensureEmptyLocalSecretFile() {
  try {
    await access(localSecretPath);
  } catch {
    await copyFile(localSecretExamplePath, localSecretPath);
  }

  let secretContents = await readFile(localSecretPath, 'utf8');
  assertNoLocalSecrets(secretContents);

  const assignments = [...parseEnvAssignments(secretContents).values()];
  if (assignments.length > 0 && assignments.every(value => value.length === 0)) {
    await copyFile(localSecretExamplePath, localSecretPath);
    secretContents = await readFile(localSecretPath, 'utf8');
  }
  const unsafePlaceholderNames = [...parseEnvAssignments(secretContents).entries()]
    .filter(([, value]) => value !== LOCAL_SECRET_SENTINEL)
    .map(([name]) => name);
  if (unsafePlaceholderNames.length > 0) {
    throw new Error(`[local] Local backend placeholders must use ${LOCAL_SECRET_SENTINEL}: ${unsafePlaceholderNames.join(', ')}.`);
  }
  assertNoLocalSecrets(secretContents);

  const functionFiles = await readdir(path.join(repositoryRoot, 'functions'));
  const environmentFiles = functionFiles.filter(name => name.startsWith('.env'));
  if (environmentFiles.length > 0) {
    throw new Error(`[local] Refusing to start while Functions environment files exist: ${environmentFiles.join(', ')}.`);
  }
}

export async function createIsolatedLocalProcessEnvironment(sourceEnvironment = process.env) {
  const cloudSdkConfigPath = await mkdtemp(path.join(os.tmpdir(), 'quantified-self-local-gcloud-'));
  const environment = {
    ...sourceEnvironment,
    CLOUDSDK_CONFIG: cloudSdkConfigPath,
    NO_GCE_CHECK: 'true',
    XDG_CONFIG_HOME: cloudSdkConfigPath,
  };
  for (const name of CLOUD_CREDENTIAL_ENV_NAMES) {
    delete environment[name];
  }
  // A missing explicit credential file makes any accidental non-emulator
  // Google client fail before it can inherit workstation ADC or reach a cloud API.
  environment.GOOGLE_APPLICATION_CREDENTIALS = path.join(cloudSdkConfigPath, 'intentionally-missing-adc.json');
  return {
    environment,
    cleanup: () => rm(cloudSdkConfigPath, { recursive: true, force: true }),
  };
}

export async function assertLocalPrerequisites() {
  const requiredPaths = [
    path.join(repositoryRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'ng.cmd' : 'ng'),
    path.join(repositoryRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'firebase.cmd' : 'firebase'),
    path.join(repositoryRoot, 'functions', 'node_modules'),
    path.join(repositoryRoot, 'src', 'environments', 'mapbox-token.local.ts'),
  ];
  const missing = [];
  for (const requiredPath of requiredPaths) {
    try {
      await access(requiredPath);
    } catch {
      missing.push(path.relative(repositoryRoot, requiredPath));
    }
  }
  if (missing.length > 0) {
    throw new Error(`[local] Missing prerequisites: ${missing.join(', ')}. Follow README Quick Start first.`);
  }

  const tokenContents = await readFile(path.join(repositoryRoot, 'src', 'environments', 'mapbox-token.local.ts'), 'utf8');
  if (/YOUR_PUBLIC_MAPBOX_TOKEN/u.test(tokenContents) || /mapboxAccessToken\s*=\s*['"]\s*['"]/u.test(tokenContents)) {
    throw new Error('[local] Replace YOUR_PUBLIC_MAPBOX_TOKEN in src/environments/mapbox-token.local.ts.');
  }
}

export async function hasSavedEmulatorState() {
  try {
    const metadata = await stat(path.join(localStatePath, 'firebase-export-metadata.json'));
    return metadata.isFile();
  } catch {
    return false;
  }
}

export async function ensureLocalStateDirectory() {
  await mkdir(path.dirname(localStatePath), { recursive: true });
}

export async function removeLocalState() {
  const expectedPath = path.resolve(repositoryRoot, '.local', 'firebase-emulator-data');
  if (path.resolve(localStatePath) !== expectedPath || !expectedPath.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error('[local] Refusing to remove an unexpected local state path.');
  }
  await rm(expectedPath, { recursive: true, force: true });
}

export async function assertPortsAvailable(runtimeConfig, portNames = Object.keys(runtimeConfig.ports)) {
  for (const name of portNames) {
    const port = runtimeConfig.ports[name];
    if (!Number.isInteger(port)) {
      throw new Error(`[local] Unknown configured port: ${name}.`);
    }
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => reject(new Error(`[local] ${name} port ${port} is already in use.`)));
      server.listen({ host: runtimeConfig.host, port }, () => server.close(resolve));
    });
  }
}

export async function readEmulatorHub(runtimeConfig) {
  const response = await fetch(`http://${runtimeConfig.host}:${runtimeConfig.ports.hub}/emulators`);
  if (!response.ok) {
    throw new Error(`[local] Emulator Hub returned HTTP ${response.status}.`);
  }
  return response.json();
}

export function assertExpectedEmulators(runtimeConfig, emulatorRegistry) {
  for (const emulator of EXPECTED_EMULATORS) {
    const entry = emulatorRegistry?.[emulator];
    if (!entry || entry.host !== runtimeConfig.host || entry.port !== runtimeConfig.ports[emulator]) {
      throw new Error(`[local] Expected ${emulator} on ${runtimeConfig.host}:${runtimeConfig.ports[emulator]}.`);
    }
  }
}

export async function waitForEmulators(runtimeConfig, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const registry = await readEmulatorHub(runtimeConfig);
      assertExpectedEmulators(runtimeConfig, registry);
      return registry;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error(`[local] Timed out waiting for Firebase emulators: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
}

export function localBinary(name) {
  const extension = process.platform === 'win32' ? '.cmd' : '';
  return path.join(repositoryRoot, 'node_modules', '.bin', `${name}${extension}`);
}
