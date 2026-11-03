import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildWebPushMonitoring, OWNER } from './definitions.mjs';
import { applyWebPushMonitoring } from './cli.mjs';
const project = 'demo-push-monitoring';
const channel = `projects/${project}/notificationChannels/123`;
test('scope, low-cardinality outcomes and sustained idle-safe failure policy', () => {
  const b = buildWebPushMonitoring(project, channel);
  assert.equal(b.metrics.length, 2); assert.equal(b.policies.length, 2);
  assert.match(b.metrics[0].filter, /service_name="sendtestpushnotification"/);
  assert.match(b.metrics[0].filter, /jsonPayload.outcome=\("accepted" OR "expired" OR "failed"\)/);
  assert.deepEqual(b.metrics[0].metricDescriptor.labels.map(x => x.key), ['outcome']);
  const condition = b.policies[0].conditions[0].conditionThreshold;
  assert.match(condition.filter, /outcome="failed"/); assert.equal(condition.thresholdValue, 2);
  assert.equal(condition.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
  assert.equal(b.policies[0].userLabels.managed_by, OWNER);
  assert.doesNotMatch(JSON.stringify(b.metrics.map(metric => ({ filter: metric.filter, labels: metric.labelExtractors }))), /cloud_tasks_queue|queue_id|uid|endpoint|p256dh/);
  assert.deepEqual(buildWebPushMonitoring(project, channel), b);
});
test('preview is credential-free and CI runs the bundle tests', () => {
  const run = spawnSync(process.execPath, ['tools/web-push-monitoring/cli.mjs', `--project=${project}`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).project, project);
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /run: npm run test:web-push-monitoring/);
});
test('refuses unrelated projects and unverified channels before any write', async () => {
  assert.throws(() => buildWebPushMonitoring(project, 'projects/another-project/notificationChannels/123'));
  const calls = [];
  await assert.rejects(applyWebPushMonitoring(buildWebPushMonitoring(project, channel), async (method, url) => {
    calls.push([method, url]); return { type: 'email', enabled: true, verificationStatus: 'UNVERIFIED' };
  }));
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'GET');
});

test('history monitoring isolates its function and fixed outcomes with idle-safe native crash coverage', () => {
  const b = buildWebPushMonitoring(project, channel);
  assert.match(b.metrics[1].filter, /service_name="sendhistoryimportnotification"/);
  assert.match(b.metrics[1].filter, /\[HistoryImportPush\]/);
  assert.deepEqual(b.metrics[1].metricDescriptor.labels.map(x => x.key), ['outcome']);
  assert.match(b.metrics[1].filter, /"cancelled" OR "limited"/);
  assert.equal(b.policies[1].userLabels.policy_id, 'history-sender');
  assert.deepEqual(b.policies[1].notificationChannels, [channel]);
  for (const c of b.policies[1].conditions) {
    assert.match(c.conditionThreshold.filter, /sendhistoryimportnotification/);
    assert.equal(c.conditionThreshold.thresholdValue, 2);
    assert.equal(c.conditionThreshold.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
    assert.doesNotMatch(c.conditionThreshold.filter, /cancelled|limited|expired|accepted/);
  }
  assert.match(b.policies[1].conditions[1].conditionThreshold.filter, /response_code_class="5xx"/);
  assert.equal(b.dashboard.mosaicLayout.tiles.length, 4);
});
test('upgrades the existing owned dashboard and reapplication preserves unrelated resources without duplicates', async () => {
  const bundle = buildWebPushMonitoring(project, channel);
  const original = { ...bundle.dashboard, displayName: 'QS Web Push self-tests', name: `projects/${project}/dashboards/existing`, etag: 'one' };
  const dashboards = [original, { name: `projects/${project}/dashboards/other`, displayName: 'Unrelated', etag: 'other' }];
  const policies = [{ ...bundle.policies[0], name: `projects/${project}/alertPolicies/existing` }, { name: `projects/${project}/alertPolicies/other`, displayName: 'Unrelated' }];
  const metrics = [bundle.metrics[0], { name: 'unrelated', description: 'Unrelated' }];
  const writes = [];
  const request = async (method, url, body) => {
    if (method === 'GET') {
      if (url.endsWith(channel)) return { type: 'email', enabled: true, verificationStatus: 'VERIFIED' };
      if (url.endsWith('/dashboards')) return { dashboards };
      if (url.endsWith('/alertPolicies')) return { alertPolicies: policies };
      if (url.endsWith('/metrics')) return { metrics };
      throw new Error('Unexpected read');
    }
    writes.push({ method, url });
    if (method === 'PUT') { const index = metrics.findIndex(x => x.name === body.name); if (index < 0) metrics.push(body); else metrics[index] = body; return body; }
    const collection = url.includes('/dashboards') ? dashboards : policies;
    const saved = { ...body, name: body.name || `projects/${project}/alertPolicies/history` };
    const index = collection.findIndex(x => x.name === saved.name);
    if (index < 0) collection.push(saved); else collection[index] = saved;
    return saved;
  };
  await applyWebPushMonitoring(bundle, request); await applyWebPushMonitoring(bundle, request);
  assert.equal(dashboards.length, 2); assert.equal(policies.length, 3); assert.equal(metrics.length, 3);
  assert.equal(writes.filter(x => x.method === 'POST').length, 1);
  assert.ok(writes.every(x => !/other|unrelated/.test(x.url)));
  assert.equal(dashboards[1].displayName, 'Unrelated'); assert.equal(policies[1].displayName, 'Unrelated');
});
