import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertExecutedReport, assertHistory, assertPlan, createPlan, discoverSpecs, mergeReports, relativeSpec, specKey } from './frontend-test-shards.mjs';
import FrontendTimingReporter from './frontend-test-timing-reporter.mjs';
import FrontendSequencer from './frontend-test-sequencer.mjs';

const revision = 'a'.repeat(40);
const root = '/checkout';
const spec = (file, project = 'angular') => ({ file, project });
const specs = ['a', 'b', 'c', 'd'].map(name => spec(`src/${name}.spec.ts`));
const history = { version: 1, entries: specs.map((file, index) => ({ ...file, samples: [100 - index * 30] })) };

test('balances expensive specs and rebalances when measured runtimes change', () => {
  const plan = createPlan(specs, history, { revision });
  assert.deepEqual(plan.shards.map(shard => shard.estimatedWorkMs), [110, 110]);
  assertPlan(plan, specs, { revision });
  const slower = structuredClone(history);
  slower.entries[3].samples = [500];
  const next = createPlan(specs, slower, { revision });
  assert.deepEqual(next.shards[0].specs.map(entry => entry.file), ['src/d.spec.ts']);
  assertPlan(next, specs, { revision });
});

test('allocation is deterministic and automatically includes new and hidden specs', () => {
  const future = [...specs, spec('.hidden/future.spec.ts'), spec('src/app/helpers/new.spec.ts', 'helpers-node')];
  const plan = createPlan(future, history, { revision });
  assert.deepEqual(plan, createPlan([...future].reverse(), { version: 1, entries: [...history.entries].reverse() }, { revision }));
  assertPlan(plan, future, { revision });
  assert.equal(plan.shards.flatMap(shard => shard.specs).length, 6);
});

test('removed files and changed environments cannot retain stale timing assumptions', () => {
  const current = [specs[0], spec(specs[1].file, 'helpers-node')];
  const plan = createPlan(current, history, { revision });
  assert.deepEqual(plan.history.entries.map(specKey), [specKey(specs[0])]);
  assert.equal(plan.shards.flatMap(shard => shard.specs).find(entry => entry.project === 'helpers-node').estimatedMs, 1000);
});

test('missing history has conservative environment estimates and never drops specs', () => {
  const current = [specs[0], spec('src/node.spec.ts', 'helpers-node'), spec('src/dom.spec.ts', 'helpers-dom')];
  const plan = createPlan(current, undefined, { revision });
  assertPlan(plan, current, { revision });
  assert.deepEqual(plan.shards.map(shard => shard.estimatedWorkMs), [3000, 3000]);
});

test('timing hints reject duplicate paths, invalid numbers, unsafe paths and unsupported projects', () => {
  for (const samples of [[NaN], [Infinity], [-1], [0], [3_600_001], [], [1, 2, 3, 4]]) {
    assert.throws(() => assertHistory({ version: 1, entries: [{ ...specs[0], samples }] }));
  }
  for (const entry of [spec('../outside.spec.ts'), spec('/outside.spec.ts'), spec('src/a.spec.ts', 'unexpected')]) {
    assert.throws(() => assertHistory({ version: 1, entries: [{ ...entry, samples: [1] }] }));
  }
  assert.throws(() => assertHistory({ version: 1, entries: [history.entries[0], history.entries[0]] }));
});

test('plan validation rejects missing, duplicated, misclassified and stale-commit selections', () => {
  const plan = createPlan(specs, history, { revision });
  assert.throws(() => assertPlan(plan, [...specs, spec('src/future.spec.ts')], { revision }));
  assert.throws(() => assertPlan(plan, specs.slice(1), { revision }));
  assert.throws(() => assertPlan(plan, specs, { revision: 'b'.repeat(40) }));
  for (const mutate of [
    copy => { copy.shards[1].specs[0] = copy.shards[0].specs[0]; },
    copy => { copy.shards[0].specs[0].project = 'helpers-node'; },
    copy => { copy.shards[0].index = 2; },
  ]) {
    const copy = structuredClone(plan); mutate(copy);
    assert.throws(() => assertPlan(copy, specs, { revision }));
  }
});

function passingReport(selected, reportRoot = root) {
  return { success: true, numTotalTests: selected.length, numPassedTests: selected.length, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, numTotalTestSuites: selected.length, numPassedTestSuites: selected.length,
    numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: selected.map(entry => ({ name: resolve(reportRoot, entry.file), status: 'passed', assertionResults: [{ status: 'passed' }] })) };
}

test('result guards reject runner failures, skipped assertions, missing files and inconsistent counters', () => {
  const good = passingReport(specs);
  assertExecutedReport(good, specs, root);
  for (const mutate of [
    report => { report.success = false; },
    report => { report.numPendingTests = 1; },
    report => { report.numTodoTests = 1; },
    report => { delete report.numFailedTests; },
    report => { report.testResults.pop(); },
    report => { report.testResults[1] = report.testResults[0]; },
    report => { report.testResults[0].assertionResults[0].status = 'pending'; },
    report => { report.testResults[0].assertionResults.push({ status: 'passed' }); },
  ]) {
    const report = structuredClone(good); mutate(report);
    assert.throws(() => assertExecutedReport(report, specs, root));
  }
});

test('successful reports update the last three samples and report actual imbalance', () => {
  const plan = createPlan(specs, history, { revision });
  const reports = plan.shards.map(shard => ({ report: passingReport(shard.specs), timing: { version: 1, success: true,
    elapsedMs: shard.index * 100, entries: shard.specs.map(entry => ({ ...entry, durationMs: 25 })) } }));
  const result = mergeReports(plan, reports, root, revision);
  assert.equal(result.summary.tests, 4);
  assert.equal(result.summary.imbalance, 2);
  assert.match(result.summary.warning, /20%/);
  assert.equal(result.history.entries.length, 4);
  assert.equal(result.history.entries[0].samples.at(-1), 25);
  assert.throws(() => mergeReports(plan, reports.slice(1), root, revision));
  reports[0].timing.entries.pop();
  assert.throws(() => mergeReports(plan, reports, root, revision));
});

test('reported paths must belong to the checked-out source', () => {
  assert.equal(relativeSpec(root, '/checkout/.hidden/a.spec.ts'), '.hidden/a.spec.ts');
  assert.throws(() => relativeSpec(root, '/another/a.spec.ts'));
});

test('timing reporter counts setup/import costs and refuses failed, skipped and unhandled-error runs', t => {
  const directory = mkdtempSync(join(tmpdir(), 'qs-timing-reporter-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const reporter = new FrontendTimingReporter({ outputFile: join(directory, 'timing.json') });
  reporter.onInit({ config: { root } }); reporter.onTestRunStart();
  const module = { moduleId: '/checkout/src/a.spec.ts', project: { name: 'angular' }, state: () => 'passed',
    children: { allTests: () => [{ result: () => ({ state: 'passed' }) }] },
    diagnostic: () => ({ environmentSetupDuration: 1, prepareDuration: 2, collectDuration: 3, setupDuration: 4, duration: 5 }) };
  reporter.onTestRunEnd([module], [], 'passed');
  const report = JSON.parse(readFileSync(reporter.outputFile, 'utf8'));
  assert.equal(report.entries[0].durationMs, 15);
  assert.throws(() => reporter.onTestRunEnd([module], [new Error('runner')], 'passed'));
  assert.throws(() => reporter.onTestRunEnd([module], [], 'interrupted'));
  assert.throws(() => reporter.onTestRunEnd([], [], 'passed'));
  assert.throws(() => reporter.onTestRunEnd([{ ...module, state: () => 'failed' }], [], 'passed'));
  assert.throws(() => reporter.onTestRunEnd([{ ...module, children: { allTests: () => [{ result: () => ({ state: 'skipped' }) }] } }], [], 'passed'));
});

test('real sequencer rejects stale plans and selects disjoint groups covering the full invocation', async t => {
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
  const directory = mkdtempSync(join(tmpdir(), 'qs-shard-sequencer-'));
  const previous = process.env.QS_FRONTEND_SHARD_PLAN;
  t.after(() => {
    if (previous === undefined) delete process.env.QS_FRONTEND_SHARD_PLAN;
    else process.env.QS_FRONTEND_SHARD_PLAN = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'plan.json');
  process.env.QS_FRONTEND_SHARD_PLAN = path;
  writeFileSync(path, JSON.stringify(createPlan(specs, history, { revision: sha })));
  const files = specs.map(entry => ({ moduleId: resolve(checkout, entry.file), project: { name: entry.project } }));
  const first = new FrontendSequencer({ config: { root: checkout, shard: { index: 1, count: 2 } } });
  const second = new FrontendSequencer({ config: { root: checkout, shard: { index: 2, count: 2 } } });
  const selected = [...await first.shard(files), ...await second.shard(files)];
  assert.equal(new Set(selected).size, files.length);
  assert.deepEqual(selected.map(file => file.moduleId).sort(), files.map(file => file.moduleId).sort());
  assert.deepEqual((await first.sort([...files].reverse())).map(file => file.moduleId), files.map(file => file.moduleId));
  await assert.rejects(first.shard(files.slice(1)));
  writeFileSync(path, JSON.stringify(createPlan(specs, history, { revision })));
  await assert.rejects(first.shard(files));
});

test('real config discovery includes future/hidden specs and excludes Functions and Rules', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qs-shard-discovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const node = ['src/app/known.spec.ts'];
  const dom = ['src/app/dom.spec.ts'];
  const future = ['.hidden/future.spec.ts', 'src/.hidden/future.spec.ts', 'src/app/future.spec.ts'];
  const excluded = ['functions/src/future.spec.ts', 'node_modules/future.spec.ts', 'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'];
  for (const file of [...node, ...dom, ...future, ...excluded]) {
    const path = resolve(directory, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '');
  }
  const exclude = ['functions/**', 'node_modules/**', 'src/firestore.rules.spec.ts', 'src/storage.rules.spec.ts'];
  const config = { test: { include: ['**/*.spec.ts'], exclude, projects: [
    { test: { name: 'helpers-node', include: node, exclude } },
    { test: { name: 'helpers-dom', include: dom, exclude } },
    { test: { name: 'angular', include: ['**/*.spec.ts'], exclude: [...exclude, ...node, ...dom] } },
  ] } };
  writeFileSync(resolve(directory, 'vitest.config.ts'), `export default ${JSON.stringify(config)}`);
  const discovered = await discoverSpecs(directory);
  assert.deepEqual(discovered.map(entry => entry.file).sort(), [...node, ...dom, ...future].sort());
  assertPlan(createPlan(discovered, undefined, { revision }), discovered, { revision });
});

test('the planning CLI safely falls back from malformed optional history', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'qs-shard-history-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = resolve(directory, 'history.json'); const output = resolve(directory, 'plan.json');
  writeFileSync(input, '{ malformed history');
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync(process.execPath, ['tools/frontend-test-shard-cli.mjs', 'plan', input, output],
    { cwd: checkout, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ignoring invalid optional/);
  const plan = JSON.parse(readFileSync(output, 'utf8'));
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
  assertPlan(plan, await discoverSpecs(checkout), { revision: sha });
});

test('the required report gate runs without installed dependencies and rejects incomplete reports', t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'qs-shard-gate-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(resolve(directory, 'tools'));
  for (const file of ['frontend-test-shards.mjs', 'frontend-test-shard-cli.mjs']) {
    writeFileSync(resolve(directory, 'tools', file), readFileSync(new URL(file, import.meta.url)));
  }
  execFileSync('git', ['init', '-q'], { cwd: directory });
  execFileSync('git', ['-c', 'user.name=Test Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--no-gpg-sign', '--allow-empty', '-qm', 'test: fixture'], { cwd: directory });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
  const plan = createPlan(specs, history, { revision: sha });
  writeFileSync(resolve(directory, 'plan.json'), JSON.stringify(plan));
  for (const shard of plan.shards) {
    const reportDirectory = resolve(directory, 'reports', `frontend-report-${shard.index}`);
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(resolve(reportDirectory, 'report.json'), JSON.stringify(passingReport(shard.specs, directory)));
    writeFileSync(resolve(reportDirectory, 'timing.json'), JSON.stringify({ version: 1, success: true,
      elapsedMs: 100, entries: shard.specs.map(entry => ({ ...entry, durationMs: 25 })) }));
  }
  const invoke = () => spawnSync(process.execPath,
    ['tools/frontend-test-shard-cli.mjs', 'merge', 'plan.json', 'reports', 'history.json'],
    { cwd: directory, encoding: 'utf8', timeout: 30_000 });
  const result = invoke();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(resolve(directory, 'history.json'), 'utf8')).entries.length, specs.length);
  rmSync(resolve(directory, 'reports/frontend-report-2/report.json'));
  assert.equal(invoke().status, 1);
});
