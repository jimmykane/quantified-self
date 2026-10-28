import assert from 'node:assert/strict';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { assertExecutedReport, suiteFiles } from './functions-emulator-suites.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const duration = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 3_600_000;
const validFile = file => typeof file === 'string' && file.startsWith('src/') && file.endsWith('.spec.ts')
  && !isAbsolute(file) && !file.includes('\\') && !file.split('/').some(part => !part || part === '.' || part === '..');

function assertFiles(files) {
  assert(Array.isArray(files) && files.length > 0 && files.every(validFile), 'Invalid delivery spec paths');
  assert.equal(new Set(files).size, files.length, 'Duplicate delivery spec');
}

export function assertHistory(history) {
  assert.equal(history?.version, 1, 'Unsupported delivery timing history');
  assert(Array.isArray(history.entries), 'Missing delivery timing entries');
  const seen = new Set();
  for (const entry of history.entries) {
    assert(validFile(entry.file) && !seen.has(entry.file), 'Invalid or duplicate delivery timing path');
    seen.add(entry.file);
    assert(Array.isArray(entry.samples) && entry.samples.length > 0 && entry.samples.length <= 3
      && entry.samples.every(duration), 'Invalid delivery timing samples');
  }
}

export function readHistory(path) {
  try {
    assert(statSync(path).size <= 1_000_000, 'Delivery timing history is too large');
    const history = JSON.parse(readFileSync(path, 'utf8'));
    assertHistory(history);
    return history;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Ignoring invalid optional delivery timings; every registered test remains required.');
    return { version: 1, entries: [] };
  }
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function createPlan(files, history, revision) {
  assertFiles(files);
  assert(files.length >= 2, 'Delivery sharding requires at least two files');
  assertHistory(history);
  assert.match(revision ?? '', /^[0-9a-f]{40,64}$/, 'Expected a commit revision');
  const retained = history.entries.filter(entry => files.includes(entry.file)).sort((a, b) => compare(a.file, b.file));
  const known = new Map(retained.map(entry => [entry.file, median(entry.samples)]));
  const fallback = retained.length ? Math.max(1000, median([...known.values()])) : 60_000;
  const weighted = files.map(file => ({ file, estimatedMs: known.get(file) ?? fallback }))
    .sort((a, b) => b.estimatedMs - a.estimatedMs || compare(a.file, b.file));
  const shards = [1, 2].map(index => ({ index, estimatedWorkMs: 0, specs: [] }));
  for (const spec of weighted) {
    const shard = [...shards].sort((a, b) => a.estimatedWorkMs - b.estimatedWorkMs
      || a.specs.length - b.specs.length || a.index - b.index)[0];
    shard.specs.push(spec);
    shard.estimatedWorkMs += spec.estimatedMs;
  }
  return { version: 1, revision, history: { version: 1, entries: retained }, shards };
}

export function assertPlan(plan, files, revision) {
  assertFiles(files);
  assert.equal(plan?.version, 1, 'Unsupported delivery shard plan');
  assert.equal(plan.revision, revision, 'Delivery plan belongs to another commit');
  assertHistory(plan.history);
  assert(Array.isArray(plan.shards) && plan.shards.length === 2, 'Wrong delivery shard count');
  const actual = [];
  for (const [index, shard] of plan.shards.entries()) {
    assert.equal(shard.index, index + 1, 'Invalid delivery shard index');
    assert(Array.isArray(shard.specs), 'Missing delivery specs');
    assertFiles(shard.specs.map(spec => spec.file));
    assert(shard.specs.every(spec => duration(spec.estimatedMs)), 'Invalid delivery estimate');
    assert.equal(shard.estimatedWorkMs, shard.specs.reduce((sum, spec) => sum + spec.estimatedMs, 0), 'Invalid delivery total');
    actual.push(...shard.specs.map(spec => spec.file));
  }
  assertFiles(actual);
  assert.deepEqual(actual.sort(), [...files].sort(), 'Delivery plan must cover the registered files exactly once');
}

// Reports use Functions-relative paths, so a gate on another checkout can
// validate them without trusting or recreating the source runner's filesystem.
export function executionReport(report, files, functionsRoot, { revision, shard = null, elapsedMs }) {
  assertExecutedReport(report, files, functionsRoot);
  assert(duration(elapsedMs), 'Invalid delivery elapsed time');
  const normalized = { ...report, testResults: report.testResults.map(result => ({ ...result,
    name: relative(functionsRoot, resolve(functionsRoot, result.name)).split(sep).join('/'),
  })) };
  return { version: 1, revision, shard, elapsedMs, report: normalized };
}

export function mergeReports(plan, reports, functionsRoot, revision, files = suiteFiles('delivery')) {
  assertPlan(plan, files, revision);
  assert(Array.isArray(reports) && reports.length === 2, 'Missing delivery shard report');
  const previous = new Map(plan.history.entries.map(entry => [entry.file, entry.samples]));
  const entries = [];
  let tests = 0;
  const elapsedMs = [];
  for (const [index, envelope] of reports.entries()) {
    assert.equal(envelope?.version, 1, 'Unsupported delivery report');
    assert.equal(envelope.revision, revision, 'Delivery report belongs to another commit');
    assert.equal(envelope.shard, index + 1, 'Wrong delivery report shard');
    assert(duration(envelope.elapsedMs), 'Invalid delivery elapsed time');
    const selected = plan.shards[index].specs.map(spec => spec.file);
    assert(Array.isArray(envelope.report?.testResults)
      && envelope.report.testResults.every(result => validFile(result.name)), 'Expected Functions-relative report paths');
    assertExecutedReport({ ...envelope.report, testResults: envelope.report.testResults.map(result => ({ ...result,
      name: resolve(functionsRoot, result.name),
    })) }, selected, functionsRoot);
    for (const result of envelope.report.testResults) {
      assert(validFile(result.name), 'Expected a Functions-relative report path');
      assert(Number.isFinite(result.startTime) && Number.isFinite(result.endTime)
        && result.startTime >= 0 && result.endTime >= result.startTime, 'Invalid delivery file timing');
      const measured = Math.max(1, result.endTime - result.startTime);
      assert(duration(measured), 'Invalid delivery file duration');
      entries.push({ file: result.name, samples: [...(previous.get(result.name) ?? []), measured].slice(-3) });
    }
    tests += envelope.report.numPassedTests;
    elapsedMs.push(envelope.elapsedMs);
  }
  entries.sort((a, b) => compare(a.file, b.file));
  const imbalance = Math.max(...elapsedMs) / Math.min(...elapsedMs);
  return { history: { version: 1, entries }, summary: { files: files.length, tests, elapsedMs, imbalance,
    warning: imbalance > 1.2 ? 'Delivery shard runtimes differ by over 20%; updated timings will rebalance the next run.' : null } };
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
