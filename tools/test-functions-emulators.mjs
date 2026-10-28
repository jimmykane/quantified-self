import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertExecutedReport, assertLoopbackEmulators, assertSuiteCoverage, discoverEmulatorSpecs,
  emulatorEnvironment, EMULATOR_SUITES, suiteFiles } from './functions-emulator-suites.mjs';
import { assertPlan, executionReport, writeJson } from './delivery-test-shards.mjs';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const functionsRoot = join(root, 'functions');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status}).`);
}

function runInsideEmulators(group, files, options, revision) {
  assertLoopbackEmulators(process.env);
  const temporary = mkdtempSync(join(tmpdir(), 'qs-emulator-results-'));
  const output = join(temporary, 'results.json');
  const started = performance.now();
  try {
    run(process.execPath, [join(functionsRoot, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', join(functionsRoot, 'vitest.emulators.config.ts'), ...files,
      '--maxWorkers=1', '--fileParallelism=false', '--reporter=default', '--reporter=json', `--outputFile.json=${output}`]);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assertExecutedReport(report, files, functionsRoot);
    if (options.output) {
      writeJson(join(options.output, 'report.json'), executionReport(report, files, functionsRoot, {
        revision, shard: options.shard ? Number(options.shard) : null,
        elapsedMs: Math.max(1, performance.now() - started),
      }));
    }
    console.log(`Emulator group ${group}: ${files.length} files, ${report.numPassedTests} tests, `
      + `${((performance.now() - started) / 1000).toFixed(1)}s; no skipped tests.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function main() {
  const { positionals, values: options } = parseArgs({ allowPositionals: true, options: {
    inside: { type: 'boolean' }, plan: { type: 'string' }, shard: { type: 'string' }, output: { type: 'string' },
  } });
  assert(positionals.length <= 1, 'Only a group name is accepted.');
  const [group = 'all'] = positionals;
  assert(!options.plan && !options.shard || group === 'delivery'
    && ['1', '2'].includes(options.shard) && options.plan && options.output,
  'Delivery sharding requires --plan, --shard 1|2 and --output.');
  assert(!options.output || group !== 'all', 'Report output requires a single emulator group.');
  if (options.output) options.output = resolve(root, options.output);
  assertSuiteCoverage(discoverEmulatorSpecs(functionsRoot));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const groups = group === 'all' ? Object.keys(EMULATOR_SUITES) : [group];
  for (const selected of groups) suiteFiles(selected);
  let selectedFiles;
  if (options.plan) {
    options.plan = resolve(root, options.plan);
    const plan = JSON.parse(readFileSync(options.plan, 'utf8'));
    assertPlan(plan, suiteFiles('delivery'), revision);
    selectedFiles = plan.shards[Number(options.shard) - 1].specs.map(spec => spec.file);
  }
  if (options.inside) return runInsideEmulators(group, selectedFiles ?? suiteFiles(group), options, revision);
  const env = emulatorEnvironment(process.env);
  run('npm', ['--prefix', 'functions', 'run', 'build'], { env });
  for (const selected of groups) {
    // Quote paths for Firebase's inner shell; the group is a validated registry key.
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    const innerArgs = [selected, '--inside'];
    if (options.plan) innerArgs.push('--plan', options.plan, '--shard', options.shard);
    if (options.output) innerArgs.push('--output', options.output);
    run('firebase', ['emulators:exec', '--config', join(root, 'firebase.functions-test.json'),
      '--project', 'demo-functions-ci', '--only', 'firestore,auth', '--non-interactive',
      [process.execPath, script, ...innerArgs].map(quote).join(' ')], { env });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
