import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildStripeBillingMonitoring, EVENTS, OWNER, SERVICES } from './definitions.mjs';
import { applyStripeBillingMonitoring } from './cli.mjs';
const project = 'demo-billing-monitoring';
const bundle = () => buildStripeBillingMonitoring(project, `projects/${project}/notificationChannels/123`);
test('fixed private-data-free metrics separate accepted and committed outcomes and cover missing telemetry', () => {
  const b = bundle(); assert.equal(b.metrics.length, EVENTS.length); assert.equal(b.policies.length, 9);
  for (const metric of b.metrics) {
    assert.deepEqual(metric.metricDescriptor.labels, []); assert.deepEqual(metric.labelExtractors, {});
    assert.match(metric.filter, /europe-west3/); assert.ok(metric.description.startsWith(`[${OWNER}]`));
    for (const service of SERVICES) assert.ok(metric.filter.includes(`"${service}"`));
  }
  assert.ok(b.metrics.some(m => m.filter.includes('jsonPayload.event="processed"')));
  assert.ok(b.metrics.some(m => m.filter.includes('jsonPayload.event="accepted"')));
  assert.equal(b.policies.find(p => p.userLabels.policy_id === 'heartbeat').conditions[0].conditionAbsent.duration, '7200s');
  assert.ok(b.policies.every(p => !JSON.stringify(p.conditions).includes('skipped')));
});
test('preview uses no cloud credentials and invalid targets fail closed', () => {
  const result = spawnSync(process.execPath, ['tools/stripe-billing-monitoring/cli.mjs', `--project=${project}`], { encoding: 'utf8', env: { PATH: '/nonexistent' } });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).metrics.length, EVENTS.length);
  assert.throws(() => buildStripeBillingMonitoring('bad"project', undefined));
});
test('shared apply preserves unrelated resources and reapplies without duplicates', async () => {
  const db = { metrics: [], dashboards: [{ name: `projects/${project}/dashboards/unrelated`, displayName: 'Other', labels: {}, etag: 'etag' }], alertPolicies: [] };
  const writes = [];
  const request = async (method, url, body) => {
    if (url.includes('/notificationChannels/')) return { type: 'email', enabled: true, verificationStatus: 'VERIFIED' };
    const kind = url.includes('/metrics') ? 'metrics' : url.includes('/dashboards') ? 'dashboards' : 'alertPolicies';
    if (method === 'GET') return { [kind]: db[kind] };
    writes.push({ method, url, body }); assert.notEqual(method, 'DELETE');
    if (method === 'POST') {
      const name = kind === 'metrics' ? body.name : `projects/${project}/${kind}/${db[kind].length + 1}`;
      const value = { ...body, name, ...(kind === 'dashboards' ? { etag: 'etag' } : {}) }; db[kind].push(value); return value;
    }
    return body;
  };
  await applyStripeBillingMonitoring(bundle(), request);
  const counts = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length]));
  await applyStripeBillingMonitoring(bundle(), request);
  assert.deepEqual(Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.length])), counts);
  assert.ok(writes.every(w => !w.url.endsWith('/unrelated')));
});
