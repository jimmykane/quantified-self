import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { load } from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = file => load(readFileSync(resolve(root, '.github/workflows', file), 'utf8'));
const testing = workflow('testing.yaml');
const shared = workflow('_run-tests.yml');
const requiredJobs = ['unit_tests', 'functions_tests', 'functions_build', 'frontend_plan', 'frontend_tests', 'rules_tests', 'functions_emulators', 'delivery_plan', 'delivery_emulators'];
const resultVariables = {
  UNIT_RESULT: 'unit_tests', FUNCTIONS_RESULT: 'functions_tests', FRONTEND_RESULT: 'frontend_tests',
  FUNCTIONS_BUILD_RESULT: 'functions_build', FRONTEND_PLAN_RESULT: 'frontend_plan',
  RULES_RESULT: 'rules_tests', EMULATOR_RESULT: 'functions_emulators',
  DELIVERY_PLAN_RESULT: 'delivery_plan', DELIVERY_RESULT: 'delivery_emulators',
};

test('every check job uses the declared Functions Node runtime', () => {
  const functionsPackage = JSON.parse(readFileSync(resolve(root, 'functions/package.json'), 'utf8'));
  for (const id of requiredJobs) {
    const job = shared.jobs[id];
    const nodeSetup = job.steps.find(step => step.uses === 'actions/setup-node@v4');
    assert.equal(nodeSetup?.with['node-version'], functionsPackage.engines.node);
  }
});

test('Functions CI runs the complete suite serially and keeps runner errors fatal', () => {
  const steps = shared.jobs.functions_tests.steps;
  const functionsStep = steps.find(step => step.name === 'Install and test functions');
  const commands = functionsStep.run.split('\n').map(line => line.trim());
  assert.ok(commands.includes('npm ci'));
  assert.ok(commands.includes('npm run lint'));
  assert.ok(commands.includes('npm run test -- --no-file-parallelism'));
  assert.ok(!commands.includes('npm run build'));
  assert.ok(!commands.includes('npm run entrypoint:check:compiled'));
  assert.ok(!commands.includes('npm run mcp:contract:check:compiled'));
  assert.doesNotMatch(functionsStep.run, /dangerouslyIgnoreUnhandledErrors|passWithNoTests|\|\|\s*true/);
});

test('Functions build and compiled checks run independently with the same comparison revision', () => {
  const steps = shared.jobs.functions_build.steps;
  const functionsStep = steps.find(step => step.name === 'Build and verify functions');
  const commands = functionsStep.run.split('\n').map(line => line.trim());
  for (const command of ['npm ci', 'npm run build', 'npm run entrypoint:check:compiled', 'npm run mcp:contract:check:compiled']) {
    assert.ok(commands.includes(command));
  }
  assert.ok(!commands.includes('npm run test -- --no-file-parallelism'));
  const comparison = '${{ github.event.pull_request.base.sha || github.event.before }}';
  assert.equal(functionsStep.env.MCP_CONTRACT_PREVIOUS_REVISION, comparison);
  const fetch = steps.find(step => step.name === 'Fetch MCP contract comparison revision');
  assert.equal(fetch.env.MCP_CONTRACT_PREVIOUS_REVISION, comparison);
  assert.ok(steps.indexOf(fetch) < steps.indexOf(functionsStep));
  const sharedDependencies = steps.find(step => step.run === 'npm ci');
  assert.ok(sharedDependencies, 'Compiled shared sources require root dependencies');
  assert.ok(steps.indexOf(sharedDependencies) < steps.indexOf(functionsStep));
  assert.equal(steps.find(step => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0);
  assert.doesNotMatch(functionsStep.run, /dangerouslyIgnoreUnhandledErrors|passWithNoTests|\|\|\s*true/);
});

test('app CI checks discovery and runs two complete, independently isolated frontend shards', () => {
  const job = shared.jobs.frontend_tests;
  assert.equal(job.needs, 'frontend_plan');
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix, { shard: [1, 2] });
  const steps = shared.jobs.frontend_tests.steps;
  const discovery = steps.find(step => step.run === 'npm run test:frontend-config');
  assert.ok(discovery);
  const app = steps.find(step => step.name === 'Run app tests');
  assert.ok(steps.indexOf(discovery) < steps.indexOf(app));
  assert.equal(app.run, 'npm run test -- --run --shard=${{ matrix.shard }}/2 --reporter=default --reporter=json --reporter=./tools/frontend-test-timing-reporter.mjs --outputFile=tmp/frontend-shards/report/report.json');
  assert.equal(app.env.NODE_OPTIONS, '--max-old-space-size=3072');
  assert.equal(app.env.QS_FRONTEND_SHARD_PLAN, 'tmp/frontend-shards/plan.json');
  assert.equal(app.env.QS_FRONTEND_TIMING_REPORT, 'tmp/frontend-shards/report/timing.json');
  const plan = steps.find(step => step.uses === 'actions/download-artifact@v4');
  assert.equal(plan.with.name, 'frontend-shard-plan');
  assert.equal(plan.with.path, 'tmp/frontend-shards');
  assert.ok(steps.indexOf(plan) < steps.indexOf(app));
  const upload = steps.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.with.name, 'frontend-report-${{ matrix.shard }}');
  assert.equal(upload.with['if-no-files-found'], 'error');
});

test('all frontend runners share one discovered plan and only a fully verified gate saves timings', () => {
  const plan = shared.jobs.frontend_plan.steps;
  assert.ok(plan.some(step => step.run === 'npm run test:frontend-config'));
  assert.ok(plan.some(step => step.run === 'npm run test:frontend-shards'));
  assert.ok(plan.some(step => step.run === 'node tools/frontend-test-shard-cli.mjs plan tmp/frontend-timings/history.json tmp/frontend-shards/plan.json'));
  const upload = plan.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.with.name, 'frontend-shard-plan');
  assert.equal(upload.with['if-no-files-found'], 'error');
  const restore = plan.find(step => step.uses === 'actions/cache/restore@v4');
  const gate = shared.jobs.run_tests.steps;
  const merge = gate.find(step => step.name === 'Require complete frontend shard reports');
  const save = gate.find(step => step.uses === 'actions/cache/save@v4');
  assert.equal(merge.run, 'node tools/frontend-test-shard-cli.mjs merge tmp/frontend-shards/plan.json tmp/frontend-shards/reports tmp/frontend-timings/history.json');
  assert.ok(gate.indexOf(merge) < gate.indexOf(save));
  assert.equal(save.with.key, restore.with.key);
  assert.equal(save.with.path, restore.with.path);
  assert.ok(restore.with['restore-keys'].endsWith('-\n'));
  const reports = gate.find(step => step.with?.pattern === 'frontend-report-*');
  assert.equal(reports.with['merge-multiple'], undefined, 'Keep reports separate to reject missing/duplicate files');
  assert.ok(!gate.some(step => step.run === 'npm ci'), 'Report validation must use Node built-ins');
});

test('delivery runners share one plan, isolated emulators and strict reports before either timing cache is saved', () => {
  const planner = shared.jobs.delivery_plan;
  assert.equal(planner.needs, undefined);
  assert.ok(!planner.steps.some(step => /npm ci|firebase emulators/.test(step.run || '')));
  assert.ok(planner.steps.some(step => step.run === 'npm run test:delivery-shards'));
  assert.ok(planner.steps.some(step => step.run === 'node tools/delivery-test-shard-cli.mjs plan tmp/delivery-timings/history.json tmp/delivery-shards/plan.json'));
  const uploadPlan = planner.steps.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(uploadPlan.with.name, 'delivery-shard-plan');
  assert.equal(uploadPlan.with['if-no-files-found'], 'error');
  const restore = planner.steps.find(step => step.uses === 'actions/cache/restore@v4');
  assert.ok(restore.with['restore-keys'].endsWith('-\n'));
  const job = shared.jobs.delivery_emulators;
  assert.equal(job.needs, 'delivery_plan');
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix, { shard: [1, 2] });
  assert.equal(job['timeout-minutes'], 25);
  assert.ok(job.steps.some(step => step.uses === 'actions/setup-java@v4' && step.with['java-version'] === '21'));
  const download = job.steps.find(step => step.uses === 'actions/download-artifact@v4');
  assert.equal(download.with.name, 'delivery-shard-plan');
  assert.equal(download.with.path, 'tmp/delivery-shards');
  const run = job.steps.find(step => step.name === 'Run isolated delivery emulator tests');
  assert.equal(run.run, 'npm run test:functions-emulators -- delivery --plan tmp/delivery-shards/plan.json --shard ${{ matrix.shard }} --output tmp/delivery-shards/report');
  assert.ok(job.steps.indexOf(download) < job.steps.indexOf(run));
  const upload = job.steps.find(step => step.uses === 'actions/upload-artifact@v4');
  assert.equal(upload.with.name, 'delivery-report-${{ matrix.shard }}');
  assert.equal(upload.with.path, 'tmp/delivery-shards/report');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.deepEqual(shared.jobs.functions_emulators.strategy.matrix.group, ['lifecycle', 'completion', 'mcp-data']);
  const gate = shared.jobs.run_tests.steps;
  const merge = gate.find(step => step.name === 'Require complete delivery shard reports');
  assert.equal(merge.run, 'node tools/delivery-test-shard-cli.mjs merge tmp/delivery-shards/plan.json tmp/delivery-shards/reports tmp/delivery-timings/history.json');
  const reportDownload = gate.find(step => step.with?.pattern === 'delivery-report-*');
  assert.equal(reportDownload.with['merge-multiple'], undefined);
  assert.ok(gate.indexOf(reportDownload) < gate.indexOf(merge));
  for (const save of gate.filter(step => step.uses === 'actions/cache/save@v4')) {
    assert.ok(gate.indexOf(merge) < gate.indexOf(save), 'All required reports must pass before publishing timings');
  }
  const save = gate.find(step => step.name === 'Save successful delivery timings');
  assert.equal(save.with.key, restore.with.key);
  assert.equal(save.with.path, restore.with.path);
});

test('independent jobs retain every validation and Rules check without weakening failures', () => {
  assert.deepEqual(Object.keys(shared.jobs).sort(), [...requiredJobs, 'run_tests'].sort());
  for (const id of requiredJobs) {
    const job = shared.jobs[id];
    assert.equal(job.needs, { frontend_tests: 'frontend_plan', delivery_emulators: 'delivery_plan' }[id], `${id} has unexpected dependencies`);
    assert.equal(job.if, undefined, `${id} must run for every test invocation`);
    assert.equal(job['continue-on-error'] ?? false, false);
    assert.ok(job.steps.every(step => !step.if && !step['continue-on-error']));
    if (id !== 'delivery_plan') assert.ok(job.steps.some(step => step.run?.split('\n').includes('npm ci')));
  }
  const validationCommands = ['credentials:test', 'test:emulator-coverage', 'test:delivery-shards', 'test:workflows',
    'test:training-monitoring', 'test:import-monitoring', 'test:health-sleep-monitoring',
    'test:activity-delivery-monitoring', 'test:route-monitoring', 'plugin:tools', 'plugin:validate', 'lint'];
  const runs = shared.jobs.unit_tests.steps.flatMap(step => step.run?.split('\n').map(line => line.trim()) ?? []);
  for (const command of validationCommands) assert.ok(runs.includes(`npm run ${command}`), command);
  assert.ok(runs.includes('npm --prefix tools/quantified-self-plugin test'));
  assert.ok(runs.includes('git diff --exit-code'));
  const credentials = shared.jobs.unit_tests.steps.find(step => step.uses?.startsWith('gitleaks/gitleaks-action@'));
  assert.ok(credentials);
  assert.equal(credentials.env.GITLEAKS_ENABLE_COMMENTS, 'false');
  assert.equal(credentials.env.GITLEAKS_ENABLE_UPLOAD_ARTIFACT, 'false');
  assert.equal(shared.jobs.unit_tests.steps.find(step => step.uses === 'actions/checkout@v4').with['fetch-depth'], 0);
  const rules = shared.jobs.rules_tests.steps;
  assert.ok(rules.some(step => step.uses === 'actions/setup-java@v4' && step.with['java-version'] === '21'));
  assert.ok(rules.some(step => step.run === 'npm install -g firebase-tools'));
  assert.ok(rules.some(step => step.run === 'npm run test:rules'));
  for (const command of ['npm run test:rules', 'npm run lint']) {
    const owners = requiredJobs.filter(id => shared.jobs[id].steps.some(step => step.run === command));
    assert.equal(owners.length, 1, `${command} must run exactly once`);
  }
});

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
  assert.deepEqual(shared.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(testing.jobs['run-tests'].secrets, undefined);
  assert.equal(testing.jobs['run-tests'].with, undefined);
  for (const id of requiredJobs) {
    const job = shared.jobs[id];
    const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
    assert.equal(checkout.with.ref, '${{ inputs.ref || github.sha }}');
    assert.equal(job.permissions, undefined);
    assert.equal(job.environment, undefined);
    assert.ok(job.steps.every(step => !/google-github-actions\/auth|firebase deploy/.test(step.uses || step.run || '')));
  }
});

test('the existing required check aggregates every real test job and rejects skips/cancellation', () => {
  const gate = shared.jobs.run_tests;
  assert.deepEqual(gate.needs, requiredJobs);
  assert.equal(gate.if, '${{ always() }}');
  assert.equal(gate.name, undefined); // The job id keeps the required run_tests name.
  assert.equal(gate['continue-on-error'] ?? false, false);
  assert.ok(gate.steps.every(step => !step.if && !step['continue-on-error']));
  assert.ok(shared.jobs.unit_tests.steps.some(step => step.run === 'npm run test:workflows'));
  const step = gate.steps[0];
  assert.deepEqual(step.env, Object.fromEntries(Object.entries(resultVariables)
    .map(([variable, job]) => [variable, '${{ needs.' + job + '.result }}'])));
  const success = Object.fromEntries(Object.keys(resultVariables).map(variable => [variable, 'success']));
  function status(results) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      encoding: 'utf8', env: { PATH: process.env.PATH, ...results },
    });
    assert.equal(result.error, undefined);
    return result.status;
  }
  assert.equal(status(success), 0);
  for (const bad of ['failure', 'cancelled', 'skipped', '', 'unknown']) {
    for (const variable of Object.keys(resultVariables)) {
      assert.equal(status({ ...success, [variable]: bad }), 1, `${variable}=${bad}`);
    }
    assert.equal(status(Object.fromEntries(Object.keys(resultVariables).map(variable => [variable, bad]))), 1);
  }
  for (const variable of Object.keys(resultVariables)) {
    const missing = { ...success };
    delete missing[variable];
    assert.equal(status(missing), 1, `${variable} missing`);
  }
});

test('beta and main remain push-only and all deployments depend on the reusable test gate', () => {
  const callers = { 'buildAndDeployBeta.yml': 'run-tests', 'buildAndDeployMain.yml': 'test',
    'deployFunctionsManual.yml': 'test' };
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

test('GitHub releases have no automatic workflow trigger', () => {
  for (const file of readdirSync(resolve(root, '.github/workflows')).filter(file => /\.ya?ml$/.test(file))) {
    const triggers = workflow(file).on;
    const events = typeof triggers === 'string' ? [triggers]
      : Array.isArray(triggers) ? triggers : Object.keys(triggers);
    assert.ok(!events.includes('release'), `${file} must not run when a GitHub release is published`);
  }
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
  // Skipped jobs may display expressions literally; keep the title static.
  assert.equal(job.name, 'Analyze');
  assert.deepEqual(job.permissions, { actions: 'read', contents: 'read', 'security-events': 'write' });
  assert.deepEqual(job.strategy.matrix.language, ['javascript']);
  const checkout = job.steps.find(step => step.uses === 'actions/checkout@v4');
  assert.equal(checkout.with?.ref, undefined); // PR-only scans retain the default merge ref.
  assert.ok(job.steps.some(step => step.uses === 'github/codeql-action/analyze@v3'));
});

test('CodeQL skips only PR duplicates whose own repository branch is push-scanned', t => {
  const codeql = workflow('codeql-analysis.yml');
  const job = codeql.jobs.analyze;
  // GitHub uses a regular output file. /dev/stdout cannot reopen Node's
  // spawnSync pipe on Linux, even though the same test succeeds on macOS.
  const outputDirectory = mkdtempSync(resolve(tmpdir(), 'qs-codeql-routing-'));
  t.after(() => rmSync(outputDirectory, { recursive: true, force: true }));
  let outputNumber = 0;
  function decision(event, fork = false, branch) {
    const github = context(event, fork, branch);
    const head = github.event?.pull_request.head;
    const outputFile = resolve(outputDirectory, `output-${outputNumber++}`);
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', codeql.jobs.scan_route.steps[0].run], {
      encoding: 'utf8', env: { PATH: process.env.PATH, EVENT_NAME: github.event_name,
        HEAD_REPOSITORY: head?.repo.full_name || '', REPOSITORY: github.repository,
        HEAD_BRANCH: head?.ref || '', GITHUB_OUTPUT: outputFile },
    });
    assert.equal(result.status, 0, result.stderr);
    const scan = readFileSync(outputFile, 'utf8').match(/^scan=(true|false)\n$/)?.[1];
    assert.ok(scan, 'The actual routing script must emit one valid scan output');
    const extraContext = { needs: { scan_route: { outputs: { scan } } } };
    return evaluate(job.if, github, extraContext);
  }
  for (const branch of ['main', 'develop', 'feature/change', 'feature/nested/change']) {
    assert.equal(decision('push', false, branch), true);
    assert.equal(decision('pull_request', false, branch), false);
    assert.equal(decision('pull_request', true, branch), true);
  }
  for (const branch of ['codex/change', 'fix/change', 'feature-not-covered/change', 'release/change',
    'Main', 'Develop', 'Feature/change']) {
    for (const fork of [false, true]) {
      assert.equal(decision('pull_request', fork, branch), true);
    }
  }
  assert.equal(decision('schedule'), true);
});
