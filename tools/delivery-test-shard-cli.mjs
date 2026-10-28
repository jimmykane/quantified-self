import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertSuiteCoverage, discoverEmulatorSpecs, suiteFiles } from './functions-emulator-suites.mjs';
import { assertPlan, createPlan, mergeReports, readHistory, writeJson } from './delivery-test-shards.mjs';

try {
  const [command, ...args] = process.argv.slice(2);
  const root = process.cwd();
  const functionsRoot = resolve(root, 'functions');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assertSuiteCoverage(discoverEmulatorSpecs(functionsRoot));
  const files = suiteFiles('delivery');
  if (command === 'plan') {
    assert.equal(args.length, 2, 'Usage: plan <history.json> <plan.json>');
    const plan = createPlan(files, readHistory(args[0]), revision);
    assertPlan(plan, files, revision);
    writeJson(args[1], plan);
    console.log(JSON.stringify(plan.shards.map(shard => ({ shard: shard.index, files: shard.specs.length,
      estimatedWorkMs: shard.estimatedWorkMs }))));
  } else {
    assert.equal(command, 'merge', 'Usage: plan|merge');
    assert.equal(args.length, 3, 'Usage: merge <plan.json> <reports-directory> <history.json>');
    const plan = JSON.parse(readFileSync(args[0], 'utf8'));
    const reports = [1, 2].map(index => JSON.parse(readFileSync(resolve(args[1], `delivery-report-${index}`, 'report.json'), 'utf8')));
    const result = mergeReports(plan, reports, functionsRoot, revision, files);
    writeJson(args[2], result.history);
    console.log(JSON.stringify(result.summary));
    if (result.summary.warning) console.warn(result.summary.warning);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
