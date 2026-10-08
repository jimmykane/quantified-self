import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildActivityDeliveryMonitoring, OWNER, metricType } from './definitions.mjs';
import { applyActivityDeliveryMonitoring } from './cli.mjs';
import { buildHealthSleepMonitoring } from '../health-sleep-monitoring/definitions.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
const project = 'demo-delivery-monitor'; const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildActivityDeliveryMonitoring(project, channel);
const type = filter => /metric\.type="([^"]+)"/.exec(filter)?.[1];

test('fixed dimensions, committed semantics and exact native queue scope', () => {
  const config = bundle(); assert.equal(config.metrics.length, 12); assert.equal(config.policies.length, 7);
  const logTypes = new Set(config.metrics.map(metric => `logging.googleapis.com/user/${metric.name}`));
  const native = new Set(['depth', 'task_attempt_count', 'task_attempt_delays'].map(key => `cloudtasks.googleapis.com/queue/${key}`));
  for (const metric of config.metrics) {
    assert.ok(metric.description.startsWith(`[${OWNER}]`)); assert.match(metric.filter, /telemetryVersion=1/);
    assert.match(metric.filter, /jsonPayload.message="\[ActivityDelivery\]"/);
    assert.ok(metric.metricDescriptor.labels.every(label => ['source', 'destination', 'mode', 'outcome'].includes(label.key)));
    assert.equal(metric.metricDescriptor.metricKind, 'DELTA');
  }
  for (const tile of config.dashboard.mosaicLayout.tiles.slice(1)) {
    const filter = tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter.filter;
    assert.ok(logTypes.has(type(filter)) || native.has(type(filter)));
    assert.match(filter, /resource.labels.project_id="demo-delivery-monitor"/);
    if (native.has(type(filter))) {
      assert.match(filter, /resource.type="cloud_tasks_queue"/); assert.match(filter, /resource.labels.queue_id="processActivitySyncTask"/);
      assert.match(filter, /resource.labels.location="europe-west2"/);
    }
  }
  const failures = config.metrics.find(metric => metric.name.endsWith('worker_failures_v1'));
  assert.doesNotMatch(failures.filter, /provider_pending|expected_contention|acknowledged|manual_reconciliation/);
  for (const key of ['new_dead_letters', 'new_reconciliation']) assert.match(config.metrics.find(m => m.name === `qs_activity_delivery_${key}_v1`).filter, /event="committed"/);
});
test('sustained alerts use bounded metrics, idle heartbeats and explicit missing-data behavior', () => {
  for (const policy of bundle().policies) {
    assert.equal(policy.userLabels.managed_by, OWNER); assert.deepEqual(policy.notificationChannels, [channel]);
    assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    assert.match(policy.documentation.content, /Never blindly resend/);
    for (const condition of policy.conditions) {
      const body = condition.conditionThreshold || condition.conditionAbsent;
      assert.ok(type(body.filter).startsWith('logging.googleapis.com/user/qs_activity_delivery_'));
      if (condition.conditionThreshold) { assert.equal(body.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE'); assert.equal(body.duration, '60s'); }
      else { assert.equal(body.duration, '7200s'); assert.equal(type(body.filter), metricType('queue_samples')); }
    }
  }
  assert.equal(bundle().policies.at(-1).conditions.length, 3);
  assert.doesNotMatch(JSON.stringify(bundle().metrics.map(metric => metric.labelExtractors)), /userID|eventID|uploadID|title|credential|error/i);
});
test('offline preview needs no credentials or network', () => {
  const result = spawnSync(process.execPath, ['tools/activity-delivery-monitoring/cli.mjs', `--project=${project}`], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).policies[0].notificationChannels.length, 0);
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /npm run test:activity-delivery-monitoring/);
});
function transport(existing = false, collision = false) {
  const config = bundle(); const others = [buildTrainingMonitoring(project, channel), buildImportMonitoring(project, channel), buildHealthSleepMonitoring(project, channel)]; const calls = [];
  return { calls, request: async (method, url, body) => {
    calls.push({ method, url, body });
    if (method !== 'GET') return { name: `projects/${project}/dashboards/delivery` };
    if (url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: true };
    if (url.endsWith('/dashboards')) return { dashboards: [...others.map((b, i) => ({ ...b.dashboard, name: `projects/${project}/dashboards/other-${i}`, etag: 'other' })), ...(existing || collision ? [{ ...config.dashboard, labels: collision ? {} : config.dashboard.labels, name: `projects/${project}/dashboards/delivery`, etag: 'etag' }] : [])] };
    if (url.endsWith('/alertPolicies')) return { alertPolicies: [...others.flatMap((b, i) => b.policies.map((p, j) => ({ ...p, name: `projects/${project}/alertPolicies/other-${i}-${j}` }))), ...(existing ? config.policies.map((p, i) => ({ ...p, name: `projects/${project}/alertPolicies/delivery-${i}`, conditions: p.conditions.map((c, j) => ({ ...c, name: `projects/${project}/alertPolicies/delivery-${i}/conditions/${j}` })) })) : [])] };
    if (url.endsWith('/metrics')) return { metrics: [...others.flatMap(b => b.metrics), ...(existing ? config.metrics : [])] };
    throw new Error('Unexpected synthetic request');
  } };
}
test('serial create/reapply preserves other bundles, condition IDs and etags without deletion', async () => {
  for (const existing of [false, true]) {
    const source = transport(existing); const result = await applyActivityDeliveryMonitoring(bundle(), source.request);
    assert.equal(result.metrics, 12); assert.equal(result.policies, 7);
    assert.equal(source.calls.filter(call => call.method === 'POST').length, existing ? 0 : 8);
    assert.ok(source.calls.every(call => call.method !== 'DELETE'));
    assert.ok(source.calls.filter(call => call.method !== 'GET').every(call => !call.url.includes('other-')));
    if (existing) {
      const patches = source.calls.filter(call => call.method === 'PATCH');
      assert.equal(patches[0].body.etag, 'etag'); assert.equal(patches[1].body.conditions[0].name, `projects/${project}/alertPolicies/delivery-0/conditions/0`);
    }
  }
});
test('malformed/unowned inventories and immutable-schema changes fail before writes', async () => {
  const collision = transport(false, true);
  await assert.rejects(applyActivityDeliveryMonitoring(bundle(), collision.request), /unowned/);
  assert.ok(collision.calls.every(call => call.method === 'GET'));
  for (const key of ['dashboards', 'alertPolicies', 'metrics']) {
    const source = transport(true); await assert.rejects(applyActivityDeliveryMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body);
      return method === 'GET' && url.endsWith(`/${key}`) ? { [key]: [{}] } : result;
    }), /Malformed monitoring inventory/);
    assert.ok(source.calls.every(call => call.method === 'GET'));
  }
  const source = transport(true); const config = bundle(); config.metrics[0].metricDescriptor.labels.push({ key: 'new', valueType: 'STRING' });
  await assert.rejects(applyActivityDeliveryMonitoring(config, source.request), /Immutable log metric schema changed/);
  assert.ok(source.calls.every(call => call.method === 'GET'));
});
