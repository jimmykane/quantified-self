import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { suiteFiles, emulatorEnvironment, EMULATOR_SUITES } from './functions-emulator-suites.mjs';
import { assertPlan, createPlan, executionReport, mergeReports, readHistory } from './delivery-test-shards.mjs';

const revision = 'a'.repeat(40);
const root = '/checkout/functions';
const files = ['src/a.spec.ts', 'src/b.spec.ts', 'src/c.spec.ts', 'src/d.spec.ts'];
const emptyHistory = { version: 1, entries: [] };
const plan = history => createPlan(files, history ?? emptyHistory, revision);
const copy = value => structuredClone(value);
function reports(value) {
  return value.shards.map(shard => ({ version: 1, revision, shard: shard.index, elapsedMs: 100,
    report: { success: true, numTotalTests: shard.specs.length, numPassedTests: shard.specs.length,
      numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, numTotalTestSuites: shard.specs.length,
      numPassedTestSuites: shard.specs.length, numFailedTestSuites: 0, numPendingTestSuites: 0,
      testResults: shard.specs.map(spec => ({ name: spec.file, status: 'passed', startTime: 1000, endTime: 1020,
        assertionResults: [{ fullName: spec.file, status: 'passed' }] })) } }));
}

test('cold delivery plans are deterministic and cover every file exactly once', () => {
  const value = plan();
  assertPlan(value, files, revision);
  assert.deepEqual(value, createPlan([...files].reverse(), emptyHistory, revision));
  assert.deepEqual(value.shards.map(shard => shard.specs.length), [2, 2]);
  assert.throws(() => createPlan([files[0]], emptyHistory, revision), /at least two/);
});

test('median timings rebalance expensive files and automatically include new paths', () => {
  const history = { version: 1, entries: files.map((file, i) => ({ file, samples: [[900, 100, 101], [80], [60], [20]][i] })) };
  const value = plan(history);
  assert.equal(value.shards[0].specs[0].file, files[0]);
  assert.deepEqual(value.shards.map(shard => shard.estimatedWorkMs), [121, 140]);
  const changed = copy(history);
  changed.entries[0].samples = [10];
  assert.notDeepEqual(plan(changed).shards, value.shards);
  const future = 'src/.future/new.emulator.spec.ts';
  const grown = createPlan([...files, future], history, revision);
  assertPlan(grown, [...files, future], revision);
  assert.equal(grown.shards.flatMap(shard => shard.specs).find(spec => spec.file === future).estimatedMs, 1000);
  assert.equal(createPlan(files.slice(1), history, revision).history.entries.length, 3);
});

test('invalid or missing optional timings fall back without dropping coverage', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'qs-delivery-history-'));
  try {
    const path = resolve(directory, 'history.json');
    assert.deepEqual(readHistory(path), emptyHistory);
    for (const value of ['invalid', JSON.stringify({ version: 2, entries: [] }),
      JSON.stringify({ version: 1, entries: [{ file: files[0], samples: [-1] }] })]) {
      writeFileSync(path, value);
      assert.deepEqual(readHistory(path), emptyHistory);
      assertPlan(createPlan(files, readHistory(path), revision), files, revision);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('stale, incomplete, duplicate and malformed plans fail closed', () => {
  assert.throws(() => assertPlan(plan(), files, 'b'.repeat(40)), /another commit/);
  for (const mutate of [value => value.shards.pop(), value => value.shards[0].specs.pop(),
    value => value.shards[1].specs.push(value.shards[0].specs[0]),
    value => value.shards[0].specs[0].estimatedMs = NaN,
    value => value.shards[0].specs[0].file = '../outside.spec.ts',
    value => value.shards[0].index = 2, value => value.shards[0].estimatedWorkMs++]) {
    const value = plan(); mutate(value);
    assert.throws(() => assertPlan(value, files, revision));
  }
  assert.throws(() => assertPlan(plan(), [...files, 'src/new.spec.ts'], revision), /exactly once/);
});

test('reports travel between checkouts and refresh only the last three successful samples', () => {
  const value = plan({ version: 1, entries: [{ file: files[0], samples: [100, 200, 300] }] });
  const executed = reports(value);
  const source = copy(executed[0].report);
  source.testResults.forEach(result => result.name = resolve('/other/functions', result.name));
  const normalized = executionReport(source, value.shards[0].specs.map(spec => spec.file), '/other/functions',
    { revision, shard: 1, elapsedMs: 100 });
  assert.deepEqual(normalized, executed[0]);
  const merged = mergeReports(value, executed, root, revision, files);
  assert.equal(merged.summary.tests, 4);
  assert.equal(merged.summary.warning, null);
  assert.deepEqual(merged.history.entries.find(entry => entry.file === files[0]).samples, [200, 300, 20]);
  executed[1].elapsedMs = 150;
  assert.match(mergeReports(value, executed, root, revision, files).summary.warning, /over 20%/);
});

test('missing, stale, swapped, skipped, failed or inconsistent reports reject timing publication', () => {
  const value = plan();
  assert.throws(() => mergeReports(value, reports(value).slice(1), root, revision, files), /Missing/);
  for (const mutate of [all => all.reverse(), all => all[0].revision = 'b'.repeat(40),
    all => all[0].report.success = false, all => all[0].report.testResults.pop(),
    all => all[0].report.testResults.push(all[0].report.testResults[0]),
    all => all[0].report.testResults[0].assertionResults[0].status = 'skipped',
    all => all[0].report.numTotalTests++, all => all[0].report.numTodoTests = 1,
    all => all[0].report.testResults[0].endTime = NaN,
    all => all[0].report.testResults[0].startTime = -1,
    all => all[0].elapsedMs = 0]) {
    const executed = reports(value); mutate(executed);
    assert.throws(() => mergeReports(value, executed, root, revision, files));
  }
});

test('the actual CLI creates a current-registry plan and refuses invalid selections before starting emulators', () => {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = mkdtempSync(resolve(tmpdir(), 'qs-delivery-cli-'));
  const run = (script, args) => spawnSync(process.execPath, [resolve(repository, 'tools', script), ...args], {
    cwd: repository, encoding: 'utf8', env: emulatorEnvironment(process.env),
  });
  try {
    const path = resolve(directory, 'plan.json');
    const current = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
    assert.equal(run('delivery-test-shard-cli.mjs', ['plan', resolve(directory, 'missing.json'), path]).status, 0);
    for (const args of [['delivery', '--shard', '3'], ['delivery', '--plan', path],
      ['lifecycle', '--plan', path, '--shard', '1', '--output', directory],
      ['delivery', '--unknown'], ['all', '--output', directory]]) {
      const result = run('test-functions-emulators.mjs', args);
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout, /emulators: Starting|run build/);
    }
    const validArgs = ['delivery', '--plan', path, '--shard', '1', '--output', directory];
    const selected = run('test-functions-emulators.mjs', [...validArgs, '--inside']);
    assert.equal(selected.status, 1);
    assert.match(selected.stderr, /loopback emulator/);
    const stale = createPlan(suiteFiles('delivery'), emptyHistory, 'b'.repeat(40));
    writeFileSync(path, JSON.stringify(stale));
    const result = run('test-functions-emulators.mjs', validArgs);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /another commit/);
    assert.doesNotMatch(result.stdout, /emulators: Starting|run build/);
    stale.revision = current;
    stale.shards[0].specs.pop();
    writeFileSync(path, JSON.stringify(stale));
    assert.equal(run('test-functions-emulators.mjs', validArgs).status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the required delivery report gate needs no installed dependencies and never publishes incomplete results', () => {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const directory = mkdtempSync(resolve(tmpdir(), 'qs-delivery-gate-'));
  try {
    mkdirSync(resolve(directory, 'tools'));
    for (const file of ['delivery-test-shard-cli.mjs', 'delivery-test-shards.mjs', 'functions-emulator-suites.mjs']) {
      copyFileSync(resolve(repository, 'tools', file), resolve(directory, 'tools', file));
    }
    for (const file of Object.values(EMULATOR_SUITES).flat()) {
      const path = resolve(directory, 'functions', file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '// FIRESTORE_EMULATOR_HOST discovery fixture, including ordinary filenames.\n');
    }
    execFileSync('git', ['init', '-q'], { cwd: directory });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
      'commit', '--no-gpg-sign', '--allow-empty', '-qm', 'test: report gate fixture'], { cwd: directory });
    const current = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
    const value = createPlan(suiteFiles('delivery'), emptyHistory, current);
    const planPath = resolve(directory, 'plan.json');
    const historyPath = resolve(directory, 'history.json');
    writeFileSync(planPath, JSON.stringify(value));
    const executed = reports(value);
    for (const envelope of executed) {
      envelope.revision = current;
      const path = resolve(directory, 'reports', `delivery-report-${envelope.shard}`);
      mkdirSync(path, { recursive: true });
      writeFileSync(resolve(path, 'report.json'), JSON.stringify(envelope));
    }
    const run = () => spawnSync(process.execPath, [resolve(directory, 'tools/delivery-test-shard-cli.mjs'),
      'merge', planPath, resolve(directory, 'reports'), historyPath], { cwd: directory, encoding: 'utf8' });
    assert.equal(run().status, 0);
    assert.equal(JSON.parse(readFileSync(historyPath, 'utf8')).entries.length, suiteFiles('delivery').length);
    assert.equal(existsSync(resolve(directory, 'node_modules')), false);
    rmSync(historyPath);
    rmSync(resolve(directory, 'reports/delivery-report-2/report.json'));
    assert.equal(run().status, 1);
    assert.equal(existsSync(historyPath), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
