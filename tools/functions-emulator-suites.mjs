import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Exact emulator files only: the ordinary Functions suite already covers mocks.
export const EMULATOR_SUITES = {
  delivery: [
    'src/training-plans/delivery/delivery.emulator.spec.ts',
    'src/training-plans/delivery/garmin/worker.emulator.spec.ts',
    'src/training-plans/delivery/coros/batch-worker.emulator.spec.ts',
    'src/training-plans/delivery/coros/strength.emulator.spec.ts',
    'src/training-plans/delivery/wahoo/worker.emulator.spec.ts',
    'src/training-plans/delivery/suunto/suunto.emulator.spec.ts',
  ],
  lifecycle: [
    'src/training-plans/large-schedule.emulator.spec.ts',
    'src/training-plans/strength.lifecycle.emulator.spec.ts',
    'src/training-plans/workout-library.emulator.spec.ts',
    'src/training-plans/cleanup-worker.emulator.spec.ts',
  ],
  completion: [
    'src/coros/training-completion.emulator.spec.ts',
    'src/wahoo/training-completion.emulator.spec.ts',
    'src/training-plans/completion/fit-workout-evidence.emulator.spec.ts',
    'src/admin/handlers/training-delivery-queue.stats.emulator.spec.ts',
  ],
  'mcp-data': [
    'src/mcp/training-plans.emulator.spec.ts',
    'src/mcp/training-plans-write.emulator.spec.ts',
    'src/mcp/content-write.emulator.spec.ts',
    'src/derived-metrics/derived-metrics-reuse.emulator.spec.ts',
    'src/events/event-tag-catalog.emulator.spec.ts',
    'src/admin/marketing/marketing.emulator.spec.ts',
    'src/service-disconnect-cleanup.integration.spec.ts',
  ],
};

export function discoverEmulatorSpecs(functionsRoot, directory = 'src') {
  return readdirSync(join(functionsRoot, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return discoverEmulatorSpecs(functionsRoot, path);
    if (!entry.isFile() || !entry.name.endsWith('.spec.ts')) return [];
    // Naming alone must not hide a describe.skipIf(emulatorMissing) suite in
    // the ordinary Functions run. Require explicit coverage for host consumers.
    const named = /\.(emulator|integration)\.spec\.ts$/.test(entry.name);
    const needsEmulator = /FIRESTORE_EMULATOR_HOST|FIREBASE_AUTH_EMULATOR_HOST/
      .test(readFileSync(join(functionsRoot, path), 'utf8'));
    return named || needsEmulator ? [path] : [];
  }).sort();
}

export function assertSuiteCoverage(discovered, suites = EMULATOR_SUITES) {
  if (Object.values(suites).some(files => !files.length)) throw new Error('Empty emulator group.');
  const registered = Object.values(suites).flat();
  if (new Set(registered).size !== registered.length) throw new Error('Duplicate emulator suite registration.');
  const missing = discovered.filter(path => !registered.includes(path));
  const stale = registered.filter(path => !discovered.includes(path));
  if (missing.length || stale.length) {
    throw new Error(`Emulator coverage mismatch. Unregistered: ${missing.join(', ')}. Missing files: ${stale.join(', ')}.`);
  }
}

export function suiteFiles(group) {
  if (!Object.hasOwn(EMULATOR_SUITES, group)) throw new Error(`Unknown emulator group: ${group}`);
  return EMULATOR_SUITES[group];
}

export function assertLoopbackEmulators(env) {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(env[key] || '')) {
      throw new Error(`${key} must point to a loopback emulator.`);
    }
  }
  if (env.GCLOUD_PROJECT !== 'demo-functions-ci'
      || env.TRAINING_TEST_DEMO_PROJECT_ID !== 'demo-training-657') {
    throw new Error('Exact demo-project environment required.');
  }
}

// Do not pass provider credentials, ADC overrides or inherited emulator hosts
// into Firebase CLI or Vitest. No Functions/Extensions emulator is started.
export function emulatorEnvironment(env) {
  const allowed = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR',
    'SystemRoot', 'ComSpec', 'JAVA_HOME', 'LANG', 'LC_ALL', 'TERM', 'CI', 'NO_COLOR', 'FORCE_COLOR',
    'FIREBASE_EMULATORS_PATH'];
  const clean = Object.fromEntries(allowed.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  return { ...clean, GCLOUD_PROJECT: 'demo-functions-ci', GOOGLE_CLOUD_PROJECT: 'demo-functions-ci',
    TRAINING_TEST_DEMO_PROJECT_ID: 'demo-training-657' };
}

export function assertExecutedReport(report, files, functionsRoot) {
  const counters = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests',
    'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites'];
  if (!report || counters.some(key => !Number.isSafeInteger(report[key]) || report[key] < 0)
      || !Array.isArray(report.testResults)) {
    throw new Error('Malformed emulator test report.');
  }
  if (report.success !== true || report.numTotalTests === 0 || report.numFailedTests
      || report.numFailedTestSuites || report.numPendingTests || report.numPendingTestSuites || report.numTodoTests) {
    throw new Error('Emulator tests failed, were empty, or were skipped.');
  }
  if (report.numPassedTests !== report.numTotalTests
      || report.numPassedTestSuites !== report.numTotalTestSuites) {
    throw new Error('Inconsistent emulator test report counters.');
  }
  const expected = files.map(path => resolve(functionsRoot, path)).sort();
  const actual = report.testResults.map(result => resolve(result.name)).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Not every selected emulator file ran.');
  let assertions = 0;
  for (const result of report.testResults) {
    if (result.status !== 'passed' || !Array.isArray(result.assertionResults) || !result.assertionResults.length
        || result.assertionResults.some(assertion => assertion.status !== 'passed')) {
      throw new Error(`Emulator file failed or skipped assertions: ${result.name}`);
    }
    assertions += result.assertionResults.length;
  }
  if (assertions !== report.numTotalTests) throw new Error('Incomplete emulator test report assertions.');
}
