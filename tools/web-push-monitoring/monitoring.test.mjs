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
  assert.equal(b.metrics.length, 1); assert.equal(b.policies.length, 1);
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
