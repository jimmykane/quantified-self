import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildHealthSleepMonitoring, OWNER } from './definitions.mjs';
import { applyHealthSleepMonitoring } from './cli.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
const project = 'demo-health-monitor'; const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildHealthSleepMonitoring(project, channel);
const nativeTaskMetrics = new Set([
  'cloudtasks.googleapis.com/queue/depth',
  'cloudtasks.googleapis.com/queue/task_attempt_count',
  'cloudtasks.googleapis.com/queue/task_attempt_delays',
]);
const filterMetricType = filter => /(?:^|\s)metric\.type="([^"]+)"/.exec(filter)?.[1];

function assertDashboardMetricScope(config) {
  const logMetricTypes = config.metrics.map(metric => `logging.googleapis.com/user/${metric.name}`);
  for (const tile of config.dashboard.mosaicLayout.tiles.slice(1)) {
    const query = tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
    // This is a Monitoring filter, not a URL. Compare its metric.type value exactly.
    const type = filterMetricType(query.filter);
    assert.ok(logMetricTypes.includes(type) || nativeTaskMetrics.has(type), 'Unexpected dashboard metric type');
    if (nativeTaskMetrics.has(type)) {
      assert.match(query.filter, /resource\.type="cloud_tasks_queue"/);
      assert.match(query.filter, /resource\.labels\.location="europe-west2"/);
      assert.match(query.filter, /resource\.labels\.queue_id=\("processSleepSyncTask" OR "processGarminHealthBackfillTask"\)/);
    }
  }
}
function assertPolicyMetricScope(config) {
  const logMetricTypes = config.metrics.map(metric => `logging.googleapis.com/user/${metric.name}`);
  for (const policy of config.policies) for (const condition of policy.conditions) {
    const filter = (condition.conditionThreshold || condition.conditionAbsent).filter;
    assert.ok(logMetricTypes.includes(filterMetricType(filter)), 'Alerts must use registered log metric types, not native contention retries');
  }
}

test('fixed dimensions separate durable outcomes, invocation summaries, retries and paced backfill', () => {
  const config = bundle(); assert.equal(config.metrics.length, 11); assert.equal(config.policies.length, 6);
  for (const metric of config.metrics) {
    assert.ok(metric.description.startsWith(`[${OWNER}]`)); assert.match(metric.filter, /telemetryVersion=1/);
    assert.match(metric.filter, /workload=/); assert.match(metric.filter, /resource.type=/);
    assert.equal(metric.metricDescriptor.metricKind, 'DELTA');
    assert.deepEqual(metric.metricDescriptor.labels.map(label => label.key).sort(), metric.name.endsWith('committed_v1') || metric.name.endsWith('worker_attempts_v1') ? ['outcome', 'provider', 'workload'] : ['provider', 'workload']);
    assert.equal(metric.metricDescriptor.valueType, metric.valueExtractor ? 'DISTRIBUTION' : 'INT64');
  }
  assert.doesNotMatch(JSON.stringify(config), /EXTRACT\(jsonPayload\.(uid|id|title|error|token|payload|callback)/);
  const failures = config.metrics.find(metric => metric.name.includes('worker_failures'));
  assert.doesNotMatch(failures.filter, /retry_incremented|expected_contention|moved_to_dlq|already_failed/);
  assert.match(config.metrics.find(metric => metric.name.includes('new_dead_letters')).filter, /event="committed"/);
  assert.doesNotMatch(config.metrics.find(metric => metric.name.includes('new_dead_letters')).filter, /failed_jobs/);
});
test('every native chart targets only the two exact queues; policies have workload-specific thresholds', () => {
  const config = bundle(); assertDashboardMetricScope(config); assertPolicyMetricScope(config);
  for (const policy of config.policies) {
    assert.equal(policy.enabled, true); assert.equal(policy.userLabels.managed_by, OWNER); assert.deepEqual(policy.notificationChannels, [channel]);
    assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    for (const c of policy.conditions) {
      const q = c.conditionThreshold || c.conditionAbsent; assert.match(q.filter, /resource.type=/);
      if (c.conditionThreshold) assert.equal(q.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
    }
  }
  const backlog = config.policies.find(p => p.userLabels.policy_id === 'backlog').conditions;
  assert.equal(backlog[0].conditionThreshold.aggregations[0].alignmentPeriod, '5400s');
  assert.equal(backlog[1].conditionThreshold.aggregations[0].alignmentPeriod, '14400s');
  assert.equal(config.policies.find(p => p.userLabels.policy_id === 'heartbeat').conditions.filter(c => c.conditionAbsent).length, 4);
  assert.equal(config.policies.find(p => p.userLabels.policy_id === 'telemetry').conditions.length, 2);
});
test('alert scopes reject native retries, unknown metrics and metric names outside the actual type field', () => {
  for (const filter of [
    'metric.type="cloudtasks.googleapis.com/queue/task_attempt_count"',
    'metric.type="logging.googleapis.com/user/unregistered"',
    'note="logging.googleapis.com/user/qs_health_sleep_probe_failures_v1"',
  ]) {
    const config = bundle(); config.policies[0].conditions[0].conditionThreshold.filter = filter;
    assert.throws(() => assertPolicyMetricScope(config), /Alerts must use registered log metric types/);
  }
});
test('metric classification rejects lookalikes, missing types and queue names outside the actual scope', () => {
  for (const filter of [
    'metric.type="evil.cloudtasks.googleapis.com/queue/depth"',
    'metric.type="cloudtasks.googleapis.com.evil/queue/depth"',
    'metric.type="cloudtasks.googleapis.com/queue/unknown"',
    'resource.type="cloud_tasks_queue" note="cloudtasks.googleapis.com/queue/depth"',
  ]) {
    const config = bundle();
    config.dashboard.mosaicLayout.tiles[1].widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter.filter = filter;
    assert.throws(() => assertDashboardMetricScope(config), /Unexpected dashboard metric type/);
  }
  const config = bundle();
  const query = config.dashboard.mosaicLayout.tiles[1].widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
  query.filter = query.filter.replace('resource.labels.queue_id=("processSleepSyncTask" OR "processGarminHealthBackfillTask")',
    'resource.labels.queue_id="unrelated" note="processSleepSyncTask processGarminHealthBackfillTask"');
  assert.throws(() => assertDashboardMetricScope(config));
});
test('offline preview needs no network or credentials and CI covers definitions', () => {
  const r = spawnSync(process.execPath, ['tools/health-sleep-monitoring/cli.mjs', `--project=${project}`], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
  assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).policies[0].notificationChannels.length, 0);
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /npm run test:health-sleep-monitoring/);
});
function transport(existing = false, collision = false) {
  const config = bundle(); const others = [buildImportMonitoring(project, channel), buildTrainingMonitoring(project, channel)]; const calls = [];
  return { calls, request: async (method, url, body) => {
    calls.push({ method, url, body });
    if (method !== 'GET') return { name: `projects/${project}/dashboards/health` };
    if (url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: true };
    if (url.endsWith('/dashboards')) return { dashboards: [...others.map((b, i) => ({ ...b.dashboard, name: `projects/${project}/dashboards/other-${i}`, etag: 'other' })), ...(existing || collision ? [{ ...config.dashboard, labels: collision ? {} : config.dashboard.labels, name: `projects/${project}/dashboards/health`, etag: 'etag' }] : [])] };
    if (url.endsWith('/alertPolicies')) return { alertPolicies: [...others.flatMap((b, i) => b.policies.map((p, j) => ({ ...p, name: `projects/${project}/alertPolicies/other-${i}-${j}` }))), ...(existing ? config.policies.map((p, i) => ({ ...p, name: `projects/${project}/alertPolicies/health-${i}`, conditions: p.conditions.map((c, j) => ({ ...c, name: `projects/${project}/alertPolicies/health-${i}/conditions/${j}` })) })) : [])] };
    if (url.endsWith('/metrics')) return { metrics: [...others.flatMap(b => b.metrics), ...(existing ? config.metrics : [])] };
    throw new Error('Unexpected synthetic request');
  } };
}
test('create/reapply preserves import/Training resources, condition IDs and etags without deletion', async () => {
  for (const existing of [false, true]) {
    const source = transport(existing); const result = await applyHealthSleepMonitoring(bundle(), source.request);
    assert.equal(result.metrics, 11); assert.equal(result.policies, 6);
    assert.equal(source.calls.filter(c => c.method === 'POST').length, existing ? 0 : 7);
    assert.ok(source.calls.every(c => c.method !== 'DELETE'));
    assert.ok(source.calls.filter(c => c.method !== 'GET').every(c => !c.url.includes('other-')));
    if (existing) { const patches = source.calls.filter(c => c.method === 'PATCH'); assert.equal(patches[0].body.etag, 'etag'); assert.equal(patches[1].body.conditions[0].name, `projects/${project}/alertPolicies/health-0/conditions/0`); }
  }
});
test('ownership collisions and malformed inventories fail before writes', async () => {
  const collision = transport(false, true); await assert.rejects(applyHealthSleepMonitoring(bundle(), collision.request), /unowned/); assert.ok(collision.calls.every(c => c.method === 'GET'));
  for (const key of ['dashboards', 'alertPolicies', 'metrics']) {
    const source = transport(true); await assert.rejects(applyHealthSleepMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body); return method === 'GET' && url.endsWith(`/${key}`) ? { [key]: [{}] } : result;
    }), /Malformed monitoring inventory/); assert.ok(source.calls.every(c => c.method === 'GET'));
  }
});
