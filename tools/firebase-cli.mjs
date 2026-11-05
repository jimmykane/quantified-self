import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = readFileSync(new URL('../.firebase-tools-version', import.meta.url), 'utf8').trim();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return false;
  }
  process.exitCode = result.status ?? 1;
  return result.status === 0;
}

async function runLocal(command, args) {
  const child = spawn(command, args, { stdio: 'inherit' });
  // Windows console signals already reach the CLI. child.kill() would instead
  // terminate it immediately and orphan Java emulators before state export.
  const interrupt = () => { if (process.platform !== 'win32') child.kill('SIGINT'); };
  const terminate = () => { if (process.platform !== 'win32') child.kill('SIGTERM'); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
        resolve();
      });
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
}

try {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Firebase CLI must have one exact version in .firebase-tools-version.');
  const args = process.argv.slice(2);
  // The isolated contributor runtime uses the dependency installed by npm ci.
  // It shares the same version check as the global maintainer/CI executable.
  const local = args[0] === '--local';
  if (local) args.shift();
  const command = local ? process.execPath : 'firebase';
  const prefix = local ? [fileURLToPath(new URL('../node_modules/firebase-tools/lib/bin/firebase.js', import.meta.url))] : [];
  if (args[0] === '--install') {
    if (args.length !== 1) throw new Error('Use npm run firebase:tools without additional arguments.');
    if (!run('npm', ['install', '--global', `firebase-tools@${version}`, '--no-fund', '--no-audit'])) process.exit(process.exitCode);
  }
  const repair = local ? 'npm ci' : 'npm run firebase:tools';
  const installed = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8', timeout: 15_000 });
  if (installed.error || installed.status !== 0) throw new Error(`Firebase CLI is unavailable. Run ${repair} with your selected Node version.`);
  const actual = installed.stdout.trim();
  if (actual !== version) throw new Error(`Firebase CLI ${version} is required; found ${actual}. Run ${repair} with your selected Node version.`);
  if (args[0] === '--install' || args.length === 1 && args[0] === '--version') console.log(actual);
  else if (local) await runLocal(command, [...prefix, ...args]);
  else run(command, args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
