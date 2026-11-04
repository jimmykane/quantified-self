import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

try {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Firebase CLI must have one exact version in .firebase-tools-version.');
  const args = process.argv.slice(2);
  if (args[0] === '--install') {
    if (args.length !== 1) throw new Error('Use npm run firebase:tools without additional arguments.');
    if (!run('npm', ['install', '--global', `firebase-tools@${version}`, '--no-fund', '--no-audit'])) process.exit(process.exitCode);
  }
  const installed = spawnSync('firebase', ['--version'], { encoding: 'utf8', timeout: 15_000 });
  if (installed.error || installed.status !== 0) throw new Error('Firebase CLI is unavailable. Run npm run firebase:tools with your selected Node version.');
  const actual = installed.stdout.trim();
  if (actual !== version) throw new Error(`Firebase CLI ${version} is required; found ${actual}. Run npm run firebase:tools with your selected Node version.`);
  if (args[0] === '--install' || args.length === 1 && args[0] === '--version') console.log(actual);
  else run('firebase', args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
