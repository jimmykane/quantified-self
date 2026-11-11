import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { angularBuildArguments, readBuildMetadata } from './angular-build.mjs';

const commit = 'a'.repeat(40);
const environment = { GITHUB_ACTIONS: 'true', GITHUB_SHA: commit, GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2' };
const git = (status = '') => args => args[0] === 'rev-parse' ? commit : status;

test('GitHub identity verifies the actual checkout and distinguishes attempts of the same version', () => {
  assert.deepEqual(readBuildMetadata({ environment, git: git() }), { commit, run: '123456.2', dirty: false });
  assert.deepEqual(readBuildMetadata({ environment: { ...environment, GITHUB_RUN_ATTEMPT: '3' }, git: git(' M src/manifest.json') }),
    { commit, run: '123456.3', dirty: true });
  assert.throws(() => readBuildMetadata({ environment: { ...environment, GITHUB_SHA: 'b'.repeat(40) }, git: git() }), /does not match/);
});

test('missing or invalid CI identity fails instead of labelling a build with a stale commit', () => {
  assert.throws(() => readBuildMetadata({ environment, git: () => { throw Error('not a checkout'); } }), /Cannot verify/);
  assert.throws(() => readBuildMetadata({ environment, git: () => 'private invalid value' }), /Invalid build commit/);
  assert.throws(() => readBuildMetadata({ environment, git: () => commit + '\n' }), /Invalid build commit/);
  for (const field of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) {
    assert.throws(() => readBuildMetadata({ environment: { ...environment, [field]: undefined }, git: git() }), /Invalid GitHub build run/);
    assert.throws(() => readBuildMetadata({ environment: { ...environment, [field]: 'private invalid value' }, git: git() }), /Invalid GitHub build run/);
    assert.throws(() => readBuildMetadata({ environment: { ...environment, [field]: '123\n' }, git: git() }), /Invalid GitHub build run/);
  }
});

test('local builds identify uncommitted sources and archives honestly', () => {
  assert.deepEqual(readBuildMetadata({ environment: {}, git: git('?? scratch.ts') }), { commit, run: 'local', dirty: true });
  assert.deepEqual(readBuildMetadata({ environment: { GITHUB_SHA: 'ignored' }, git: git() }), { commit, run: 'local', dirty: false });
  assert.deepEqual(readBuildMetadata({ environment: {}, git: () => { throw Error('archive'); } }),
    { commit: 'unknown', run: 'local', dirty: undefined });
});

test('passes quoted constants as literal Angular arguments without a shell or source-file generation', () => {
  const metadata = { commit, run: '123456.2', dirty: true };
  assert.deepEqual(angularBuildArguments(['--configuration', 'production'], metadata), ['build', '--configuration', 'production',
    `--define=QS_BUILD_COMMIT="${commit}"`, '--define=QS_BUILD_RUN="123456.2"', '--define=QS_BUILD_DIRTY=true']);
  for (const name of ['COMMIT', 'RUN', 'DIRTY']) {
    for (const override of [`QS_BUILD_${name}=false`, `--define=QS_BUILD_${name}=false`]) {
      assert.throws(() => angularBuildArguments([override], metadata), /cannot be overridden/);
    }
  }
});

test('the installed Angular CLI accepts all definitions without mistaking them for a project name', () => {
  const result = spawnSync(process.execPath, ['node_modules/@angular/cli/bin/ng.js',
    ...angularBuildArguments(['--configuration', 'production', '--help'], { commit, run: '123456.2', dirty: false })],
  { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--define/);
  assert.doesNotMatch(result.stderr, /Unknown arguments|does not exist/);
});

test('all npm Hosting builds use the same metadata entry point and keep release/source-map identity', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of ['build', 'build-beta', 'build-production']) {
    assert.match(scripts[name], /node tools\/angular-build\.mjs/);
    assert.doesNotMatch(scripts[name], /\bng build\b/);
  }
  assert.match(scripts['test:workflows'], /angular-build\.test\.mjs/);
  assert.match(scripts['sentry:upload-sourcemaps'], /--release/);
  assert.doesNotMatch(scripts['sentry:upload-sourcemaps'], /--dist/);
});

test('esbuild inlines the build constants into the actual Sentry-tag helper', () => {
  const source = readFileSync(new URL('../src/app/helpers/sentry-build-tags.helper.ts', import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', define: {
    QS_BUILD_COMMIT: JSON.stringify(commit), QS_BUILD_RUN: '"123456.2"', QS_BUILD_DIRTY: 'false',
  } });
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports });
  assert.deepEqual(JSON.parse(JSON.stringify(module.exports.getSentryBuildTags())), {
    build_commit: commit, build_run: '123456.2', build_dirty: 'false',
  });
});
