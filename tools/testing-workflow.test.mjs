import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { load } from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = file => load(readFileSync(resolve(root, '.github/workflows', file), 'utf8'));
const testing = workflow('testing.yaml');
const shared = workflow('_run-tests.yml');

// The job expressions use only equality, boolean operators and literals;
// evaluate their actual YAML values rather than a second implementation of them.
function evaluate(expression, github, extraContext = {}) {
  const body = expression.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/)?.[1];
  assert.ok(body, 'Explicit GitHub expression required');
  return runInNewContext(body.replaceAll(' == ', ' === ').replaceAll(' != ', ' !== '),
    { github, ...extraContext }, { timeout: 100 });
}

function context(event, fork = false, branch = 'codex/change') {
  const repository = 'owner/project';
  return { event_name: event, repository,
    ...(event === 'pull_request' ? { event: { pull_request: {
      head: { repo: { full_name: fork ? 'contributor/project' : repository }, ref: branch },
    } } } : {}),
  };
}

test('fork PRs have a trigger and internal feature branches retain push coverage', () => {
  assert.deepEqual(testing.on.pull_request.types, ['opened', 'synchronize', 'reopened']);
  assert.equal(testing.on.pull_request.branches, undefined);
  assert.deepEqual(testing.on.push['branches-ignore'], ['develop', 'main']);
  assert.equal(testing.on.pull_request_target, undefined);
  assert.equal(testing.jobs['run-tests'].uses, './.github/workflows/_run-tests.yml');
  assert.deepEqual(Object.keys(testing.jobs), ['run-tests']);
});

test('one actual test run for internal branches and a required test run for forks', () => {
  const job = testing.jobs['run-tests'];
  const push = context('push');
  const internalPR = context('pull_request');
  const forkPR = context('pull_request', true);
  assert.equal(evaluate(job.if, push), true);
  assert.equal(evaluate(job.if, internalPR), false);
  assert.equal(evaluate(job.if, forkPR), true);
  assert.equal(evaluate(job.if, context('workflow_dispatch')), false);
  assert.equal(evaluate(job.name, push), 'run-tests');
  assert.equal(evaluate(job.name, forkPR), 'run-tests');
  assert.notEqual(evaluate(job.name, internalPR), 'run-tests');
});

test('fork tests are read-only, use the PR merge ref and do not inherit deployment secrets', () => {
  assert.deepEqual(testing.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(testing.jobs['run-tests'].secrets, undefined);
  assert.equal(testing.jobs['run-tests'].with, undefined);
  for (const job of [shared.jobs.unit_tests, shared.jobs.functions_emulators]) {
    const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
    assert.equal(checkout.with.ref, '${{ inputs.ref || github.sha }}');
    assert.equal(job.environment, undefined);
    assert.ok(job.steps.every(step => !/google-github-actions\/auth|firebase deploy/.test(step.uses || step.run || '')));
  }
});

test('the existing required check aggregates every real test job and rejects skips/cancellation', () => {
  const gate = shared.jobs.run_tests;
  assert.deepEqual(gate.needs, ['unit_tests', 'functions_emulators']);
  assert.equal(gate.if, '${{ always() }}');
  assert.equal(gate.name, undefined); // The job id keeps the required run_tests name.
  assert.equal(shared.jobs.unit_tests.if, undefined);
  assert.equal(shared.jobs.functions_emulators.if, undefined);
  assert.ok(shared.jobs.unit_tests.steps.some(step => step.run === 'npm run test:workflows'));
  const step = gate.steps[0];
  assert.deepEqual(step.env, { UNIT_RESULT: '${{ needs.unit_tests.result }}',
    EMULATOR_RESULT: '${{ needs.functions_emulators.result }}' });
  for (const unit of ['success', 'failure', 'cancelled', 'skipped', '']) {
    for (const emulator of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        encoding: 'utf8', env: { PATH: process.env.PATH, UNIT_RESULT: unit, EMULATOR_RESULT: emulator },
      });
      assert.equal(result.status, unit === 'success' && emulator === 'success' ? 0 : 1,
        `unit=${unit}, emulator=${emulator}: ${result.stderr}`);
    }
  }
});

test('beta and main remain push-only and all deployments depend on the reusable test gate', () => {
  const callers = { 'buildAndDeployBeta.yml': 'run-tests', 'buildAndDeployMain.yml': 'test',
    'buildAndDeployProduction.yml': 'test', 'deployFunctionsManual.yml': 'test' };
  for (const [file, jobId] of Object.entries(callers)) {
    const caller = workflow(file);
    assert.equal(caller.jobs[jobId].uses, './.github/workflows/_run-tests.yml');
    assert.ok([caller.jobs.deploy.needs].flat().includes(jobId));
  }
  assert.deepEqual(workflow('buildAndDeployBeta.yml').on.push.branches, ['develop']);
  assert.deepEqual(workflow('buildAndDeployMain.yml').on.push.branches, ['main']);
  assert.equal(workflow('buildAndDeployBeta.yml').on.pull_request, undefined);
  assert.equal(workflow('buildAndDeployMain.yml').on.pull_request, undefined);
});

test('CodeQL keeps branch baselines, fork/feature PR coverage and its scheduled scan', () => {
  const codeql = workflow('codeql-analysis.yml');
  assert.deepEqual(codeql.on.push.branches, ['main', 'develop', 'feature/**']);
  assert.deepEqual(codeql.on.pull_request.branches, ['main', 'develop']);
  assert.deepEqual(codeql.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']);
  assert.deepEqual(codeql.on.schedule, [{ cron: '0 23 * * 6' }]);
  assert.equal(codeql.on.pull_request_target, undefined);
  assert.deepEqual(Object.keys(codeql.jobs), ['scan_route', 'analyze']);
  const route = codeql.jobs.scan_route;
  assert.deepEqual(route.permissions, {});
  assert.deepEqual(route.outputs, { scan: '${{ steps.route.outputs.scan }}' });
  assert.equal(route.steps.length, 1);
  assert.equal(route.steps[0].id, 'route');
  assert.deepEqual(route.steps[0].env, {
    EVENT_NAME: '${{ github.event_name }}',
    HEAD_REPOSITORY: '${{ github.event.pull_request.head.repo.full_name }}',
    REPOSITORY: '${{ github.repository }}',
    HEAD_BRANCH: '${{ github.event.pull_request.head.ref }}',
  });
  const job = codeql.jobs.analyze;
  assert.equal(job.needs, 'scan_route');
  assert.deepEqual(job.permissions, { actions: 'read', contents: 'read', 'security-events': 'write' });
  assert.deepEqual(job.strategy.matrix.language, ['javascript']);
  const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
  assert.equal(checkout.with?.ref, undefined); // PR-only scans retain the default merge ref.
  assert.ok(job.steps.some(step => step.uses === 'github/codeql-action/analyze@v3'));
});

test('CodeQL skips only PR duplicates whose own repository branch is push-scanned', () => {
  const codeql = workflow('codeql-analysis.yml');
  const job = codeql.jobs.analyze;
  function decision(event, fork = false, branch) {
    const github = context(event, fork, branch);
    const head = github.event?.pull_request.head;
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', codeql.jobs.scan_route.steps[0].run], {
      encoding: 'utf8', env: { PATH: process.env.PATH, EVENT_NAME: github.event_name,
        HEAD_REPOSITORY: head?.repo.full_name || '', REPOSITORY: github.repository,
        HEAD_BRANCH: head?.ref || '', GITHUB_OUTPUT: '/dev/stdout' },
    });
    assert.equal(result.status, 0, result.stderr);
    const scan = result.stdout.match(/^scan=(true|false)\n$/)?.[1];
    assert.ok(scan, 'The actual routing script must emit one valid scan output');
    const extraContext = { needs: { scan_route: { outputs: { scan } } } };
    return { runs: evaluate(job.if, github, extraContext), name: evaluate(job.name, github, extraContext) };
  }
  for (const branch of ['main', 'develop', 'feature/change', 'feature/nested/change']) {
    assert.deepEqual(decision('push', false, branch), { runs: true, name: 'Analyze' });
    assert.deepEqual(decision('pull_request', false, branch), { runs: false, name: 'Internal PR - covered by push' });
    assert.deepEqual(decision('pull_request', true, branch), { runs: true, name: 'Analyze' });
  }
  for (const branch of ['codex/change', 'fix/change', 'feature-not-covered/change', 'release/change',
    'Main', 'Develop', 'Feature/change']) {
    for (const fork of [false, true]) {
      assert.deepEqual(decision('pull_request', fork, branch), { runs: true, name: 'Analyze' });
    }
  }
  assert.deepEqual(decision('schedule'), { runs: true, name: 'Analyze' });
});
