import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, realpathSync, copyFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import paths from '../shared/local-secret-paths.js';
import { assertExternalPath, localEmulatorDataArguments, prepareLocalFunctionsRuntime, runLocalFunctions } from './local-functions.mjs';

test('external paths are independent of checkout or working directory and reject relative overrides', () => {
  const config = paths.localSecretPaths({ QS_LOCAL_CONFIG_DIR: '/private/config' });
  assert.equal(config.functions, '/private/config/functions.env');
  assert.equal(config.signing, '/private/config/firebase-adminsdk.json');
  assert.equal(config.billing, '/private/config/billing-test.env');
  assert.throws(() => paths.localSecretPaths({ QS_LOCAL_SECRETS_FILE: 'relative.env' }), /absolute/);
  assert.throws(() => assertExternalPath('/checkout/local.env', '/checkout'), /outside/);
});

test('the emulator profile is restricted to an external runtime while compiled code keeps live rebuild links', t => {
  const base = mkdtempSync(join(tmpdir(), 'qs-functions-runtime-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'checkout');
  const directory = join(base, 'private');
  mkdirSync(join(root, 'functions/lib/functions/src'), { recursive: true });
  mkdirSync(join(root, 'functions/node_modules'), { recursive: true });
  mkdirSync(directory);
  writeFileSync(join(directory, 'functions.env'), 'SYNTHETIC=private-fixture\n');
  writeFileSync(join(root, 'functions/lib/functions/src/index.js'), '');
  writeFileSync(join(root, 'functions/package.json'), '{"main":"lib/functions/src/index.js"}');
  writeFileSync(join(root, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: [{ rules: 'storage.rules' }], emulators: {} }));
  writeFileSync(join(root, '.firebaserc'), '{}');
  const runtime = prepareLocalFunctionsRuntime(root, { QS_LOCAL_CONFIG_DIR: directory });
  assert.ok(runtime.directory.startsWith(join(directory, 'runtime')));
  assert.equal(statSync(join(runtime.directory, 'functions/.secret.local')).mode & 0o777, 0o600);
  assert.equal(statSync(runtime.directory).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(runtime.directory, 'functions/.secret.local'), 'utf8'), 'SYNTHETIC=private-fixture\n');
  assert.equal(realpathSync(join(runtime.directory, 'functions/lib')), realpathSync(join(root, 'functions/lib')));
  const config = JSON.parse(readFileSync(runtime.configPath, 'utf8'));
  assert.equal(config.firestore.rules, join(root, 'firestore.rules'));
  assert.equal(config.extensions, undefined);
  assert.ok(config.functions.ignore.includes('.secret*'));
  const denied = spawnSync(config.functions.predeploy[0], { shell: true, encoding: 'utf8' });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /Local emulator runtimes cannot be deployed/);
  assert.throws(() => prepareLocalFunctionsRuntime(root, { CI: 'true', QS_LOCAL_CONFIG_DIR: directory }), /unavailable/);
});

test('the development wrapper cannot deploy or accept another runtime config', async () => {
  await assert.rejects(runLocalFunctions(['deploy']), /Use emulators/);
  await assert.rejects(runLocalFunctions(['emulators:start', '--config=other.json']), /own config/);
});

test('emulator data paths stay persistent outside the checkout and disposable runtime', () => {
  const environment = { QS_LOCAL_CONFIG_DIR: '/private/profiles' };
  const args = localEmulatorDataArguments(['--export-on-exit', '--only', 'firestore'], '/checkout', environment);
  assert.match(args[0], /^--export-on-exit=\/private\/profiles\/emulator-state\//);
  assert.deepEqual(args.slice(1), ['--only', 'firestore']);
  assert.deepEqual(localEmulatorDataArguments(['--import', '../saved'], '/checkout', environment), ['--import=/saved']);
  assert.throws(() => localEmulatorDataArguments(['--export-on-exit=state'], '/checkout', environment), /outside/);
  assert.throws(() => localEmulatorDataArguments(['--import'], '/checkout', environment), /required/);
});

test('the actual pinned launcher preserves failure status and removes its runtime after the child exits', async t => {
  const base = mkdtempSync(join(tmpdir(), 'qs-runtime-launch-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'checkout'); const external = join(base, 'private');
  for (const dir of ['functions/lib/functions/src', 'functions/node_modules', 'tools', 'bin']) mkdirSync(join(root, dir), { recursive: true });
  mkdirSync(external);
  writeFileSync(join(root, 'functions/lib/functions/src/index.js'), '');
  writeFileSync(join(root, 'functions/package.json'), '{}');
  writeFileSync(join(root, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: [], emulators: {} }));
  writeFileSync(join(root, '.firebaserc'), '{}');
  writeFileSync(join(external, 'functions.env'), 'SYNTHETIC=fixture\n');
  copyFileSync(new URL('./firebase-cli.mjs', import.meta.url), join(root, 'tools/firebase-cli.mjs'));
  copyFileSync(new URL('../.firebase-tools-version', import.meta.url), join(root, '.firebase-tools-version'));
  const version = readFileSync(join(root, '.firebase-tools-version'), 'utf8').trim();
  writeFileSync(join(root, 'bin/firebase'), `#!${process.execPath}\n`
    + `if(process.argv[2]==='--version')console.log(${JSON.stringify(version)});else process.exitCode=7;\n`, { mode: 0o755 });
  const code = await runLocalFunctions(['emulators:exec', 'synthetic command'], {
    QS_LOCAL_CONFIG_DIR: external, PATH: `${join(root, 'bin')}:${process.env.PATH}`,
  }, root);
  assert.equal(code, 7);
  assert.deepEqual(readdirSync(join(external, 'runtime')), []);
});

test('an interrupted local launcher shuts down its child group and cleans up the external runtime', async t => {
  const base = mkdtempSync(join(tmpdir(), 'qs-runtime-interrupt-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'checkout'); const external = join(base, 'private');
  for (const dir of ['functions/lib/functions/src', 'functions/node_modules', 'tools', 'bin']) mkdirSync(join(root, dir), { recursive: true });
  mkdirSync(external);
  writeFileSync(join(root, 'functions/lib/functions/src/index.js'), '');
  writeFileSync(join(root, 'functions/package.json'), '{}');
  writeFileSync(join(root, 'firebase.json'), JSON.stringify({ firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, storage: [], emulators: {} }));
  writeFileSync(join(root, '.firebaserc'), '{}');
  writeFileSync(join(external, 'functions.env'), 'SYNTHETIC=fixture\n');
  copyFileSync(new URL('./firebase-cli.mjs', import.meta.url), join(root, 'tools/firebase-cli.mjs'));
  copyFileSync(new URL('../.firebase-tools-version', import.meta.url), join(root, '.firebase-tools-version'));
  const version = readFileSync(join(root, '.firebase-tools-version'), 'utf8').trim();
  const ready = join(base, 'ready');
  writeFileSync(join(root, 'bin/firebase'), `#!${process.execPath}\n`
    + `if(process.argv[2]==='--version')console.log(${JSON.stringify(version)});else {require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);}\n`, { mode: 0o755 });
  const driver = join(base, 'driver.mjs');
  writeFileSync(driver, `import {runLocalFunctions} from ${JSON.stringify(new URL('./local-functions.mjs', import.meta.url).href)};process.exitCode=await runLocalFunctions(['emulators:start'],process.env,${JSON.stringify(root)});`);
  const child = spawn(process.execPath, [driver], { env: { QS_LOCAL_CONFIG_DIR: external, PATH: `${join(root, 'bin')}:${process.env.PATH}` }, stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  const exited = new Promise((accept, reject) => { child.once('exit', (code, signal) => accept({ code, signal })); child.once('error', reject); });
  for (let n = 0; n < 200 && !existsSync(ready) && child.exitCode === null; n++) await setTimeout(25);
  assert.ok(existsSync(ready), 'The synthetic emulator must start before interruption');
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 143, signal: null });
  assert.deepEqual(readdirSync(join(external, 'runtime')), []);
});
