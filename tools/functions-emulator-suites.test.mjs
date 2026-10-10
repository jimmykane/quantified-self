import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { globSync } from 'tinyglobby';
import { loadConfigFromFile } from 'vite';
import { configDefaults } from 'vitest/config';
import { assertEmulatorOnlySpec } from './functions-emulator-spec-policy.mjs';
import { assertExecutedReport, assertLoopbackEmulators, assertSuiteCoverage, discoverEmulatorSpecs,
  emulatorEnvironment, EMULATOR_SUITES, suiteFiles } from './functions-emulator-suites.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const functionsRoot = resolve(root, 'functions');
const unit = (await loadConfigFromFile({ command: 'serve', mode: 'test' },
  resolve(functionsRoot, 'vitest.config.ts'))).config;
const emulator = (await loadConfigFromFile({ command: 'serve', mode: 'test' },
  resolve(functionsRoot, 'vitest.emulators.config.ts'))).config;
const registered = Object.values(EMULATOR_SUITES).flat().sort();
const discover = (config, cwd = functionsRoot) => globSync(config.test.include, {
  cwd, ignore: config.test.exclude, dot: true, expandDirectories: false,
}).sort();

test('unit and emulator configurations partition all Functions specs exactly once', () => {
  const all = globSync('src/**/*.spec.ts', {
    cwd: functionsRoot, ignore: configDefaults.exclude, dot: true,
  }).sort();
  const ordinary = discover(unit);
  const realEmulators = discover(emulator);
  assert.deepEqual(realEmulators, registered);
  assert.deepEqual(ordinary, all.filter(file => !registered.includes(file)));
  assert.deepEqual([...ordinary, ...realEmulators].sort(), all);
  assert.equal(new Set([...ordinary, ...realEmulators]).size, all.length);
  assert.equal(unit.test.root ?? unit.root, functionsRoot);
  assert.equal(emulator.test.root ?? emulator.root, functionsRoot);
  assert.equal(emulator.test.maxWorkers, 1);
  assert.equal(emulator.test.minWorkers, 1);
  assert.equal(emulator.test.fileParallelism, false);
  assert.deepEqual(emulator.test.exclude, [...configDefaults.exclude]);
  for (const config of [unit, emulator]) {
    assert.equal(config.test.pool, 'forks');
    assert.notEqual(config.test.isolate, false);
    assert.notEqual(config.test.dangerouslyIgnoreUnhandledErrors, true);
    assert.notEqual(config.test.passWithNoTests, true);
    assert.deepEqual(config.test.setupFiles, [resolve(functionsRoot, 'src/test-setup.ts')]);
  }
});

test('future and hidden unit specs remain discoverable while exact emulator paths stay excluded', t => {
  const fixture = mkdtempSync(resolve(tmpdir(), 'qs-functions-partition-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const future = ['src/new.spec.ts', 'src/queue-integration.spec.ts', 'src/.hidden/unit.spec.ts', 'src/.unit.spec.ts'];
  for (const file of [...future, ...registered, 'node_modules/dependency/src/unit.spec.ts',
    'src/node_modules/dependency/unit.spec.ts', 'src/.git/unit.spec.ts']) {
    mkdirSync(dirname(resolve(fixture, file)), { recursive: true });
    writeFileSync(resolve(fixture, file), '');
  }
  assert.deepEqual(discover(unit, fixture), future.sort());
  assert.deepEqual(discover(emulator, fixture), registered);
});

test('every excluded file contains emulator-gated tests without mixed unit registrations', () => {
  for (const file of registered) assertEmulatorOnlySpec(readFileSync(resolve(functionsRoot, file), 'utf8'), file);
});

test('mixed, aliased and parameterized unit registrations cannot hide in emulator-only files', () => {
  const imports = 'import { describe, it, test as check } from "vitest";';
  const gated = 'describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("real", () => { it("emulator", () => {}); });';
  for (const extra of ['it("unit", () => {});', 'check.each([1])("unit", () => {});',
    'describe("unit", () => { it("ordinary", () => {}); });', 'check.todo("unit");']) {
    assert.throws(() => assertEmulatorOnlySpec(imports + gated + extra, 'mixed.spec.ts'), /Mixed unit\/emulator/);
  }
  assert.throws(() => assertEmulatorOnlySpec(imports
    + 'describe.skipIf(!!process.env.FIRESTORE_EMULATOR_HOST)("inverted", () => { it("unit", () => {}); });',
  'inverted.spec.ts'), /Mixed unit\/emulator/);
  assertEmulatorOnlySpec(imports + 'const host = process.env.FIRESTORE_EMULATOR_HOST;'
    + 'describe.skipIf(!host)("real", () => { check.each([1])("emulator", () => {}); });', 'alias.spec.ts');
  assertEmulatorOnlySpec('import * as v from "vitest";'
    + 'v.describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("real", () => { v.it("emulator", () => {}); });',
  'namespace.spec.ts');
  assert.throws(() => assertEmulatorOnlySpec(gated + 'test("global unit", () => {});', 'globals.spec.ts'),
    /Mixed unit\/emulator/);
  assert.throws(() => assertEmulatorOnlySpec('import * as v from "vitest";' + gated
    + 'v["test"]("unit", () => {});', 'namespace-unit.spec.ts'), /Mixed unit\/emulator/);
  assert.throws(() => assertEmulatorOnlySpec(imports + 'let host = process.env.FIRESTORE_EMULATOR_HOST;'
    + 'describe.skipIf(!host)("mutable", () => { it("test", () => {}); });', 'mutable.spec.ts'),
  /Mixed unit\/emulator/);
});

test('all emulator entry points select the emulator configuration', () => {
  const runner = readFileSync(resolve(root, 'tools/test-functions-emulators.mjs'), 'utf8');
  assert.match(runner, /'--config', join\(functionsRoot, 'vitest\.emulators\.config\.ts'\)/);
  const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
  for (const name of ['test:disconnect', 'test:training-delivery']) {
    assert.match(scripts[name], /--config functions\/vitest\.emulators\.config\.ts/);
  }
});

test('every real emulator/integration file is registered exactly once', () => {
  assertSuiteCoverage(discoverEmulatorSpecs(functionsRoot));
  assert.throws(() => assertSuiteCoverage(['src/new.emulator.spec.ts'], {}), /Unregistered/);
  assert.throws(() => assertSuiteCoverage([], { stale: ['removed'] }), /Missing files/);
  assert.throws(() => assertSuiteCoverage(['a'], { first: ['a'], second: ['a'] }), /Duplicate/);
  assert.throws(() => assertSuiteCoverage([], { empty: [] }), /Empty/);
  assert.throws(() => suiteFiles('all_connected'), /Unknown emulator group/);
  assert.throws(() => suiteFiles('__proto__'), /Unknown emulator group/);
});

test('emulator host consumers cannot disappear behind an ordinary spec filename', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'qs-emulator-discovery-'));
  try {
    mkdirSync(resolve(temporary, 'src/nested'), { recursive: true });
    writeFileSync(resolve(temporary, 'src/nested/legacy.spec.ts'),
      'describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)("legacy", () => {});');
    writeFileSync(resolve(temporary, 'src/auth.spec.ts'),
      'const enabled = !!process.env.FIREBASE_AUTH_EMULATOR_HOST;');
    writeFileSync(resolve(temporary, 'src/named.emulator.spec.ts'), 'describe("named", () => {});');
    writeFileSync(resolve(temporary, 'src/unit.spec.ts'), 'describe("mocked", () => {});');
    const discovered = discoverEmulatorSpecs(temporary);
    assert.deepEqual(discovered, ['src/auth.spec.ts', 'src/named.emulator.spec.ts', 'src/nested/legacy.spec.ts']);
    assert.throws(() => assertSuiteCoverage(discovered, { named: ['src/named.emulator.spec.ts'] }), /Unregistered/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('CI matrix gates every registered group, including the 400-workout stress test', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/_run-tests.yml'), 'utf8');
  const matrix = JSON.parse(workflow.match(/group: (\[[^\n]+\])/)[1]);
  assert.deepEqual([...matrix, 'delivery'].sort(), Object.keys(EMULATOR_SUITES).sort());
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /run: npm run test:functions-emulators -- \$\{\{ matrix.group \}\}/);
  assert.match(workflow, /run: npm run test:functions-emulators -- delivery --plan tmp\/delivery-shards\/plan.json --shard \$\{\{ matrix.shard \}\} --output tmp\/delivery-shards\/report/);
  assert.ok(EMULATOR_SUITES.lifecycle.includes('src/training-plans/large-schedule.emulator.spec.ts'));
  assert.doesNotMatch(workflow, /run: npm run test:(disconnect|training-delivery)\n/);
  const emulatorJob = workflow.slice(workflow.indexOf('  functions_emulators:'));
  assert.doesNotMatch(emulatorJob, /\n\s+if:/);
  for (const file of ['testing.yaml', 'buildAndDeployBeta.yml', 'buildAndDeployMain.yml',
    'deployFunctionsManual.yml']) {
    assert.match(readFileSync(resolve(root, '.github/workflows', file), 'utf8'), /uses: \.\/\.github\/workflows\/_run-tests\.yml/);
  }
});

test('only loopback endpoints and the exact demo projects can enter the emulator runner', () => {
  const env = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8081', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
    GCLOUD_PROJECT: 'demo-functions-ci', TRAINING_TEST_DEMO_PROJECT_ID: 'demo-training-657' };
  assertLoopbackEmulators(env);
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'GCLOUD_PROJECT', 'TRAINING_TEST_DEMO_PROJECT_ID']) {
    assert.throws(() => assertLoopbackEmulators({ ...env, [key]: undefined }));
    assert.throws(() => assertLoopbackEmulators({ ...env, [key]: 'production.invalid:443' }));
  }
});

test('provider credentials, ADC and inherited emulator endpoints are not forwarded', () => {
  const env = emulatorEnvironment({ PATH: '/bin', HOME: '/local', JAVA_HOME: '/java', CI: 'true',
    GOOGLE_APPLICATION_CREDENTIALS: '/private.json', FIREBASE_TOKEN: 'private', SUUNTOAPP_CLIENT_SECRET: 'private',
    GCLOUD_PROJECT: 'production', FIRESTORE_EMULATOR_HOST: 'remote:8080', FIREBASE_AUTH_EMULATOR_HOST: 'remote:9090' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/local', JAVA_HOME: '/java', CI: 'true',
    GCLOUD_PROJECT: 'demo-functions-ci', GOOGLE_CLOUD_PROJECT: 'demo-functions-ci',
    TRAINING_TEST_DEMO_PROJECT_ID: 'demo-training-657' });
  const config = JSON.parse(readFileSync(resolve(root, 'firebase.functions-test.json'), 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['emulators', 'firestore']);
  assert.equal(config.emulators.singleProjectMode, false);
  assert.equal(config.emulators.ui.enabled, false);
});

function report() {
  return { success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numFailedTestSuites: 0,
    numTotalTestSuites: 2, numPassedTestSuites: 2,
    numPendingTests: 0, numPendingTestSuites: 0, numTodoTests: 0, testResults: [{
      name: resolve(functionsRoot, 'src/example.emulator.spec.ts'), status: 'passed',
      assertionResults: [{ status: 'passed' }],
    }] };
}
const expected = ['src/example.emulator.spec.ts'];

test('a complete passing JSON report is accepted', () => {
  assertExecutedReport(report(), expected, functionsRoot);
});

test('the CLI refuses a direct run without emulators or extra arguments before starting services', () => {
  for (const args of [['lifecycle', '--inside'], ['lifecycle', '--inside', 'ignored']]) {
    const result = spawnSync(process.execPath, [resolve(root, 'tools/test-functions-emulators.mjs'), ...args], {
      encoding: 'utf8', env: emulatorEnvironment(process.env),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /loopback emulator|Only a group name/);
    assert.doesNotMatch(result.stdout, /emulators: Starting|run build/);
  }
});

test('missing files, skipped assertions, TODOs and empty or failing runs fail closed', () => {
  for (const change of [{ success: false }, { numTotalTests: 0 }, { numTotalTests: undefined }, { numPendingTests: 1 },
    { numPendingTestSuites: 1 }, { numTodoTests: 1 }, { numFailedTests: 1 }, { numFailedTestSuites: 1 },
    { testResults: [] }]) {
    assert.throws(() => assertExecutedReport({ ...report(), ...change }, expected, functionsRoot));
  }
  for (const status of ['pending', 'skipped', 'todo', 'failed']) {
    const value = report();
    value.testResults[0].assertionResults[0].status = status;
    assert.throws(() => assertExecutedReport(value, expected, functionsRoot), /skipped assertions/);
  }
  const empty = report();
  empty.testResults[0].assertionResults = [];
  assert.throws(() => assertExecutedReport(empty, expected, functionsRoot), /skipped assertions/);
  assert.throws(() => assertExecutedReport(report(), [...expected, 'src/missing.emulator.spec.ts'], functionsRoot));
});

test('missing, malformed or inconsistent counters and omitted assertions fail closed', () => {
  for (const counter of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests',
    'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites']) {
    for (const value of [undefined, null, '1', -1, Infinity, 0.5]) {
      assert.throws(() => assertExecutedReport({ ...report(), [counter]: value }, expected, functionsRoot), /Malformed/);
    }
  }
  assert.throws(() => assertExecutedReport({ ...report(), numPassedTests: 0 }, expected, functionsRoot), /Inconsistent/);
  assert.throws(() => assertExecutedReport({ ...report(), numPassedTestSuites: 1 }, expected, functionsRoot), /Inconsistent/);
  assert.throws(() => assertExecutedReport({ ...report(), numTotalTests: 100, numPassedTests: 100 }, expected, functionsRoot), /Incomplete/);
  assert.throws(() => assertExecutedReport({ ...report(), testResults: null }, expected, functionsRoot), /Malformed/);
  assert.throws(() => assertExecutedReport(null, expected, functionsRoot), /Malformed/);
});
