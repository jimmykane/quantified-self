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

// The two job expressions use only equality, boolean operators and literals;
// evaluate their actual YAML values rather than a second implementation of them.
function evaluate(expression, github) {
  const body = expression.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/)?.[1];
  assert.ok(body, 'Explicit GitHub expression required');
  return runInNewContext(body.replaceAll(' == ', ' === ').replaceAll(' != ', ' !== '), { github }, { timeout: 100 });
}

function context(event, fork = false) {
  const repository = 'owner/project';
  return { event_name: event, repository,
    ...(event === 'pull_request' ? { event: { pull_request: {
      head: { repo: { full_name: fork ? 'contributor/project' : repository } },
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
