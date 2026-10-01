import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExecutedReport, assertLoopbackEmulators, assertSuiteCoverage, discoverEmulatorSpecs,
  emulatorEnvironment, EMULATOR_SUITES, suiteFiles } from './functions-emulator-suites.mjs';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
const functionsRoot = join(root, 'functions');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal || result.status}).`);
}

function runInsideEmulators(group) {
  assertLoopbackEmulators(process.env);
  const files = suiteFiles(group);
  const temporary = mkdtempSync(join(tmpdir(), 'qs-emulator-results-'));
  const output = join(temporary, 'results.json');
  const started = performance.now();
  try {
    run(process.execPath, [join(functionsRoot, 'node_modules/vitest/vitest.mjs'), 'run',
      '--config', join(functionsRoot, 'vitest.config.ts'), ...files,
      '--maxWorkers=1', '--fileParallelism=false', '--reporter=default', '--reporter=json', `--outputFile.json=${output}`]);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assertExecutedReport(report, files, functionsRoot);
    console.log(`Emulator group ${group}: ${files.length} files, ${report.numPassedTests} tests, `
      + `${((performance.now() - started) / 1000).toFixed(1)}s; no skipped tests.`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const [group = 'all', mode] = args;
  if (args.length > 2 || (mode && mode !== '--inside')) throw new Error('Only a group name is accepted.');
  assertSuiteCoverage(discoverEmulatorSpecs(functionsRoot));
  if (mode === '--inside') return runInsideEmulators(group);
  const groups = group === 'all' ? Object.keys(EMULATOR_SUITES) : [group];
  for (const selected of groups) suiteFiles(selected);
  const env = emulatorEnvironment(process.env);
  run('npm', ['--prefix', 'functions', 'run', 'build'], { env });
  for (const selected of groups) {
    // Quote paths for Firebase's inner shell; the group is a validated registry key.
    const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
    run('firebase', ['emulators:exec', '--config', join(root, 'firebase.functions-test.json'),
      '--project', 'demo-functions-ci', '--only', 'firestore,auth', '--non-interactive',
      `${quote(process.execPath)} ${quote(script)} ${quote(selected)} --inside`], { env });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
