import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import {
  assertLocalPrerequisites,
  assertPortsAvailable,
  buildLocalNodeCommand,
  createIsolatedLocalProcessEnvironment,
  ensureEmptyLocalSecretFile,
  LOCAL_SMOKE_CHECK_COMMAND,
  readLocalRuntimeConfiguration,
  repositoryRoot,
} from './local-runtime.mjs';

async function runChecked(invocation, environment) {
  const child = spawn(invocation.command, invocation.args, {
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
  await assertLocalPrerequisites();
  await assertPortsAvailable(runtimeConfig, [
    'auth',
    'functions',
    'firestore',
    'storage',
    'tasks',
    'ui',
    'hub',
  ]);

  const isolation = await createIsolatedLocalProcessEnvironment();
  try {
    await runChecked(buildLocalNodeCommand('functions-build'), isolation.environment);

    await runChecked(buildLocalNodeCommand('firebase', [
      'emulators:exec',
      '--config', 'firebase.local.json',
      '--project', runtimeConfig.projectId,
      '--only', 'auth,functions,firestore,storage,tasks',
      LOCAL_SMOKE_CHECK_COMMAND,
    ]), isolation.environment);
  } finally {
    await isolation.cleanup();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
