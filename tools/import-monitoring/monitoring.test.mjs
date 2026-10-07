import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildImportMonitoring, metricType, OWNER } from './definitions.mjs';
import { applyImportMonitoring } from './cli.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
const project = 'demo-import-monitor';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildImportMonitoring(project, channel);

test('fixed-label metrics distinguish committed imports, attempts, dispatch and bounded samples', () => {
  const config = bundle();
  assert.equal(config.metrics.length, 11);
  for (const metric of config.metrics) {
    assert.ok(metric.description.startsWith(`[${OWNER}]`));
    assert.equal(metric.metricDescriptor.metricKind, 'DELTA');
    assert.deepEqual(metric.metricDescriptor.labels.map(label => label.key).sort(), metric.name.includes('committed') || metric.name.includes('worker_attempts') ? ['outcome', 'provider'] : ['provider']);
    assert.match(metric.filter, /telemetryVersion=1/);
    assert.match(metric.filter, /"garmin" OR "suunto" OR "coros" OR "wahoo"/);
    assert.equal(metric.metricDescriptor.valueType, metric.valueExtractor ? 'DISTRIBUTION' : 'INT64');
  }
  const dlq = config.metrics.find(metric => metric.name.includes('new_dead_letters'));
  assert.match(dlq.filter, /event="committed"/);
  assert.doesNotMatch(dlq.filter, /failed_jobs|already_dead_lettered/);
  assert.match(config.metrics.find(metric => metric.name.includes('processing_failures')).filter, /outcome=\("retry" OR "failed"\)/);
  assert.doesNotMatch(JSON.stringify(config), /EXTRACT\(jsonPayload\.(uid|id|title|error|token|payload|callback)/);
});

test('all charts and policies reference defined or exact native queue metrics, with resource types', () => {
  const config = bundle();
  const types = config.metrics.map(metric => `logging.googleapis.com/user/${metric.name}`);
  for (const tile of config.dashboard.mosaicLayout.tiles.slice(1)) {
    const query = tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
    const type = /metric.type="([^"]+)"/.exec(query.filter)[1];
    assert.ok(types.includes(type) || type.startsWith('cloudtasks.googleapis.com/queue/'));
    if (type.startsWith('cloudtasks')) assert.match(query.filter, /queue_id="processWorkoutTask"/);
    assert.match(query.filter, /resource.type=/);
  }
  assert.equal(config.policies.length, 6);
  for (const policy of config.policies) {
    assert.equal(policy.userLabels.managed_by, OWNER);
    assert.deepEqual(policy.notificationChannels, [channel]);
    assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    assert.doesNotMatch(JSON.stringify(policy), /UID_VALUE|PRIVATE_TOKEN/);
    for (const condition of policy.conditions) {
      const definition = condition.conditionThreshold || condition.conditionAbsent;
      assert.match(definition.filter, /resource.type=/);
      assert.doesNotMatch(definition.filter, /\sOR\s/);
      if (condition.conditionThreshold) assert.equal(definition.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
    }
  }
  const overdue = config.policies[0].conditions[0].conditionThreshold;
  assert.equal(overdue.aggregations[0].alignmentPeriod, '5400s');
  assert.equal(overdue.thresholdValue, 1);
  assert.deepEqual(overdue.aggregations[0].groupByFields, ['metric.label.provider']);
  const absence = config.policies.at(-1).conditions.slice(1);
  assert.equal(absence.length, 4);
  assert.ok(absence.every(condition => condition.conditionAbsent.duration === '7200s'));
  assert.equal(metricType('committed'), 'logging.googleapis.com/user/qs_import_committed_v1');
});

test('preview is offline and uses no credentials; CI runs these definitions', () => {
  const result = spawnSync(process.execPath, ['tools/import-monitoring/cli.mjs', `--project=${project}`], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).policies[0].notificationChannels.length, 0);
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /npm run test:import-monitoring/);
});

function transport(existing = false, collision = false) {
  const config = bundle(); const training = buildTrainingMonitoring(project, channel); const calls = [];
  return { calls, request: async (method, url, body) => {
    calls.push({ method, url, body });
    if (method !== 'GET') return { name: `projects/${project}/dashboards/imports` };
    if (url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: true };
    if (url.endsWith('/dashboards')) return { dashboards: [{ ...training.dashboard, name: `projects/${project}/dashboards/training`, etag: 'old' },
      ...(existing || collision ? [{ ...config.dashboard, labels: collision ? training.dashboard.labels : config.dashboard.labels,
        name: `projects/${project}/dashboards/imports`, etag: 'etag' }] : [])] };
    if (url.endsWith('/alertPolicies')) return { alertPolicies: [...training.policies.map((policy, i) => ({ ...policy, name: `projects/${project}/alertPolicies/training-${i}` })),
      ...(existing ? config.policies.map((policy, i) => ({ ...policy, name: `projects/${project}/alertPolicies/import-${i}`,
        conditions: policy.conditions.map((condition, j) => ({ ...condition, name: `projects/${project}/alertPolicies/import-${i}/conditions/${j}` })) })) : [])] };
    if (url.endsWith('/metrics')) return { metrics: [...training.metrics, ...(existing ? config.metrics : [])] };
    throw new Error('Unexpected synthetic request');
  } };
}
test('creation and serial reapply preserve Training/unrelated resources, etags and condition IDs', async () => {
  for (const existing of [false, true]) {
    const { calls, request } = transport(existing);
    const result = await applyImportMonitoring(bundle(), request);
    assert.equal(result.metrics, 11); assert.equal(result.policies, 6);
    assert.equal(calls.filter(call => call.method === 'POST').length, existing ? 0 : 7);
    assert.ok(calls.filter(call => call.method !== 'GET').every(call => !call.url.includes('training')));
    assert.ok(calls.every(call => call.method !== 'DELETE'));
    if (existing) {
      const patches = calls.filter(call => call.method === 'PATCH');
      assert.equal(patches[0].body.etag, 'etag');
      assert.equal(patches[1].body.conditions[0].name, `projects/${project}/alertPolicies/import-0/conditions/0`);
    }
  }
});
test('cross-bundle ownership or title collisions fail before any cloud write', async () => {
  const collision = transport(false, true);
  await assert.rejects(applyImportMonitoring(bundle(), collision.request), /unowned/);
  assert.ok(collision.calls.every(call => call.method === 'GET'));
  const other = transport();
  await assert.rejects(applyImportMonitoring(buildTrainingMonitoring(project, channel), other.request), /mismatched/);
  assert.equal(other.calls.length, 0);
});
