import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import paths from '../shared/local-secret-paths.js';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function assertExternalPath(file, root = repositoryRoot) {
  const canonical = value => {
    let existing = resolve(value);
    while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
    return resolve(realpathSync(existing), relative(existing, resolve(value)));
  };
  const rel = relative(canonical(root), canonical(file));
  if (!isAbsolute(file) || rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    throw new Error('Local credential and runtime paths must be outside the checkout.');
  }
}

export function prepareLocalFunctionsRuntime(root = repositoryRoot, environment = process.env) {
  if (environment.CI === 'true' || environment.K_SERVICE || environment.FUNCTION_NAME) {
    throw new Error('Personal emulator profiles are unavailable in CI and deployed runtimes.');
  }
  const local = paths.localSecretPaths(environment);
  for (const file of [local.functions, local.runtime, local.signing]) assertExternalPath(file, root);
  if (environment.QS_LOCAL_SECRETS_FILE && !existsSync(local.functions)) throw new Error('The external emulator secrets profile is unavailable.');
  if (!existsSync(resolve(root, 'functions/lib/functions/src/index.js'))) throw new Error('Build Functions before starting the emulator.');
  mkdirSync(local.runtime, { recursive: true, mode: 0o700 });
  chmodSync(local.runtime, 0o700);
  const directory = mkdtempSync(resolve(local.runtime, 'functions-'));
  try {
    const functions = resolve(directory, 'functions');
    mkdirSync(functions, { mode: 0o700 });
    symlinkSync(resolve(root, 'functions/lib'), resolve(functions, 'lib'), 'dir');
    symlinkSync(resolve(root, 'functions/node_modules'), resolve(functions, 'node_modules'), 'dir');
    writeFileSync(resolve(functions, 'package.json'), readFileSync(resolve(root, 'functions/package.json')));
    if (existsSync(local.functions)) writeFileSync(resolve(functions, '.secret.local'), readFileSync(local.functions), { mode: 0o600 });
    const source = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
    const config = {
      functions: {
        source: 'functions',
        disallowLegacyRuntimeConfig: true,
        ignore: source.functions?.ignore ?? ['node_modules', '.git', '.env*', '.secret*', '**/*service-account*.json', '**/*firebase-adminsdk*.json', '**/*.log'],
        predeploy: ['node -e "console.error(\'Local emulator runtimes cannot be deployed.\');process.exit(1)"'],
      },
      firestore: { ...source.firestore, rules: resolve(root, source.firestore.rules), indexes: resolve(root, source.firestore.indexes) },
      storage: source.storage.map(setting => ({ rules: resolve(root, setting.rules), ...(setting.target ? { target: setting.target } : {}) })),
      emulators: source.emulators,
    };
    const configPath = resolve(directory, 'firebase.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    writeFileSync(resolve(directory, '.firebaserc'), readFileSync(resolve(root, '.firebaserc')));
    return { directory, configPath };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function runLocalFunctions(args, environment = process.env, root = repositoryRoot) {
  const [command = 'emulators:start', ...options] = args;
  if (!['emulators:start', 'emulators:exec', 'functions:shell'].includes(command) || options.some(arg => ['--config', '-c'].includes(arg) || /^(-c|--config)=/.test(arg))) {
    throw new Error('Use emulators:start, emulators:exec or functions:shell; the external runtime manages its own config.');
  }
  const runtime = prepareLocalFunctionsRuntime(root, environment);
  try {
    return await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [resolve(root, 'tools/firebase-cli.mjs'), command, '--config', runtime.configPath, ...options], {
        cwd: root, env: environment, stdio: 'inherit', detached: process.platform !== 'win32',
      });
      const interrupt = signal => {
        if (!child.pid) return;
        try {
          if (process.platform === 'win32') child.kill(signal);
          else process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      };
      const sigint = () => interrupt('SIGINT');
      const sigterm = () => interrupt('SIGTERM');
      const cleanup = () => { process.off('SIGINT', sigint); process.off('SIGTERM', sigterm); };
      process.on('SIGINT', sigint); process.on('SIGTERM', sigterm);
      child.once('error', error => { cleanup(); reject(error); });
      child.once('exit', (code, signal) => { cleanup(); accept(code ?? (signal === 'SIGINT' ? 130 : 143)); });
    });
  } finally {
    rmSync(runtime.directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalFunctions(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
    console.error('Local Functions startup failed. Check the external profile, build output and emulator arguments.');
    process.exitCode = 1;
  });
}
