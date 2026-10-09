import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const defaults = { 'helpers-node': 1000, 'helpers-dom': 2000, angular: 3000 };
const maxDuration = 3_600_000;
export const specKey = spec => `${spec.project}:${spec.file}`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const duration = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maxDuration;

function assertSpec(spec) {
  assert(spec && Object.hasOwn(defaults, spec.project), 'Unknown frontend project');
  assert(typeof spec.file === 'string' && spec.file.endsWith('.spec.ts') && !isAbsolute(spec.file)
    && !spec.file.includes('\\') && !spec.file.split('/').some(part => !part || part === '.' || part === '..'),
  'Expected a repository-relative spec path');
}

function assertSpecs(specs) {
  assert(Array.isArray(specs) && specs.length > 0, 'No frontend specs');
  specs.forEach(assertSpec);
  assert.equal(new Set(specs.map(spec => spec.file)).size, specs.length, 'Duplicate frontend spec');
}

export function assertHistory(history) {
  assert.equal(history?.version, 1, 'Unsupported timing history');
  assert(Array.isArray(history.entries), 'Missing timing entries');
  const keys = new Set();
  for (const entry of history.entries) {
    assertSpec(entry);
    assert(!keys.has(specKey(entry)), 'Duplicate timing entry');
    keys.add(specKey(entry));
    assert(Array.isArray(entry.samples) && entry.samples.length > 0 && entry.samples.length <= 3
      && entry.samples.every(duration), 'Invalid timing samples');
  }
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createPlan(specs, history = { version: 1, entries: [] }, { revision, count = 2 } = {}) {
  assertSpecs(specs);
  assertHistory(history);
  assert(Number.isSafeInteger(count) && count >= 1 && count <= specs.length, 'Invalid shard count');
  assert.match(revision ?? '', /^[0-9a-f]{40,64}$/, 'Expected a commit revision');
  const known = new Map(history.entries.map(entry => [specKey(entry), entry]));
  const retained = specs.flatMap(spec => known.has(specKey(spec)) ? [known.get(specKey(spec))] : [])
    .sort((a, b) => compare(specKey(a), specKey(b)));
  const projectDefaults = Object.fromEntries(Object.entries(defaults).map(([project, fallback]) => {
    const samples = retained.filter(entry => entry.project === project).map(entry => median(entry.samples));
    return [project, samples.length ? Math.max(fallback, median(samples)) : fallback];
  }));
  const weighted = specs.map(spec => ({ ...spec, estimatedMs: known.has(specKey(spec))
    ? median(known.get(specKey(spec)).samples) : projectDefaults[spec.project] }))
    .sort((a, b) => b.estimatedMs - a.estimatedMs || compare(specKey(a), specKey(b)));
  const shards = Array.from({ length: count }, (_, index) => ({ index: index + 1, estimatedWorkMs: 0, specs: [] }));
  for (const spec of weighted) {
    const shard = [...shards].sort((a, b) => a.estimatedWorkMs - b.estimatedWorkMs
      || a.specs.length - b.specs.length || a.index - b.index)[0];
    shard.specs.push(spec);
    shard.estimatedWorkMs += spec.estimatedMs;
  }
  return { version: 1, revision, history: { version: 1, entries: retained }, shards };
}

export function assertPlan(plan, specs, { revision, count = 2 } = {}) {
  assert.equal(plan?.version, 1, 'Unsupported shard plan');
  assert.equal(plan.revision, revision, 'Shard plan belongs to another commit');
  assertHistory(plan.history);
  assert(Array.isArray(plan.shards) && plan.shards.length === count, 'Wrong shard count');
  const actual = [];
  for (const [index, shard] of plan.shards.entries()) {
    assert.equal(shard.index, index + 1, 'Invalid shard index');
    assertSpecs(shard.specs);
    assert(shard.specs.every(spec => duration(spec.estimatedMs)), 'Invalid shard estimate');
    assert.equal(shard.estimatedWorkMs, shard.specs.reduce((sum, spec) => sum + spec.estimatedMs, 0), 'Invalid shard total');
    actual.push(...shard.specs);
  }
  assertSpecs(actual);
  assertSpecs(specs);
  assert.deepEqual(actual.map(specKey).sort(), specs.map(specKey).sort(), 'Shard plan must cover every discovered spec exactly once');
}

export function relativeSpec(root, file) {
  const path = relative(root, file).split(sep).join('/');
  assert(path && !path.startsWith('../') && !isAbsolute(path), 'Reported spec is outside the checkout');
  return path;
}

export function assertExecutedReport(report, specs, root) {
  const counters = ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests',
    'numTotalTestSuites', 'numPassedTestSuites', 'numFailedTestSuites', 'numPendingTestSuites'];
  assert(report && counters.every(key => Number.isSafeInteger(report[key]) && report[key] >= 0), 'Malformed frontend report');
  assert.equal(report.success, true, 'Frontend tests failed');
  assert(report.numTotalTests > 0 && report.numTotalTestSuites > 0, 'Empty frontend report');
  for (const key of ['numFailedTests', 'numPendingTests', 'numTodoTests', 'numFailedTestSuites', 'numPendingTestSuites']) {
    assert.equal(report[key], 0, 'Frontend failures, skips or TODOs are forbidden');
  }
  assert.equal(report.numPassedTests, report.numTotalTests, 'Incomplete frontend assertions');
  assert.equal(report.numPassedTestSuites, report.numTotalTestSuites, 'Incomplete frontend suites');
  assert(Array.isArray(report.testResults), 'Missing frontend files');
  assert.deepEqual(report.testResults.map(file => relativeSpec(root, file.name)).sort(), specs.map(spec => spec.file).sort(),
    'Selected frontend files were missing, duplicated or unexpected');
  let assertions = 0;
  for (const file of report.testResults) {
    assert.equal(file.status, 'passed', 'Failed frontend file');
    assert(Array.isArray(file.assertionResults) && file.assertionResults.length > 0
      && file.assertionResults.every(test => test.status === 'passed'), 'Failed, skipped or empty frontend assertions');
    assertions += file.assertionResults.length;
  }
  assert.equal(assertions, report.numTotalTests, 'Inconsistent frontend assertion count');
}

export function mergeReports(plan, reports, root, revision) {
  const specs = plan.shards.flatMap(shard => shard.specs);
  assertPlan(plan, specs, { revision, count: 2 });
  assert.equal(reports.length, plan.shards.length, 'Missing shard report');
  const previous = new Map(plan.history.entries.map(entry => [specKey(entry), entry.samples]));
  const entries = [];
  let tests = 0;
  const elapsed = [];
  for (const [index, { report, timing }] of reports.entries()) {
    const selected = plan.shards[index].specs;
    assertExecutedReport(report, selected, root);
    assert.equal(timing?.version, 1, 'Unsupported timing report');
    assert.equal(timing.success, true, 'Failed timing report');
    assert(duration(timing.elapsedMs), 'Invalid elapsed shard time');
    assertSpecs(timing.entries);
    assert.deepEqual(timing.entries.map(specKey).sort(), selected.map(specKey).sort(), 'Incomplete timing report');
    for (const entry of timing.entries) {
      assert(duration(entry.durationMs), 'Invalid measured duration');
      entries.push({ file: entry.file, project: entry.project,
        samples: [...(previous.get(specKey(entry)) ?? []), entry.durationMs].slice(-3) });
    }
    tests += report.numPassedTests;
    elapsed.push(timing.elapsedMs);
  }
  entries.sort((a, b) => compare(specKey(a), specKey(b)));
  const imbalance = Math.max(...elapsed) / Math.min(...elapsed);
  return { history: { version: 1, entries }, summary: { files: specs.length, tests, elapsedMs: elapsed,
    imbalance, warning: imbalance > 1.2 ? 'Frontend shards differ by over 20%; updated timings will rebalance the next run.' : null } };
}

// Discovery loads the actual Vitest project configuration. The result-merging
// gate uses only Node built-ins, so it needs no dependency install.
export async function discoverSpecs(root) {
  const [{ globSync }, { loadConfigFromFile }] = await Promise.all([import('tinyglobby'), import('vite')]);
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, resolve(root, 'vitest.config.ts'));
  assert(loaded, 'Frontend configuration must load');
  const config = loaded.config.test;
  const specs = config.projects.flatMap(project => globSync(project.test.include, {
    cwd: root, ignore: project.test.exclude, dot: true, expandDirectories: false,
  }).map(file => ({ file, project: project.test.name })));
  assertSpecs(specs);
  assert.deepEqual(specs.map(spec => spec.file).sort(), globSync(config.include, {
    cwd: root, ignore: config.exclude, dot: true, expandDirectories: false,
  }).sort(), 'Frontend discovery must cover the original boundary');
  return specs;
}

function readHistory(path) {
  try {
    assert(statSync(path).size <= 5_000_000, 'Timing history is too large');
    const history = JSON.parse(readFileSync(path, 'utf8'));
    assertHistory(history);
    return history;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Ignoring invalid optional frontend timing history; all specs remain required.');
    return { version: 1, entries: [] };
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main([command, ...args]) {
  const root = process.cwd();
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (command === 'plan') {
    assert.equal(args.length, 2, 'Usage: plan <history.json> <plan.json>');
    const specs = await discoverSpecs(root);
    const plan = createPlan(specs, readHistory(args[0]), { revision });
    assertPlan(plan, specs, { revision });
    writeJson(args[1], plan);
    console.log(JSON.stringify(plan.shards.map(shard => ({ shard: shard.index, files: shard.specs.length,
      estimatedWorkMs: shard.estimatedWorkMs }))));
    return;
  }
  assert.equal(command, 'merge', 'Usage: plan|merge');
  assert.equal(args.length, 3, 'Usage: merge <plan.json> <reports-directory> <history.json>');
  const plan = JSON.parse(readFileSync(args[0], 'utf8'));
  const reports = [1, 2].map(index => {
    const directory = resolve(args[1], `frontend-report-${index}`);
    return { report: JSON.parse(readFileSync(resolve(directory, 'report.json'), 'utf8')),
      timing: JSON.parse(readFileSync(resolve(directory, 'timing.json'), 'utf8')) };
  });
  const result = mergeReports(plan, reports, root, revision);
  writeJson(args[2], result.history);
  console.log(JSON.stringify(result.summary));
  if (result.summary.warning) console.warn(result.summary.warning);
}
