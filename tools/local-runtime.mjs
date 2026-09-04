import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localRuntimeConfigPath = path.join(repositoryRoot, 'local-runtime.config.json');
export const localFirebaseConfigPath = path.join(repositoryRoot, 'firebase.local.json');
export const angularConfigPath = path.join(repositoryRoot, 'angular.json');
export const localStatePath = path.join(repositoryRoot, '.local', 'firebase-emulator-data');
export const localSecretPath = path.join(repositoryRoot, 'functions', '.secret.local');
export const localSecretExamplePath = path.join(repositoryRoot, 'functions', '.secret.local.example');

const LOCAL_NODE_COMMAND_SCRIPTS = Object.freeze({
  firebase: path.join(repositoryRoot, 'node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js'),
  'functions-build': path.join(repositoryRoot, 'functions', 'scripts', 'build.mjs'),
  ng: path.join(repositoryRoot, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'),
});

const EXPECTED_EMULATORS = ['auth', 'functions', 'firestore', 'storage', 'tasks'];
const REQUIRED_PORT_NAMES = ['app', ...EXPECTED_EMULATORS, 'ui', 'hub'];
const DISALLOWED_FIREBASE_KEYS = ['extensions', 'hosting', 'remoteconfig'];
export const LOCAL_SECRET_SENTINEL = 'LOCAL_EMULATOR_DISABLED';
export const LOCAL_SMOKE_CHECK_COMMAND = 'npm run local:smoke:check';
const FORBIDDEN_FUNCTION_SOURCE_FILE_PATTERNS = [
  /(?:^|\/)\.env(?:\..*)?$/u,
  /(?:^|\/)\.runtimeconfig\.json$/u,
  /(?:^|\/)[^/]*service[-_]?account[^/]*\.json$/iu,
  /(?:^|\/)[^/]*firebase-adminsdk[^/]*\.json$/iu,
];
const FUNCTION_SOURCE_SCAN_IGNORED_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'emulator-export',
  'firestore_export',
  'lib',
  'node_modules',
  'tmp',
]);
const CLOUD_CREDENTIAL_ENV_NAMES = [
  'FIREBASE_CONFIG',
  'FIREBASE_TOKEN',
  'GCLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
];

export function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === 'localhost';
}

export function buildLocalNodeCommand(name, args = []) {
  const scriptPath = LOCAL_NODE_COMMAND_SCRIPTS[name];
  if (!scriptPath) {
    throw new Error(`[local] Unknown local command: ${name}.`);
  }
  return {
    command: process.execPath,
    args: [scriptPath, ...args],
  };
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
    throw new Error('[local] The local runtime must use the supported loopback host 127.0.0.1 or localhost.');
  }

  const configuredPorts = REQUIRED_PORT_NAMES.map(name => {
    const port = runtimeConfig?.ports?.[name];
    assertPort(port, `${name} port`);
    return port;
  });
  if (new Set(configuredPorts).size !== configuredPorts.length) {
    throw new Error('[local] Every local service must use a distinct TCP port.');
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
  if (firebaseConfig?.functions?.disallowLegacyRuntimeConfig !== true) {
    throw new Error('[local] Legacy Functions runtime configuration must be disabled.');
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
  if (firebaseConfig.emulators.ui.enabled !== true) {
    throw new Error('[local] The local Emulator UI must be enabled.');
  }

  return runtimeConfig;
}

export function validateAngularLocalConfiguration(angularConfig) {
  const buildConfigurations = angularConfig?.projects?.['track-tools']?.architect?.build?.configurations;
  const localReplacements = buildConfigurations?.local?.fileReplacements;
  const expectedReplacements = new Map([
    ['src/environments/environment.ts', 'src/environments/environment.local.ts'],
    ['src/environments/mapbox-token.ts', 'src/environments/mapbox-token.local.ts'],
  ]);
  if (!Array.isArray(localReplacements) || localReplacements.length !== expectedReplacements.size) {
    throw new Error('[local] Angular local file replacements do not match the isolated runtime.');
  }
  const seenReplacements = new Set();
  for (const replacement of localReplacements) {
    const expectedTarget = expectedReplacements.get(replacement?.replace);
    if (!expectedTarget || replacement.with !== expectedTarget || seenReplacements.has(replacement.replace)) {
      throw new Error('[local] Angular local file replacements do not match the isolated runtime.');
    }
    seenReplacements.add(replacement.replace);
  }

  const localServeTarget = angularConfig?.projects?.['track-tools']?.architect?.serve?.configurations?.local?.buildTarget;
  if (localServeTarget !== 'track-tools:build:local') {
    throw new Error('[local] Angular local serve must target track-tools:build:local.');
  }
  return angularConfig;
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
    if (assignments.has(name)) {
      throw new Error(`[local] Duplicate environment assignment: ${name}.`);
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

export function assertExactLocalSecretTemplate(secretContents, exampleContents) {
  const expectedAssignments = parseEnvAssignments(exampleContents);
  const actualAssignments = parseEnvAssignments(secretContents);
  const invalidExampleNames = [...expectedAssignments.entries()]
    .filter(([, value]) => value !== LOCAL_SECRET_SENTINEL)
    .map(([name]) => name)
    .sort();
  if (expectedAssignments.size === 0 || invalidExampleNames.length > 0) {
    throw new Error(`[local] The committed local secret template is invalid${invalidExampleNames.length > 0 ? `: ${invalidExampleNames.join(', ')}` : '.'}`);
  }

  const missingNames = [...expectedAssignments.keys()]
    .filter(name => !actualAssignments.has(name))
    .sort();
  const unexpectedNames = [...actualAssignments.keys()]
    .filter(name => !expectedAssignments.has(name))
    .sort();
  const invalidValueNames = [...actualAssignments.entries()]
    .filter(([, value]) => value !== LOCAL_SECRET_SENTINEL)
    .map(([name]) => name)
    .sort();
  const mismatches = [
    missingNames.length > 0 ? `missing ${missingNames.join(', ')}` : '',
    unexpectedNames.length > 0 ? `unexpected ${unexpectedNames.join(', ')}` : '',
    invalidValueNames.length > 0 ? `non-sentinel ${invalidValueNames.join(', ')}` : '',
  ].filter(Boolean);
  if (mismatches.length > 0) {
    throw new Error(`[local] Local backend placeholders must exactly match functions/.secret.local.example: ${mismatches.join('; ')}.`);
  }
}

async function assertSafeLocalSecretFilePath(filePath, label, allowMissing = false) {
  try {
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`[local] Refusing to use ${label} through a symbolic link.`);
    }
    if (!metadata.isFile()) {
      throw new Error(`[local] ${label} must be a regular file.`);
    }
    if (metadata.nlink !== 1) {
      throw new Error(`[local] Refusing to use ${label} with multiple filesystem links.`);
    }
    return true;
  } catch (error) {
    if (allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function replaceWithLocalSecretTemplate(examplePath, secretPath) {
  const temporaryPath = `${secretPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await copyFile(examplePath, temporaryPath, constants.COPYFILE_EXCL);
    await rename(temporaryPath, secretPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function ensureLocalSecretFileAt(
  secretPath,
  examplePath,
  processEnvironment = process.env,
) {
  await assertSafeLocalSecretFilePath(examplePath, 'the committed local secret template');
  const secretExists = await assertSafeLocalSecretFilePath(
    secretPath,
    'the local secret placeholder file',
    true,
  );
  if (!secretExists) {
    await replaceWithLocalSecretTemplate(examplePath, secretPath);
    await assertSafeLocalSecretFilePath(secretPath, 'the local secret placeholder file');
  }

  const exampleContents = await readFile(examplePath, 'utf8');
  let secretContents = await readFile(secretPath, 'utf8');
  assertNoLocalSecrets(secretContents, processEnvironment);

  const assignments = [...parseEnvAssignments(secretContents).values()];
  if (assignments.every(value => value.length === 0)) {
    await assertSafeLocalSecretFilePath(secretPath, 'the local secret placeholder file');
    await replaceWithLocalSecretTemplate(examplePath, secretPath);
    secretContents = await readFile(secretPath, 'utf8');
  }
  assertExactLocalSecretTemplate(secretContents, exampleContents);
  assertNoLocalSecrets(secretContents, processEnvironment);
}

export function findForbiddenFunctionSourceFiles(fileNames) {
  return fileNames
    .filter(fileName => FORBIDDEN_FUNCTION_SOURCE_FILE_PATTERNS.some(pattern => pattern.test(fileName)))
    .sort();
}

export function assertPublicMapboxTokenSource(tokenSource) {
  const tokenMatch = tokenSource.match(/^\s*export\s+const\s+mapboxAccessToken\s*=\s*['"]([^'"]*)['"]\s*;?\s*$/mu);
  if (!tokenMatch?.[1] || !/^pk\.\S+$/u.test(tokenMatch[1])) {
    throw new Error('[local] src/environments/mapbox-token.local.ts must contain a Mapbox pk.* public token.');
  }
}

async function listFunctionSourceFiles(rootDirectory) {
  const files = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!FUNCTION_SOURCE_SCAN_IGNORED_DIRECTORIES.has(entry.name)) {
          pendingDirectories.push(entryPath);
        }
        continue;
      }
      files.push(path.relative(rootDirectory, entryPath).split(path.sep).join('/'));
    }
  }

  return files.sort();
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
  const [runtimeContents, firebaseContents, angularContents] = await Promise.all([
    readFile(localRuntimeConfigPath, 'utf8'),
    readFile(localFirebaseConfigPath, 'utf8'),
    readFile(angularConfigPath, 'utf8'),
  ]);
  const runtimeConfig = JSON.parse(runtimeContents);
  const firebaseConfig = JSON.parse(firebaseContents);
  const angularConfig = JSON.parse(angularContents);
  validateRuntimeConfiguration(runtimeConfig, firebaseConfig);
  validateAngularLocalConfiguration(angularConfig);
  return { runtimeConfig, firebaseConfig, angularConfig };
}

export async function ensureEmptyLocalSecretFile() {
  await ensureLocalSecretFileAt(localSecretPath, localSecretExamplePath);

  const functionSourceDirectory = path.join(repositoryRoot, 'functions');
  const forbiddenFiles = findForbiddenFunctionSourceFiles(
    await listFunctionSourceFiles(functionSourceDirectory),
  );
  if (forbiddenFiles.length > 0) {
    throw new Error(`[local] Refusing to start while Functions credential or environment files exist: ${forbiddenFiles.join(', ')}.`);
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
    buildLocalNodeCommand('ng').args[0],
    buildLocalNodeCommand('firebase').args[0],
    buildLocalNodeCommand('functions-build').args[0],
    path.join(repositoryRoot, 'functions', 'node_modules', 'typescript', 'bin', 'tsc'),
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
  assertPublicMapboxTokenSource(tokenContents);
}

export async function hasSavedEmulatorState() {
  await assertLocalStatePersistencePathAt(repositoryRoot, localStatePath);
  try {
    const metadata = await lstat(path.join(localStatePath, 'firebase-export-metadata.json'));
    return metadata.isFile();
  } catch {
    return false;
  }
}

export async function ensureLocalStateDirectory() {
  await assertLocalStatePersistencePathAt(repositoryRoot, localStatePath);
  await mkdir(path.dirname(localStatePath), { recursive: true });
  await assertLocalStatePersistencePathAt(repositoryRoot, localStatePath);
}

function resolveExpectedLocalStatePath(rootDirectory, statePath) {
  const resolvedRoot = path.resolve(rootDirectory);
  const expectedPath = path.resolve(resolvedRoot, '.local', 'firebase-emulator-data');
  if (path.resolve(statePath) !== expectedPath || !expectedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('[local] Refusing to use an unexpected local state path.');
  }
  return expectedPath;
}

export async function assertLocalStatePersistencePathAt(rootDirectory, statePath) {
  const expectedPath = resolveExpectedLocalStatePath(rootDirectory, statePath);
  const parentPath = path.dirname(expectedPath);

  for (const [candidatePath, label] of [[parentPath, 'parent'], [expectedPath, 'directory']]) {
    try {
      const metadata = await lstat(candidatePath);
      if (metadata.isSymbolicLink()) {
        throw new Error('[local] Refusing to use local state through a symbolic link.');
      }
      if (!metadata.isDirectory()) {
        throw new Error(`[local] The local state ${label} must be a directory.`);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  const pendingDirectories = [expectedPath];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) {
          throw new Error('[local] Refusing to use saved emulator state containing a symbolic link.');
        }
        if (entry.isDirectory()) {
          pendingDirectories.push(path.join(directory, entry.name));
        }
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }
}

export async function removeLocalStateAt(rootDirectory, statePath) {
  const expectedPath = resolveExpectedLocalStatePath(rootDirectory, statePath);
  await assertLocalStatePersistencePathAt(rootDirectory, statePath);
  await rm(expectedPath, { recursive: true, force: true });
}

export async function removeLocalState() {
  await removeLocalStateAt(repositoryRoot, localStatePath);
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
