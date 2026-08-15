import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import {
  assertPortsAvailable,
  createIsolatedLocalProcessEnvironment,
  ensureEmptyLocalSecretFile,
  LOCAL_SMOKE_CHECK_COMMAND,
  localBinary,
  readLocalRuntimeConfiguration,
  repositoryRoot,
} from './local-runtime.mjs';

async function runChecked(command, args, environment) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`[local-smoke] Command failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`);
  }
}

async function main() {
  const { runtimeConfig } = await readLocalRuntimeConfiguration();
  await ensureEmptyLocalSecretFile();
  await Promise.all([
    access(localBinary('firebase')),
    access(path.join(repositoryRoot, 'functions', 'node_modules')),
  ]);
  await assertPortsAvailable(runtimeConfig, [
    'auth',
    'functions',
    'firestore',
    'storage',
    'tasks',
    'ui',
    'hub',
  ]);

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const isolation = await createIsolatedLocalProcessEnvironment();
  try {
    await runChecked(npm, ['--prefix', 'functions', 'run', 'build'], isolation.environment);

    await runChecked(localBinary('firebase'), [
      'emulators:exec',
      '--config', 'firebase.local.json',
      '--project', runtimeConfig.projectId,
      '--only', 'auth,functions,firestore,storage,tasks',
      LOCAL_SMOKE_CHECK_COMMAND,
    ], isolation.environment);
  } finally {
    await isolation.cleanup();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
