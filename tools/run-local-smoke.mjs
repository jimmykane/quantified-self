import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertLocalPrerequisites,
  assertPortsAvailable,
  buildLocalNodeCommand,
  createIsolatedLocalProcessEnvironment,
  ensureEmptyLocalSecretFile,
  ensureLocalStateDirectory,
  LOCAL_SMOKE_CHECK_COMMAND,
  readLocalSmokeConfiguration,
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
  const { runtimeConfig, firebaseConfig } = await readLocalSmokeConfiguration();
  await ensureEmptyLocalSecretFile();
  await assertLocalPrerequisites({ requireMapbox: false });
  await assertPortsAvailable(runtimeConfig, [
    'auth',
    'functions',
    'firestore',
    'storage',
    'tasks',
    'ui',
    'hub',
  ]);

  // Keep source and config on the same Windows drive so Firebase can resolve
  // the relative Functions source. This directory contains configuration only.
  await ensureLocalStateDirectory();
  const configDirectory = await mkdtemp(path.join(repositoryRoot, '.local', 'smoke-'));
  let isolation;
  try {
    isolation = await createIsolatedLocalProcessEnvironment();
    firebaseConfig.functions.source = path.relative(configDirectory, path.join(repositoryRoot, 'functions'));
    for (const service of ['firestore', 'storage']) {
      firebaseConfig[service].rules = path.join(repositoryRoot, firebaseConfig[service].rules);
    }
    firebaseConfig.firestore.indexes = path.join(repositoryRoot, firebaseConfig.firestore.indexes);
    const configPath = path.join(configDirectory, 'firebase.json');
    await writeFile(configPath, JSON.stringify(firebaseConfig));
    await runChecked(buildLocalNodeCommand('functions-build'), isolation.environment);

    await runChecked(buildLocalNodeCommand('firebase', [
      'emulators:exec',
      '--config', configPath,
      '--project', runtimeConfig.projectId,
      '--only', 'auth,functions,firestore,storage,tasks',
      LOCAL_SMOKE_CHECK_COMMAND,
    ]), isolation.environment);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
    await isolation?.cleanup();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
