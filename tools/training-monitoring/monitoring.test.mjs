import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildTrainingMonitoring, metricType, OWNER } from './definitions.mjs';
import { applyTrainingMonitoring } from './apply.mjs';
import { parseArguments } from './cli.mjs';

const project = 'demo-training-alerts';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildTrainingMonitoring(project, channel);

test('definitions use valid counter/distribution kinds and bounded, non-private labels', () => {
  const config = bundle();
  assert.equal(config.metrics.length, 14);
  assert.equal(new Set(config.metrics.map(metric => metric.name)).size, config.metrics.length);
  for (const metric of config.metrics) {
    assert.equal(metric.metricDescriptor.metricKind, 'DELTA');
    assert.ok(['INT64', 'DISTRIBUTION'].includes(metric.metricDescriptor.valueType));
    assert.ok(metric.filter.includes(`resource.labels.project_id="${project}"`));
    assert.deepEqual(Object.keys(metric.labelExtractors), metric.metricDescriptor.labels.map(label => label.key));
    assert.ok(metric.metricDescriptor.labels.every(label => ['provider', 'category', 'event'].includes(label.key)));
    if (metric.valueExtractor) {
      assert.equal(metric.metricDescriptor.valueType, 'DISTRIBUTION');
      assert.ok(metric.bucketOptions.explicitBuckets.bounds.every((value, i, values) => i === 0 || value > values[i - 1]));
    }
  }
  assert.doesNotMatch(JSON.stringify(config), /EXTRACT\(jsonPayload\.(uid|deliveryId|title|error|remote)/);
});

test('dashboard references registered or native queue metrics with honest sample/attempt labels', () => {
  const config = bundle();
  const types = config.metrics.map(metric => `logging.googleapis.com/user/${metric.name}`);
  for (const tile of config.dashboard.mosaicLayout.tiles.slice(1)) {
    const query = tile.widget.xyChart.dataSets[0].timeSeriesQuery;
    const type = /metric.type="([^"]+)"/.exec(query.timeSeriesFilter.filter)[1];
    assert.ok(types.includes(type) || type.startsWith('cloudtasks.googleapis.com/queue/'));
    const distribution = config.metrics.find(metric => type.endsWith(metric.name))?.valueExtractor
      || type.endsWith('task_attempt_delays');
    if (type === metricType('queue_due') || type === metricType('queue_due_age')) {
      assert.equal(query.timeSeriesFilter.aggregation.perSeriesAligner, 'ALIGN_SUM');
      assert.equal(query.timeSeriesFilter.aggregation.crossSeriesReducer, 'REDUCE_MEAN');
    } else if (distribution) assert.equal(query.timeSeriesFilter.aggregation.perSeriesAligner, 'ALIGN_PERCENTILE_95');
  }
  assert.match(JSON.stringify(config.dashboard), /processTrainingDeliveryTask/);
  assert.match(JSON.stringify(config.dashboard), /lower bound/);
  assert.match(JSON.stringify(config.dashboard), /not provider acceptance/);
});

test('policies require sustained/multi-observation conditions and send open/closed notifications', () => {
  const config = bundle();
  assert.equal(config.policies.length, 6);
  for (const policy of config.policies) {
    assert.equal(policy.userLabels.managed_by, OWNER);
    assert.deepEqual(policy.notificationChannels, [channel]);
    assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    assert.equal(policy.documentation.links.length, 3);
    assert.ok(policy.documentation.links.every(link => link.url.startsWith('https://')));
    for (const condition of policy.conditions) {
      const threshold = condition.conditionThreshold;
      const filter = (threshold || condition.conditionAbsent).filter;
      assert.ok(filter.includes('resource.type="cloud_run_revision"'));
      assert.ok(filter.includes(`resource.labels.project_id="${project}"`));
      if (threshold) {
        assert.equal(threshold.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
        assert.ok(parseInt(threshold.duration) >= 60);
        assert.ok(parseInt(threshold.aggregations[0].alignmentPeriod) >= 300);
      }
    }
  }
  const backlog = config.policies.find(policy => policy.userLabels.policy_id === 'backlog').conditions[0].conditionThreshold;
  assert.equal(backlog.duration, '600s');
  assert.equal(backlog.thresholdValue, 3);
  for (const id of ['provider-failures', 'permissions']) {
    const filter = config.policies.find(policy => policy.userLabels.policy_id === id).conditions[0].conditionThreshold.filter;
    assert.ok(filter.includes('metric.labels.provider="garmin"'));
    assert.ok(!filter.includes('metric.labels.provider="coros"'));
  }
  assert.equal(config.policies.at(-1).conditions[1].conditionAbsent.duration, '1800s');
  assert.equal(metricType('queue_samples'), 'logging.googleapis.com/user/qs_training_queue_samples_v1');
});

test('cleanup errors remain detectable when Firebase logger.error prefixes a stack', () => {
  const metric = bundle().metrics.find(item => item.name === 'qs_training_cleanup_failures_v1');
  assert.ok(metric.filter.includes('jsonPayload.message:"[TrainingWorkoutExpiry]"'));
  assert.ok(metric.filter.includes('"sweep_failed"'));
  assert.ok(metric.filter.includes('NOT jsonPayload.event:*'));
});

test('CLI is offline by default and rejects ambiguous or unconfirmed cloud targets', () => {
  const preview = spawnSync(process.execPath, ['tools/training-monitoring/cli.mjs', `--project=${project}`], { encoding: 'utf8' });
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).project, project);
  for (const args of [[], ['--project=bad/value'], [`--project=${project}`, '--apply'],
    [`--project=${project}`, '--apply', '--confirm-project=another-project', `--notification-channel=${channel}`],
    [`--project=${project}`, '--project=another-project'], [`--project=${project}`, '--token=secret'],
    [`--project=${project}`, '--notification-channel=projects/other-project/notificationChannels/1']]) {
    assert.throws(() => {
      const options = parseArguments(args);
      buildTrainingMonitoring(options.project, options['notification-channel']);
    });
  }
});

function transport({ existing = false, collision = false, duplicate = false, channelType = 'email',
  enabled = true, verificationStatus, metricCollision = false, immutable = false, fail = false } = {}) {
  const config = bundle(); const calls = [];
  const request = async (method, url, body) => {
    calls.push({ method, url, body });
    if (fail && method === 'PUT') throw new Error('Synthetic API failure');
    if (method !== 'GET') return { name: `projects/${project}/dashboards/qa` };
    if (url.endsWith('/notificationChannels/123')) return { type: channelType, enabled, verificationStatus };
    if (url.endsWith('/dashboards')) return { dashboards: [
      { displayName: 'Essentials', name: `projects/${project}/dashboards/unrelated` },
      ...(existing || collision || duplicate ? [{ ...config.dashboard,
        labels: collision ? {} : config.dashboard.labels,
        name: `projects/${project}/dashboards/qa`, etag: 'concurrency-token' }] : []),
      ...(duplicate ? [{ ...config.dashboard, name: `projects/${project}/dashboards/duplicate`, etag: 'etag' }] : []),
    ] };
    if (url.endsWith('/alertPolicies')) return { alertPolicies: [
      { displayName: 'Queue OOM Alert', name: `projects/${project}/alertPolicies/unrelated` },
      ...(existing ? config.policies.map((policy, i) => ({ ...policy, name: `projects/${project}/alertPolicies/${i}`,
        conditions: policy.conditions.map((condition, j) => ({ ...condition, name: `projects/${project}/alertPolicies/${i}/conditions/${j}` })) })) : []),
    ] };
    if (url.endsWith('/metrics')) return { metrics: metricCollision ? [{ ...config.metrics[0], description: 'Unrelated metric' }]
      : immutable ? [{ ...config.metrics[0], metricDescriptor: { ...config.metrics[0].metricDescriptor, valueType: 'DOUBLE' } }]
        : existing ? config.metrics : [] };
    throw new Error('Unexpected request');
  };
  return { request, calls };
}

test('provisioning creates only owned resources and reuses the existing email channel', async () => {
  const { request, calls } = transport();
  await applyTrainingMonitoring(bundle(), request);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 14);
  assert.equal(calls.filter(call => call.method === 'POST').length, 7);
  assert.ok(!calls.some(call => call.method === 'DELETE' || call.url.includes('/unrelated')));
  assert.ok(!calls.some(call => call.method !== 'GET' && call.url.includes('/notificationChannels')));
});

test('serial reapply updates stable IDs, preserves condition IDs/dashboard etag, and creates no duplicates', async () => {
  const { request, calls } = transport({ existing: true });
  await applyTrainingMonitoring(bundle(), request);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  const patches = calls.filter(call => call.method === 'PATCH');
  assert.equal(patches.length, 7);
  assert.equal(patches[0].body.etag, 'concurrency-token');
  assert.equal(patches[1].body.conditions[0].name, `projects/${project}/alertPolicies/0/conditions/0`);
});

test('collisions, duplicate managed resources and invalid channels fail before cloud writes', async () => {
  for (const options of [{ collision: true }, { duplicate: true }, { channelType: 'sms' },
    { enabled: false }, { verificationStatus: 'UNVERIFIED' }, { metricCollision: true }, { immutable: true }]) {
    const { request, calls } = transport(options);
    await assert.rejects(applyTrainingMonitoring(bundle(), request));
    assert.ok(calls.every(call => call.method === 'GET'));
  }
  const { request, calls } = transport();
  await assert.rejects(applyTrainingMonitoring(buildTrainingMonitoring(project), request));
  assert.equal(calls.length, 0);
});

test('failed metric creation prevents policies referring to uncreated metrics', async () => {
  const { request, calls } = transport({ fail: true });
  await assert.rejects(applyTrainingMonitoring(bundle(), request), /Synthetic API failure/);
  assert.ok(!calls.some(call => call.method === 'POST' || call.method === 'PATCH'));
});
