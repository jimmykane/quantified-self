import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'tools/firebase-cli.mjs');
const version = readFileSync(join(root, '.firebase-tools-version'), 'utf8').trim();

test('the selected local Firebase CLI matches the shared exact pin', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const result = spawnSync(process.execPath, [cli, '--version'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), version);
});

test('bootstrap installs the exact shared version in the selected Node environment', t => {
  const directory = mkdtempSync(join(tmpdir(), 'qs-firebase-install-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = join(directory, 'install.json');
  writeFileSync(join(directory, 'npm'), `#!${process.execPath}\n`
    + `require('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  writeFileSync(join(directory, 'firebase'), `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, '--install'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), version);
  assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8')),
    ['install', '--global', `firebase-tools@${version}`, '--no-fund', '--no-audit']);
});

test('a stale Firebase executable is rejected before it receives the requested command', t => {
  const directory = mkdtempSync(join(tmpdir(), 'qs-firebase-version-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = join(directory, 'calls.json');
  writeFileSync(join(directory, 'firebase'), `#!${process.execPath}\n`
    + `require('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)));\n`
    + `console.log('15.31.0');\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, '--help'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /found 15\.31\.0/);
  assert.match(result.stderr, /npm run firebase:tools/);
  assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8')), ['--version']);
});

test('the matching Firebase executable receives arguments unchanged and its failure remains fatal', t => {
  const directory = mkdtempSync(join(tmpdir(), 'qs-firebase-forwarding-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = join(directory, 'calls.json');
  writeFileSync(join(directory, 'firebase'), `#!${process.execPath}\n`
    + `if (process.argv[2] === '--version') console.log(${JSON.stringify(version)});\n`
    + `else { require('node:fs').writeFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))); process.exitCode = 7; }\n`, { mode: 0o755 });
  const args = ['--help', '--config', 'a directory/firebase.json'];
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  });
  assert.equal(result.status, 7);
  assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8')), args);
});

test('the installed Firebase CLI handles a private task queue without IAM bindings', async t => {
  const globalRoot = spawnSync('npm', ['root', '--global'], { encoding: 'utf8' });
  assert.equal(globalRoot.status, 0, globalRoot.stderr);
  const require = createRequire(import.meta.url);
  const tasks = require(join(globalRoot.stdout.trim(), 'firebase-tools/lib/gcp/cloudtasks.js'));
  const policies = [];
  const queue = 'projects/demo-cli-check/locations/europe-west3/queues/synthetic';
  t.mock.method(tasks, 'getIamPolicy', async name => {
    assert.equal(name, queue);
    return { version: 1, etag: 'synthetic' };
  });
  t.mock.method(tasks, 'setIamPolicy', async (name, policy) => {
    assert.equal(name, queue);
    policies.push(policy);
    return policy;
  });
  await tasks.setEnqueuer(queue, ['private']);
  assert.deepEqual(policies, [{ version: 1, etag: 'synthetic', bindings: [] }]);
});
