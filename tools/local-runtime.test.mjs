import assert from 'node:assert/strict';
import { access, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertNoLocalSecrets,
  assertExactLocalSecretTemplate,
  assertLocalStatePersistencePathAt,
  assertPublicMapboxTokenSource,
  buildLocalNodeCommand,
  buildEmulatorArguments,
  createIsolatedLocalProcessEnvironment,
  ensureLocalSecretFileAt,
  findForbiddenFunctionSourceFiles,
  LOCAL_SECRET_SENTINEL,
  LOCAL_SMOKE_CHECK_COMMAND,
  parseEnvAssignments,
  readLocalRuntimeConfiguration,
  removeLocalStateAt,
  repositoryRoot,
  validateAngularLocalConfiguration,
  validateRuntimeConfiguration,
} from './local-runtime.mjs';

const runtimeConfig = {
  projectId: 'demo-quantified-self-local',
  host: '127.0.0.1',
  ports: { app: 4200, auth: 9099, functions: 5001, firestore: 8081, storage: 9199, tasks: 9499, ui: 4000, hub: 4400 },
};

function firebaseConfig() {
  return {
    functions: { source: 'functions', disallowLegacyRuntimeConfig: true },
    firestore: { rules: 'firestore.rules' },
    storage: { rules: 'storage.rules' },
    emulators: {
      singleProjectMode: true,
      auth: { host: '127.0.0.1', port: 9099 },
      functions: { host: '127.0.0.1', port: 5001 },
      firestore: { host: '127.0.0.1', port: 8081 },
      storage: { host: '127.0.0.1', port: 9199 },
      tasks: { host: '127.0.0.1', port: 9499 },
      ui: { enabled: true, host: '127.0.0.1', port: 4000 },
      hub: { host: '127.0.0.1', port: 4400 },
    },
  };
}

function angularConfig() {
  return {
    projects: {
      'track-tools': {
        architect: {
          build: {
            configurations: {
              local: {
                fileReplacements: [
                  { replace: 'src/environments/environment.ts', with: 'src/environments/environment.local.ts' },
                  { replace: 'src/environments/mapbox-token.ts', with: 'src/environments/mapbox-token.local.ts' },
                ],
              },
            },
          },
          serve: { configurations: { local: { buildTarget: 'track-tools:build:local' } } },
        },
      },
    },
  };
}

test('accepts a matching demo-project configuration', () => {
  assert.doesNotThrow(() => validateRuntimeConfiguration(runtimeConfig, firebaseConfig()));
});

test('accepts the committed local runtime and Firebase configurations', async () => {
  const committed = await readLocalRuntimeConfiguration();
  assert.equal(committed.runtimeConfig.projectId, 'demo-quantified-self-local');
  assert.equal(committed.firebaseConfig.emulators.singleProjectMode, true);
});

test('accepts only the isolated Angular local build and serve targets', () => {
  assert.doesNotThrow(() => validateAngularLocalConfiguration(angularConfig()));

  const hostedReplacement = angularConfig();
  hostedReplacement.projects['track-tools'].architect.build.configurations.local.fileReplacements[0].with =
    'src/environments/environment.prod.ts';
  assert.throws(() => validateAngularLocalConfiguration(hostedReplacement), /file replacements/u);

  const duplicateReplacement = angularConfig();
  duplicateReplacement.projects['track-tools'].architect.build.configurations.local.fileReplacements[1] =
    structuredClone(duplicateReplacement.projects['track-tools'].architect.build.configurations.local.fileReplacements[0]);
  assert.throws(() => validateAngularLocalConfiguration(duplicateReplacement), /file replacements/u);

  const hostedServeTarget = angularConfig();
  hostedServeTarget.projects['track-tools'].architect.serve.configurations.local.buildTarget =
    'track-tools:build:production';
  assert.throws(() => validateAngularLocalConfiguration(hostedServeTarget), /serve/u);
});

test('rejects real projects, extensions, and endpoint drift', () => {
  assert.throws(() => validateRuntimeConfiguration({ ...runtimeConfig, projectId: 'quantified-self-io' }, firebaseConfig()), /demo-/u);
  assert.throws(() => validateRuntimeConfiguration({ ...runtimeConfig, host: '::1' }, firebaseConfig()), /127\.0\.0\.1/u);
  assert.throws(() => validateRuntimeConfiguration(runtimeConfig, { ...firebaseConfig(), extensions: {} }), /extensions/u);
  const drifted = firebaseConfig();
  drifted.emulators.firestore.port = 8080;
  assert.throws(() => validateRuntimeConfiguration(runtimeConfig, drifted), /firestore/u);
});

test('requires all local ports to be present and distinct', () => {
  const missingPort = structuredClone(runtimeConfig);
  delete missingPort.ports.app;
  assert.throws(() => validateRuntimeConfiguration(missingPort, firebaseConfig()), /app port/u);

  const duplicatePort = structuredClone(runtimeConfig);
  duplicatePort.ports.storage = duplicatePort.ports.firestore;
  assert.throws(() => validateRuntimeConfiguration(duplicatePort, firebaseConfig()), /distinct/u);
});

test('requires legacy runtime config protection and the Emulator UI', () => {
  const legacyEnabled = firebaseConfig();
  legacyEnabled.functions.disallowLegacyRuntimeConfig = false;
  assert.throws(() => validateRuntimeConfiguration(runtimeConfig, legacyEnabled), /Legacy/u);

  const uiDisabled = firebaseConfig();
  uiDisabled.emulators.ui.enabled = false;
  assert.throws(() => validateRuntimeConfiguration(runtimeConfig, uiDisabled), /UI/u);
});

test('parses dotenv assignments without treating quoted empties as secrets', () => {
  assert.deepEqual(
    [...parseEnvAssignments("A=\nB=''\nC=\"value\"\n# ignored\n").entries()],
    [['A', ''], ['B', ''], ['C', 'value']],
  );
});

test('refuses configured and inherited secrets without exposing their values', () => {
  const secret = 'STRIPE_SECRET_KEY=sk_do_not_print\nGEMINI_API_KEY=\n';
  assert.throws(
    () => assertNoLocalSecrets(secret, { GEMINI_API_KEY: 'another-secret' }),
    error => error.message.includes('STRIPE_SECRET_KEY')
      && error.message.includes('GEMINI_API_KEY')
      && !error.message.includes('sk_do_not_print')
      && !error.message.includes('another-secret'),
  );
});

test('accepts only the explicit non-secret emulator sentinel', () => {
  assert.doesNotThrow(() => assertNoLocalSecrets(
    `STRIPE_SECRET_KEY=${LOCAL_SECRET_SENTINEL}\n`,
    {},
  ));
});

test('requires every local secret placeholder and no extra bindings', () => {
  const example = `STRIPE_SECRET_KEY=${LOCAL_SECRET_SENTINEL}\nGEMINI_API_KEY=${LOCAL_SECRET_SENTINEL}\n`;
  assert.doesNotThrow(() => assertExactLocalSecretTemplate(example, example));
  assert.throws(
    () => assertExactLocalSecretTemplate(`STRIPE_SECRET_KEY=${LOCAL_SECRET_SENTINEL}\n`, example),
    /missing GEMINI_API_KEY/u,
  );
  assert.throws(
    () => assertExactLocalSecretTemplate(`${example}EXTRA_KEY=${LOCAL_SECRET_SENTINEL}\n`, example),
    /unexpected EXTRA_KEY/u,
  );
  assert.throws(
    () => assertExactLocalSecretTemplate('STRIPE_SECRET_KEY=do-not-print\nGEMINI_API_KEY=LOCAL_EMULATOR_DISABLED\n', example),
    error => error.message.includes('non-sentinel STRIPE_SECRET_KEY') && !error.message.includes('do-not-print'),
  );
});

test('refuses linked local secret files without overwriting their targets', { skip: process.platform === 'win32' }, async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'qs-local-secret-link-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const examplePath = path.join(temporaryDirectory, '.secret.local.example');
  const secretPath = path.join(temporaryDirectory, '.secret.local');
  const outsidePath = path.join(temporaryDirectory, 'outside.env');
  const outsideContents = 'STRIPE_SECRET_KEY=\n';
  await writeFile(examplePath, `STRIPE_SECRET_KEY=${LOCAL_SECRET_SENTINEL}\n`);
  await writeFile(outsidePath, outsideContents);
  await symlink(outsidePath, secretPath);

  await assert.rejects(
    ensureLocalSecretFileAt(secretPath, examplePath, {}),
    /symbolic link/u,
  );
  assert.equal(await readFile(outsidePath, 'utf8'), outsideContents);

  await rm(secretPath);
  await link(outsidePath, secretPath);
  await assert.rejects(
    ensureLocalSecretFileAt(secretPath, examplePath, {}),
    /multiple filesystem links/u,
  );
  assert.equal(await readFile(outsidePath, 'utf8'), outsideContents);
});

test('creates or atomically repairs an ordinary local secret placeholder file', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'qs-local-secret-repair-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const examplePath = path.join(temporaryDirectory, '.secret.local.example');
  const secretPath = path.join(temporaryDirectory, '.secret.local');
  const expectedContents = `STRIPE_SECRET_KEY=${LOCAL_SECRET_SENTINEL}\n`;
  await writeFile(examplePath, expectedContents);

  await ensureLocalSecretFileAt(secretPath, examplePath, {});
  assert.equal(await readFile(secretPath, 'utf8'), expectedContents);

  await writeFile(secretPath, 'STRIPE_SECRET_KEY=\n');
  await ensureLocalSecretFileAt(secretPath, examplePath, {});
  assert.equal(await readFile(secretPath, 'utf8'), expectedContents);
});

test('accepts only a browser-safe Mapbox public token source', () => {
  assert.doesNotThrow(() => assertPublicMapboxTokenSource("export const mapboxAccessToken = 'pk.public-token';"));
  assert.throws(
    () => assertPublicMapboxTokenSource("export const mapboxAccessToken = 'sk.secret-token';"),
    error => error.message.includes('pk.*') && !error.message.includes('sk.secret-token'),
  );
  assert.throws(
    () => assertPublicMapboxTokenSource("export const mapboxAccessToken = 'YOUR_PUBLIC_MAPBOX_TOKEN';"),
    /pk\.\*/u,
  );
});

test('masks inherited cloud credentials in child processes', async () => {
  const isolation = await createIsolatedLocalProcessEnvironment({
    GOOGLE_APPLICATION_CREDENTIALS: '/private/production.json',
    GCLOUD_PROJECT: 'production-project',
  });
  try {
    assert.notEqual(isolation.environment.GOOGLE_APPLICATION_CREDENTIALS, '/private/production.json');
    assert.match(isolation.environment.GOOGLE_APPLICATION_CREDENTIALS, /intentionally-missing-adc\.json$/u);
    assert.equal(isolation.environment.GCLOUD_PROJECT, undefined);
    assert.equal(isolation.environment.GOOGLE_CLOUD_PROJECT, undefined);
    assert.equal(isolation.environment.NO_GCE_CHECK, 'true');
  } finally {
    await isolation.cleanup();
  }
});

test('builds explicit local-only Firebase CLI arguments', () => {
  assert.deepEqual(buildEmulatorArguments(runtimeConfig, false), [
    'emulators:start',
    '--config', 'firebase.local.json',
    '--project', 'demo-quantified-self-local',
    '--only', 'auth,functions,firestore,storage,tasks',
    '--export-on-exit', '.local/firebase-emulator-data',
  ]);
  assert.ok(buildEmulatorArguments(runtimeConfig, true).includes('--import'));
});

test('uses a constant smoke command without interpolating the checkout path', () => {
  assert.equal(LOCAL_SMOKE_CHECK_COMMAND, 'npm run local:smoke:check');
  assert.equal(LOCAL_SMOKE_CHECK_COMMAND.includes(process.cwd()), false);
});

test('launches local tools through Node instead of platform-specific command shims', () => {
  const firebase = buildLocalNodeCommand('firebase', ['--version']);
  const angular = buildLocalNodeCommand('ng', ['version']);
  const functionsBuild = buildLocalNodeCommand('functions-build');

  for (const invocation of [firebase, angular, functionsBuild]) {
    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.args[0].endsWith('.cmd'), false);
  }
  assert.match(firebase.args[0], /firebase-tools[/\\]lib[/\\]bin[/\\]firebase\.js$/u);
  assert.deepEqual(firebase.args.slice(1), ['--version']);
  assert.match(angular.args[0], /@angular[/\\]cli[/\\]bin[/\\]ng\.js$/u);
  assert.match(functionsBuild.args[0], /functions[/\\]scripts[/\\]build\.mjs$/u);
  assert.throws(() => buildLocalNodeCommand('unknown'), /Unknown local command/u);
});

test('keeps the Functions package build on the cross-platform Node script', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'functions', 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.build, 'node scripts/build.mjs');
});

test('rejects legacy runtime configuration and service-account files', () => {
  assert.deepEqual(findForbiddenFunctionSourceFiles([
    '.env',
    'config/.env.production',
    '.runtimeconfig.json',
    'nested/service-account.json',
    'nested/firebase_service_account.json',
    'nested/project-firebase-adminsdk-key.json',
    '.secret.local',
    'package.json',
  ]), [
    '.env',
    '.runtimeconfig.json',
    'config/.env.production',
    'nested/firebase_service_account.json',
    'nested/project-firebase-adminsdk-key.json',
    'nested/service-account.json',
  ]);
});

test('removes only the exact non-symlinked emulator state directory', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'qs-local-reset-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const rootDirectory = path.join(temporaryDirectory, 'repository');
  const statePath = path.join(rootDirectory, '.local', 'firebase-emulator-data');
  await mkdir(statePath, { recursive: true });
  await writeFile(path.join(statePath, 'marker'), 'local');

  await removeLocalStateAt(rootDirectory, statePath);
  await assert.rejects(access(statePath), error => error?.code === 'ENOENT');
});

test('refuses to follow a symbolic local-state parent', { skip: process.platform === 'win32' }, async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'qs-local-reset-link-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const rootDirectory = path.join(temporaryDirectory, 'repository');
  const outsideDirectory = path.join(temporaryDirectory, 'outside');
  const outsideStatePath = path.join(outsideDirectory, 'firebase-emulator-data');
  await mkdir(rootDirectory, { recursive: true });
  await mkdir(outsideStatePath, { recursive: true });
  await writeFile(path.join(outsideStatePath, 'marker'), 'keep');
  await symlink(outsideDirectory, path.join(rootDirectory, '.local'), 'dir');

  await assert.rejects(
    removeLocalStateAt(rootDirectory, path.join(rootDirectory, '.local', 'firebase-emulator-data')),
    /symbolic link/u,
  );
  assert.equal(await readFile(path.join(outsideStatePath, 'marker'), 'utf8'), 'keep');
});

test('refuses saved emulator state containing a nested symbolic link', { skip: process.platform === 'win32' }, async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'qs-local-state-link-'));
  context.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const rootDirectory = path.join(temporaryDirectory, 'repository');
  const statePath = path.join(rootDirectory, '.local', 'firebase-emulator-data');
  const outsideFile = path.join(temporaryDirectory, 'outside.json');
  await mkdir(statePath, { recursive: true });
  await writeFile(outsideFile, '{"keep":true}');
  await symlink(outsideFile, path.join(statePath, 'firestore-export.json'));

  await assert.rejects(
    assertLocalStatePersistencePathAt(rootDirectory, statePath),
    /containing a symbolic link/u,
  );
  assert.equal(await readFile(outsideFile, 'utf8'), '{"keep":true}');
});
