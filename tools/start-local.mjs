import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertLocalPrerequisites,
  assertPortsAvailable,
  buildLocalNodeCommand,
  buildEmulatorArguments,
  createIsolatedLocalProcessEnvironment,
  ensureEmptyLocalSecretFile,
  ensureLocalStateDirectory,
  hasSavedEmulatorState,
  readLocalRuntimeConfiguration,
  repositoryRoot,
  waitForEmulators,
} from './local-runtime.mjs';

function spawnInherited(invocation, environment) {
  return spawn(invocation.command, invocation.args, {
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

async function runChecked(invocation, environment) {
  const child = spawnInherited(invocation, environment);
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`[local] ${invocation.args[0]} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}.`);
  }
}

async function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  let timeout;
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise(resolve => { timeout = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function startLocalProcesses(runtimeConfig, environment, {
  spawnProcess = spawnInherited,
  waitUntilReady = waitForEmulators,
  signals = process,
} = {}) {
  const firebase = spawnProcess(
    buildLocalNodeCommand(
      'firebase',
      buildEmulatorArguments(runtimeConfig, await hasSavedEmulatorState()),
    ),
    environment,
  );
  const firebaseTermination = observeChildTermination(firebase, 'Firebase emulators');
  let angular;
  let watcher;
  let shutdownPromise;
  const startup = new AbortController();

  const shutdown = (exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      startup.abort();
      if (angular && angular.exitCode === null) {
        angular.kill('SIGINT');
        await waitForExit(angular, 5_000);
      }
      if (watcher && watcher.exitCode === null) {
        watcher.kill('SIGINT');
        await waitForExit(watcher, 5_000);
      }
      if (firebase.exitCode === null) {
        firebase.kill('SIGINT');
        await waitForExit(firebase, 20_000);
      }
      process.exitCode = exitCode;
    })();
    return shutdownPromise;
  };

  const onInterrupt = () => void shutdown(0);
  signals.once('SIGINT', onInterrupt);
  signals.once('SIGTERM', onInterrupt);

  try {
    const startupResult = await Promise.race([
      waitUntilReady(runtimeConfig, 120_000, startup.signal).then(() => ({ ready: true })),
      firebaseTermination.then(termination => ({ ready: false, termination })),
    ]);
    if (!startupResult.ready) {
      if (shutdownPromise) {
        await shutdownPromise;
        return;
      }
      throw new Error(`[local] ${describeChildTermination(startupResult.termination)} before becoming ready.`);
    }
    if (shutdownPromise) {
      await shutdownPromise;
      return;
    }

    watcher = spawnProcess(buildLocalNodeCommand('functions-watch', [
      '--project', path.join(repositoryRoot, 'functions', 'tsconfig.json'), '--watch', '--preserveWatchOutput',
    ]), environment);
    const watcherTermination = observeChildTermination(watcher, 'Functions compiler');

    angular = spawnProcess(
      buildLocalNodeCommand('ng', [
        'serve',
        '--configuration', 'local',
        '--host', runtimeConfig.host,
        '--port', String(runtimeConfig.ports.app),
        '--ssl=false',
      ]),
      environment,
    );
    const angularTermination = observeChildTermination(angular, 'Angular');

    console.info(`\n[local] Application: http://${runtimeConfig.host}:${runtimeConfig.ports.app}`);
    console.info(`[local] Emulator UI: http://${runtimeConfig.host}:${runtimeConfig.ports.ui}`);
    console.info('[local] Billing and all backend provider credentials are disabled. Press Ctrl+C to save emulator state.\n');
    console.info('[local] Functions TypeScript sources are watched automatically. Restart after template or branch changes.');

    const exited = await Promise.race([
      firebaseTermination,
      angularTermination,
      watcherTermination,
    ]);
    if (!shutdownPromise) {
      console.error(`[local] ${describeChildTermination(exited)} unexpectedly.`);
      await shutdown(typeof exited.code === 'number' && exited.code !== 0 ? exited.code : 1);
    } else {
      await shutdownPromise;
    }
  } catch (error) {
    if (startup.signal.aborted && shutdownPromise) {
      await shutdownPromise;
      return;
    }
    await shutdown(1);
    throw error;
  } finally {
    startup.abort();
    signals.off('SIGINT', onInterrupt);
    signals.off('SIGTERM', onInterrupt);
  }
}

async function main() {
  const { runtimeConfig } = await readLocalRuntimeConfiguration();
  await ensureEmptyLocalSecretFile();
  await assertLocalPrerequisites();
  await assertPortsAvailable(runtimeConfig);
  await ensureLocalStateDirectory();
  const isolation = await createIsolatedLocalProcessEnvironment();
  try {
    await runChecked(buildLocalNodeCommand('functions-build'), isolation.environment);
    await startLocalProcesses(runtimeConfig, isolation.environment);
  } finally {
    await isolation.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
