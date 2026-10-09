import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkPolicy, isExplicitOrdinarySpec } from './frontend-test-policy.mjs';

const cli = fileURLToPath(new URL('./frontend-test-policy-cli.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), 'qs-test-policy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(file, source = '') {
    mkdirSync(dirname(resolve(root, file)), { recursive: true });
    writeFileSync(resolve(root, file), source);
    return file;
  }
  function check(specs, overrides = {}) {
    return checkPolicy({ root, specs, baseFiles: [], baseRegistry: { node: [], dom: [] }, reasons: {}, ...overrides });
  }
  return { root, write, check };
}
const angular = 'src/app/components/example.component.spec.ts';
const helper = 'src/app/helpers/example.helper.spec.ts';
const reason = { environment: 'angular', reason: 'Renders input bindings and verifies component teardown.' };

test('explicit opt-ins support hidden/shared/root specs without widening ordinary exclusions', () => {
  for (const file of [helper, 'shared/future.spec.ts', 'scripts/future.spec.ts', 'future.spec.ts',
    '.hidden/future.spec.ts', 'src/app/helpers/.future.spec.ts']) assert(isExplicitOrdinarySpec(file), file);
  for (const file of ['../outside.spec.ts', '/absolute.spec.ts', './relative.spec.ts', 'src//duplicate.spec.ts',
    'src/**/*.spec.ts', 'src/[ab].spec.ts', 'src/{a,b}.spec.ts', 'functions/src/future.spec.ts',
    'node_modules/future.spec.ts', 'scripts/node_modules/future.spec.ts', 'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts']) {
    assert.equal(isExplicitOrdinarySpec(file), false, file);
  }
});

test('new specs require classification; grandfathered Angular specs keep their fallback', t => {
  const { write, check } = fixture(t);
  write(angular);
  assert.match(check([{ file: angular, project: 'angular' }]).errors[0], /new Angular spec/);
  assert.deepEqual(check([{ file: angular, project: 'angular' }], { reasons: { [angular]: reason } }).errors, []);
  assert.deepEqual(check([{ file: angular, project: 'angular' }], { baseFiles: [angular] }).errors, []);
  write(helper, 'export const data = 1;');
  for (const project of ['helpers-node', 'helpers-dom']) assert.deepEqual(check([{ file: helper, project }]).errors, []);
});

test('heavier reclassification needs a reason matching the selected environment', t => {
  const { write, check } = fixture(t);
  write(helper);
  for (const [from, to] of [['node', 'helpers-dom'], ['node', 'angular'], ['dom', 'angular']]) {
    const options = { baseFiles: [helper], baseRegistry: { [from]: [helper] } };
    assert.match(check([{ file: helper, project: to }], options).errors[0], /needs review/);
    assert.deepEqual(check([{ file: helper, project: to }], { ...options,
      reasons: { [helper]: { environment: to, reason: 'Verifies browser locale or actual Angular integration.' } } }).errors, []);
  }
  assert.deepEqual(check([{ file: helper, project: 'helpers-node' }], { baseFiles: [helper] }).errors, []);
});

test('stale, mismatched, vague and unsorted reason records fail', t => {
  const { write, check } = fixture(t);
  write(angular);
  const specs = [{ file: angular, project: 'angular' }];
  for (const entry of [{ ...reason, reason: 'needed' }, { ...reason, extra: true }, { ...reason, environment: 'helpers-node' }, null]) {
    assert(check(specs, { reasons: { [angular]: entry } }).errors.length > 0);
  }
  assert.match(check(specs, { reasons: { [helper]: reason } }).errors[0], /stale or mismatched/);
  assert.match(check(specs, { reasons: { [angular]: { ...reason, environment: 'helpers-dom' } } }).errors[0], /mismatched/);
  assert.throws(() => check(specs, { reasons: { z: reason, a: reason } }), /sorted/);
});

test('runtime testing/compiler/setup imports fail in both lighter environments', t => {
  const { write, check } = fixture(t);
  const sources = [
    "import { TestBed as Bed } from '@angular/core/testing'; Bed.inject(Object);",
    "import { HttpTestingController } from '@angular/common/http/testing';",
    "export { provideHttpClientTesting } from '@angular/common/http/testing';",
    "void import('@angular/common/http/testing');",
    "import '@angular/compiler';",
    "export { TestBed } from '@angular/core/testing';",
    "void import('@angular/platform-browser-dynamic/testing');",
    "require('zone.js/testing');",
    "import '@analogjs/vitest-angular/setup-testbed';",
    "vi.importActual('@angular/core/testing');",
    "vi.mock('@angular/core/testing', () => ({}));",
    "import {} from '@angular/core/testing';",
    "export {} from '@angular/compiler';",
    "import Testing = require('@angular/core/testing');",
  ];
  for (const source of sources) {
    write(helper, source);
    for (const project of ['helpers-node', 'helpers-dom']) assert.match(check([{ file: helper, project }]).errors[0], /must not load Angular/);
  }
  write('src/test-setup.ts');
  write(helper, "import '../../test-setup';");
  assert.match(check([{ file: helper, project: 'helpers-node' }]).errors[0], /global setup/);
});

test('literal indexed framework mocks are inspected in both lighter environments', t => {
  const { write, check } = fixture(t);
  for (const source of [
    "vi['mock']('@angular/core/testing', () => ({}));",
    "vi[`importActual`]('@angular/common/http/testing');",
    "vi['doMock']('@analogjs/vitest-angular/setup-testbed', () => ({}));",
  ]) {
    write(helper, source);
    for (const project of ['helpers-node', 'helpers-dom']) {
      assert.match(check([{ file: helper, project }]).errors[0], /must not load Angular/);
    }
  }
});

test('transitive imports, aliases and cycles cannot hide framework setup', t => {
  const { write, check } = fixture(t);
  write(helper, "import './bridge';");
  write('src/app/helpers/bridge.ts', "import 'app/helpers/cycle'; import '@shared/runtime';");
  write('src/app/helpers/cycle.ts', "import './bridge';");
  write('shared/runtime.ts', "import '@angular/core/testing';");
  const errors = check([{ file: helper, project: 'helpers-node' }]).errors;
  assert.equal(errors.length, 1);
  assert.match(errors[0], /shared\/runtime.ts imports @angular\/core\/testing/);
});

test('local JavaScript runtime imports are inspected instead of their declaration files', t => {
  const { write, check } = fixture(t);
  for (const [runtime, declaration] of [
    ['bridge.js', 'bridge.d.ts'], ['bridge.mjs', 'bridge.d.mts'], ['bridge.cjs', 'bridge.d.cts'],
  ]) {
    write(`shared/${runtime}`, "import '@angular/common/http/testing'; export const value = 1;");
    write(`shared/${declaration}`, "import type { ComponentFixture } from '@angular/core/testing'; export declare const value: ComponentFixture<unknown>;");
    write(helper, `import { value } from '@shared/${runtime}';`);
    for (const project of ['helpers-node', 'helpers-dom']) {
      const errors = check([{ file: helper, project }]).errors;
      assert.equal(errors.length, 1);
      assert(errors[0].includes(`shared/${runtime} imports @angular/common/http/testing`));
    }
    write(`shared/${runtime}`, 'export const value = 1;');
    assert.deepEqual(check([{ file: helper, project: 'helpers-node' }]).errors, []);
  }
});

test('type-only imports and plain Angular core decorators do not require Angular setup', t => {
  const { write, check } = fixture(t);
  write(helper, "import type { ComponentFixture } from '@angular/core/testing';\nimport { type TestBed } from '@angular/core/testing';\nexport type { TestBed } from '@angular/core/testing';\nimport type { HttpTestingController } from '@angular/common/http/testing';\nimport { Injectable } from '@angular/core';");
  assert.deepEqual(check([{ file: helper, project: 'helpers-node' }]).errors, []);
});

test('shared fixture hooks produce review warnings, not bans on legitimate rendering', t => {
  const { write, check } = fixture(t);
  const options = { baseFiles: [angular], changedFiles: [angular] };
  write(angular, "import { beforeEach as setup } from 'vitest'; setup(() => { TestBed.createComponent(Component); fixture.detectChanges(); });");
  assert.equal(check([{ file: angular, project: 'angular' }], options).warnings.length, 1);
  assert.deepEqual(check([{ file: angular, project: 'angular' }], options).errors, []);
  assert.equal(check([{ file: angular, project: 'angular' }], { baseFiles: [angular] }).warnings.length, 0);
  write(angular, 'beforeEach(() => { mock = {}; }); it("renders", () => { TestBed.createComponent(Component); fixture.detectChanges(); });');
  assert.equal(check([{ file: angular, project: 'angular' }], options).warnings.length, 0);
});

test('invalid source fails inspection instead of silently losing imports', t => {
  const { write, check } = fixture(t);
  write(helper, 'import {');
  assert.throws(() => check([{ file: helper, project: 'helpers-node' }]), /invalid source/);
});

test('CLI uses a merge base, catches hidden/new specs and fails when comparison is unavailable', t => {
  const { root, write } = fixture(t);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']);
  git(['config', 'user.email', 'tests@example.invalid']);
  git(['config', 'user.name', 'Policy test']);
  write('tools/frontend-test-environments.json', '{"node":[],"dom":[]}');
  write('tools/frontend-test-environment-reasons.json', '{}');
  write(angular);
  const exclude = ['functions/**', 'node_modules/**', 'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'];
  const angularConfig = `export default {test:{include:['**/*.spec.ts'],exclude:${JSON.stringify(exclude)},projects:[{test:{name:'angular',include:['**/*.spec.ts'],exclude:${JSON.stringify(exclude)}}}]}};`;
  write('vitest.config.ts', angularConfig);
  git(['add', '.']);
  git(['commit', '--no-gpg-sign', '-m', 'test: initial fixtures']);
  const base = git(['rev-parse', 'HEAD']);
  const run = (revision, env = {}) => spawnSync(process.execPath, [cli, '--base', revision], { cwd: root, encoding: 'utf8', env: { ...process.env, QS_FRONTEND_TEST_POLICY_BASE: 'invalid-ignored-by-explicit-base', ...env } });
  assert.equal(run(base).status, 0);
  const hidden = write('src/app/helpers/.new.spec.ts');
  write('functions/src/ignored.spec.ts');
  write('src/firestore.rules.spec.ts');
  assert.match(run(base).stderr, /\.new\.spec\.ts: new Angular spec/);
  write('tools/frontend-test-environment-reasons.json', JSON.stringify({ [hidden]: reason }));
  assert.equal(run(base).status, 0);
  write('vitest.config.ts', `export default {test:{include:['**/*.spec.ts'],exclude:${JSON.stringify(exclude)},projects:[{test:{name:'helpers-node',include:[${JSON.stringify(hidden)}],exclude:${JSON.stringify(exclude)}}},{test:{name:'angular',include:['**/*.spec.ts'],exclude:${JSON.stringify([...exclude, hidden])}}}]}};`);
  assert.match(run(base).stderr, /mismatched environment reason/);
  write('tools/frontend-test-environment-reasons.json', '{}');
  assert.equal(run(base).status, 0, 'Hidden specs can explicitly choose Node without an Angular exception');
  write('vitest.config.ts', angularConfig);
  write('tools/frontend-test-environment-reasons.json', JSON.stringify({ [hidden]: reason }));
  git(['add', '.']);
  git(['commit', '--no-gpg-sign', '-m', 'test: add classified spec']);
  // Subsequent pushes cannot grandfather a new unclassified file by comparing only with the previous push.
  write('tools/frontend-test-environment-reasons.json', '{}');
  assert.equal(run(base).status, 1);
  assert.match(run('missing-reference').stderr, /comparison must not be skipped/);
  write('tools/frontend-test-environment-reasons.json', JSON.stringify({ [hidden]: reason }));
  write(angular, 'beforeEach(() => fixture.detectChanges());');
  const annotated = run(base, { GITHUB_ACTIONS: 'true' });
  assert.equal(annotated.status, 0);
  assert.match(annotated.stdout, /::warning::Review fixture setup/);
  write(angular);
  const feature = git(['rev-parse', 'HEAD']);
  git(['checkout', '-b', 'upstream', base]);
  write(hidden);
  git(['add', '.']);
  git(['commit', '--no-gpg-sign', '-m', 'test: advance comparison branch']);
  git(['checkout', '--detach', feature]);
  write('tools/frontend-test-environment-reasons.json', '{}');
  assert.match(run('upstream').stderr, /\.new\.spec\.ts: new Angular spec/, 'Use the common ancestor, not files added independently on the base branch');
});
