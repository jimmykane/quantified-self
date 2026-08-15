import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import {
  assertLocalPrerequisites,
  assertPortsAvailable,
  buildEmulatorArguments,
  createIsolatedLocalProcessEnvironment,
  ensureEmptyLocalSecretFile,
  ensureLocalStateDirectory,
  hasSavedEmulatorState,
  localBinary,
  readLocalRuntimeConfiguration,
  repositoryRoot,
  waitForEmulators,
} from './local-runtime.mjs';

function spawnInherited(command, args, environment) {
  return spawn(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
  });
}

function observeChildTermination(child, processName) {
  return new Promise(resolve => {
    child.once('error', error => resolve({ processName, code: null, signal: null, error }));
    child.once('exit', (code, signal) => resolve({ processName, code, signal, error: null }));
  });
}

function describeChildTermination(termination) {
  if (termination.error instanceof Error) {
    return `${termination.processName} failed to start: ${termination.error.message}`;
  }
  if (termination.signal) {
    return `${termination.processName} stopped with ${termination.signal}`;
  }
  return `${termination.processName} stopped with exit code ${termination.code ?? 'unknown'}`;
}

async function runChecked(command, args, environment) {
  const child = spawnInherited(command, args, environment);
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`[local] ${command} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`);
  }
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

async function main() {
  const { runtimeConfig } = await readLocalRuntimeConfiguration();
  await ensureEmptyLocalSecretFile();
  await assertLocalPrerequisites();
  await assertPortsAvailable(runtimeConfig);
  await ensureLocalStateDirectory();
  const isolation = await createIsolatedLocalProcessEnvironment();

  try {
    await runChecked(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['--prefix', 'functions', 'run', 'build'],
      isolation.environment,
    );

    const firebase = spawnInherited(
      localBinary('firebase'),
      buildEmulatorArguments(runtimeConfig, await hasSavedEmulatorState()),
      isolation.environment,
    );
    const firebaseTermination = observeChildTermination(firebase, 'Firebase emulators');
    let angular;
    let shuttingDown = false;

    const shutdown = async (exitCode = 0) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      if (angular && angular.exitCode === null) {
        angular.kill('SIGINT');
        await waitForExit(angular, 5_000);
      }
      if (firebase.exitCode === null) {
        firebase.kill('SIGINT');
        await waitForExit(firebase, 20_000);
      }
      process.exitCode = exitCode;
    };

    process.once('SIGINT', () => void shutdown(0));
    process.once('SIGTERM', () => void shutdown(0));

    try {
      const startupResult = await Promise.race([
        waitForEmulators(runtimeConfig).then(() => ({ ready: true })),
        firebaseTermination.then(termination => ({ ready: false, termination })),
      ]);
      if (!startupResult.ready) {
        if (shuttingDown) {
          return;
        }
        throw new Error(`[local] ${describeChildTermination(startupResult.termination)} before becoming ready.`);
      }

      angular = spawnInherited(localBinary('ng'), [
        'serve',
        '--configuration', 'local',
        '--host', runtimeConfig.host,
        '--port', String(runtimeConfig.ports.app),
        '--ssl=false',
      ], isolation.environment);
      const angularTermination = observeChildTermination(angular, 'Angular');

      console.info(`\n[local] Application: http://${runtimeConfig.host}:${runtimeConfig.ports.app}`);
      console.info(`[local] Emulator UI: http://${runtimeConfig.host}:${runtimeConfig.ports.ui}`);
      console.info('[local] Billing and all backend provider credentials are disabled. Press Ctrl+C to save emulator state.\n');

      const exited = await Promise.race([
        firebaseTermination,
        angularTermination,
      ]);
      if (!shuttingDown) {
        console.error(`[local] ${describeChildTermination(exited)} unexpectedly.`);
        await shutdown(typeof exited.code === 'number' && exited.code !== 0 ? exited.code : 1);
      }
    } catch (error) {
      await shutdown(1);
      throw error;
    }
  } finally {
    await isolation.cleanup();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
