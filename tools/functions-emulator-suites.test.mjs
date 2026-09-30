import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertExecutedReport, assertLoopbackEmulators, assertSuiteCoverage, discoverEmulatorSpecs,
  emulatorEnvironment, EMULATOR_SUITES, suiteFiles } from './functions-emulator-suites.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const functionsRoot = resolve(root, 'functions');

test('every real emulator/integration file is registered exactly once', () => {
  assertSuiteCoverage(discoverEmulatorSpecs(functionsRoot));
  assert.throws(() => assertSuiteCoverage(['src/new.emulator.spec.ts'], {}), /Unregistered/);
  assert.throws(() => assertSuiteCoverage([], { stale: ['removed'] }), /Missing files/);
  assert.throws(() => assertSuiteCoverage(['a'], { first: ['a'], second: ['a'] }), /Duplicate/);
  assert.throws(() => assertSuiteCoverage([], { empty: [] }), /Empty/);
  assert.throws(() => suiteFiles('all_connected'), /Unknown emulator group/);
  assert.throws(() => suiteFiles('__proto__'), /Unknown emulator group/);
});

test('CI matrix gates every registered group, including the 400-workout stress test', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/_run-tests.yml'), 'utf8');
  const matrix = JSON.parse(workflow.match(/group: (\[[^\n]+\])/)[1]);
  assert.deepEqual(matrix.sort(), Object.keys(EMULATOR_SUITES).sort());
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /run: npm run test:functions-emulators -- \$\{\{ matrix.group \}\}/);
  assert.ok(EMULATOR_SUITES.lifecycle.includes('src/training-plans/large-schedule.emulator.spec.ts'));
  assert.doesNotMatch(workflow, /run: npm run test:(disconnect|training-delivery)\n/);
  const emulatorJob = workflow.slice(workflow.indexOf('  functions_emulators:'));
  assert.doesNotMatch(emulatorJob, /\n\s+if:/);
  for (const file of ['testing.yaml', 'buildAndDeployBeta.yml', 'buildAndDeployMain.yml',
    'buildAndDeployProduction.yml', 'deployFunctionsManual.yml']) {
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
