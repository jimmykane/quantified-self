import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDerivedMetricsMonitoring, METRIC_KINDS, OWNER, SERVICES, metricType } from './definitions.mjs';
import { applyDerivedMetricsMonitoring } from './cli.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildHealthSleepMonitoring } from '../health-sleep-monitoring/definitions.mjs';
import { buildActivityDeliveryMonitoring } from '../activity-delivery-monitoring/definitions.mjs';
import { buildRouteMonitoring } from '../route-monitoring/definitions.mjs';
import { buildConnectionHistoryMonitoring } from '../connection-history-monitoring/definitions.mjs';
import { buildEmailMonitoring } from '../email-monitoring/definitions.mjs';

const project = 'demo-derived-monitor';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildDerivedMetricsMonitoring(project, channel);
const metric = key => bundle().metrics.find(m => `logging.googleapis.com/user/${m.name}` === metricType(key));
function matches(filter, entry) {
  const tokens = filter.match(/"(?:[^"\\]|\\.)*"|>=|[=():>*]|[\w.]+/g); let at = 0;
  const take = expected => assert.equal(tokens[at++], expected);
  const value = token => token.startsWith('"') ? JSON.parse(token) : token === 'true' ? true : Number(token);
  function primary() {
    if (tokens[at] === 'NOT') { at++; return !primary(); }
    if (tokens[at] === '(') { at++; const result = expression(); take(')'); return result; }
    const path = tokens[at++]; const op = tokens[at++]; assert.ok(['=', '>=', '>', ':'].includes(op));
    const actual = path.split('.').reduce((object, key) => object?.[key], entry); const values = [];
    if (tokens[at] === '(') {
      at++; values.push(value(tokens[at++]));
      while (tokens[at] === 'OR') { at++; values.push(value(tokens[at++])); } take(')');
    } else values.push(tokens[at] === '*' ? tokens[at++] : value(tokens[at++]));
    if (op === ':') { assert.deepEqual(values, ['*']); return actual !== undefined; }
    return actual !== undefined && values.some(expected => op === '=' ? actual === expected : typeof actual === 'number' && (op === '>' ? actual > expected : actual >= expected));
  }
  function conjunction() {
    let result = primary();
    while (at < tokens.length && !['OR', ')'].includes(tokens[at])) { const right = primary(); result = result && right; } return result;
  }
  function expression() { let result = conjunction(); while (tokens[at] === 'OR') { at++; const right = conjunction(); result = result || right; } return result; }
  const result = expression(); assert.equal(at, tokens.length); return result;
}
const entry = (event, fields = {}, service = SERVICES[1]) => ({
  resource: { type: 'cloud_run_revision', labels: { project_id: project, location: 'europe-west2', service_name: service } },
  jsonPayload: { message: '[DerivedMetrics]', telemetryVersion: 1, metricKind: 'form', event, ...fields },
});
const selected = (key, log) => matches(metric(key).filter, log);
const filterType = filter => /metric\.type="([^"]+)"/.exec(filter)?.[1];

test('bounded canonical dimensions, exact native queue scopes and independent ownership', () => {
  const config = bundle(); assert.equal(config.metrics.length, 14); assert.equal(config.policies.length, 6);
  const kinds = [...readFileSync('shared/derived-metric-kinds.ts', 'utf8').split('} as const;')[0].matchAll(/:\s*'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(METRIC_KINDS, kinds);
  for (const metric of config.metrics) {
    assert.ok(metric.description.startsWith(`[${OWNER}]`)); assert.match(metric.filter, /telemetryVersion=1/);
    assert.equal(metric.metricDescriptor.metricKind, 'DELTA');
    assert.ok(metric.metricDescriptor.labels.every(label => ['metricKind', 'outcome', 'stage', 'state'].includes(label.key)));
  }
  const types = config.metrics.map(m => `logging.googleapis.com/user/${m.name}`);
  const native = new Set(['depth', 'task_attempt_count', 'task_attempt_delays'].map(key => `cloudtasks.googleapis.com/queue/${key}`));
  let nativeCount = 0;
  for (const tile of config.dashboard.mosaicLayout.tiles.slice(1)) {
    const filter = tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
    assert.ok(types.includes(filterType(filter.filter)) || native.has(filterType(filter.filter)));
    if (native.has(filterType(filter.filter))) {
      nativeCount++;
      assert.match(filter.filter, /resource\.labels\.location="europe-west2"/);
      assert.match(filter.filter, /resource\.labels\.queue_id="processDerivedMetrics(?:Ingress)?Task"/);
    }
  }
  assert.equal(nativeCount, 6);
  const extractors = config.metrics.flatMap(m => Object.values(m.labelExtractors));
  assert.ok(extractors.every(value => /^EXTRACT\(jsonPayload\.(metricKind|outcome|stage|state)\)$/.test(value)));
});
test('admission and ACKs never imply ready publication; intentional lifecycle transitions are not failure pages', () => {
  assert.equal(selected('ingress', entry('ingress', { outcome: 'coalesced' }, SERVICES[0])), true);
  assert.equal(selected('snapshot_commits', entry('worker_attempt', { stage: 'calculation', outcome: 'acknowledged' })), false);
  assert.equal(selected('snapshot_commits', entry('snapshot_commit', { outcome: 'ready' })), true);
  assert.equal(selected('calculation_failures', entry('snapshot_commit', { outcome: 'failed' })), false);
  assert.equal(selected('calculation_failures', entry('coordinator_commit', { outcome: 'failed' })), true);
  assert.equal(selected('enqueue_failures', entry('coordinator_commit', { outcome: 'enqueue_failed' })), true);
  for (const outcome of ['settled', 'requeued', 'skipped', 'coalesced', 'stale', 'deletion_blocked', 'acknowledged']) {
    for (const key of ['calculation_failures', 'enqueue_failures']) assert.equal(selected(key, entry('coordinator_commit', { outcome })), false);
  }
  // One attempt may publish ready before a following dirty generation; settlement remains separate.
  assert.equal(selected('coordinator_commits', entry('coordinator_commit', { outcome: 'requeued' })), true);
  for (const field of ['project_id', 'location', 'service_name']) {
    const bad = entry('coordinator_commit', { outcome: 'failed' }); bad.resource.labels[field] = 'private-canary';
    assert.equal(selected('calculation_failures', bad), false);
  }
  assert.equal(selected('calculation_failures', entry('coordinator_commit', { outcome: 'failed', metricKind: 'private-canary' })), false);
  assert.equal(selected('calculation_failures', entry('coordinator_commit', { outcome: 'failed', telemetryVersion: 2 })), false);
});
test('real idle, partial, malformed and capped observations do not fabricate healthy zeroes', () => {
  const sample = fields => entry('queue_sample', { state: 'queued', unknownSample: 0, truncated: false, ...fields }, SERVICES[2]);
  for (const state of ['queued', 'processing', 'failed']) assert.equal(selected('queue_samples', sample({ state })), true);
  assert.equal(selected('overdue_samples', sample({ pendingSample: 0, ageLowerBoundMs: 1_800_000 })), false);
  for (const age of [1_799_999, 1_800_000]) assert.equal(selected('overdue_samples', sample({ pendingSample: 1, ageLowerBoundMs: age })), age >= 1_800_000);
  for (const patch of [{ unknownSample: 1 }, { truncated: true }]) {
    assert.equal(selected('probe_failures', sample(patch)), true);
    assert.equal(selected('sampled_pending', sample(patch)), false);
    assert.equal(selected('sampled_age', sample(patch)), false);
  }
  assert.equal(selected('probe_failures', sample({ truncated: true, pendingSample: 1, ageLowerBoundMs: 1_800_000 })), false);
  assert.equal(selected('probe_failures', entry('queue_sample_unavailable', { state: 'failed' }, SERVICES[2])), true);
});
test('six sustained policies retain missing-data behavior and do not sum multi-kind failures into a global incident', () => {
  const types = bundle().metrics.map(m => `logging.googleapis.com/user/${m.name}`);
  for (const policy of bundle().policies) {
    assert.equal(policy.enabled, true); assert.equal(policy.userLabels.managed_by, OWNER);
    assert.deepEqual(policy.notificationChannels, [channel]); assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    assert.match(policy.documentation.content, /Never blindly rebuild/);
    for (const condition of policy.conditions) {
      const body = condition.conditionThreshold || condition.conditionAbsent;
      assert.ok(types.includes(filterType(body.filter)));
      if (condition.conditionThreshold) {
        assert.equal(body.duration, '60s'); assert.equal(body.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
        if (['calculation', 'enqueue'].includes(policy.userLabels.policy_id)) assert.deepEqual(body.aggregations[0].groupByFields, ['metric.label.metricKind']);
      } else { assert.equal(body.duration, '3600s'); assert.equal(filterType(body.filter), metricType('queue_samples')); }
    }
  }
  assert.equal(bundle().policies.at(-1).conditions.length, 3);
});
test('preview and unconfirmed apply are offline; required CI and the bounded probe index are registered', () => {
  for (const args of [[`--project=${project}`], [`--project=${project}`, '--apply'], [`--project=${project}`, '--delete']]) {
    const result = spawnSync(process.execPath, ['tools/derived-metrics-monitoring/cli.mjs', ...args], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
    assert.equal(result.status, args.length === 1 ? 0 : 1);
    if (result.status === 0) assert.equal(JSON.parse(result.stdout).policies.length, 6);
  }
  assert.throws(() => buildDerivedMetricsMonitoring(project, 'projects/other/notificationChannels/123'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['test:derived-metrics-monitoring'], 'node --test tools/derived-metrics-monitoring/monitoring.test.mjs');
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /run: npm run test:derived-metrics-monitoring/);
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
  assert.ok(indexes.some(index => index.collectionGroup === 'derivedMetrics' && index.queryScope === 'COLLECTION_GROUP'
    && JSON.stringify(index.fields) === JSON.stringify(['entryType', 'status', 'updatedAtMs'].map(fieldPath => ({ fieldPath, order: 'ASCENDING' })))));
});

function transport() {
  const others = [buildTrainingMonitoring, buildImportMonitoring, buildHealthSleepMonitoring, buildActivityDeliveryMonitoring,
    buildRouteMonitoring, buildConnectionHistoryMonitoring, buildEmailMonitoring].map(build => build(project, channel));
  const state = { dashboards: others.map((b, i) => ({ ...b.dashboard, name: `projects/${project}/dashboards/other-${i}`, etag: 'other' })),
    alertPolicies: others.flatMap((b, i) => b.policies.map((p, j) => ({ ...p, name: `projects/${project}/alertPolicies/other-${i}-${j}` }))), metrics: others.flatMap(b => b.metrics) };
  const calls = [];
  const request = async (method, url, body) => {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password || !['logging.googleapis.com', 'monitoring.googleapis.com'].includes(endpoint.hostname)) throw new Error('Unexpected URL');
    calls.push({ method, url, body });
    if (method === 'GET') {
      if (endpoint.pathname.endsWith('/notificationChannels/123')) return { type: 'email', enabled: true };
      for (const key of Object.keys(state)) if (endpoint.pathname.endsWith(`/${key}`)) return { [key]: structuredClone(state[key]) };
    } else if (endpoint.hostname === 'logging.googleapis.com') {
      const index = state.metrics.findIndex(m => m.name === body.name);
      if (index < 0) state.metrics.push(structuredClone(body)); else state.metrics[index] = structuredClone(body);
      return body;
    } else {
      const key = endpoint.pathname.includes('/dashboards') ? 'dashboards' : 'alertPolicies';
      const name = method === 'POST' ? `projects/${project}/${key}/derived-${state[key].length}` : body.name;
      const saved = { ...structuredClone(body), name, ...(key === 'dashboards' ? { etag: 'next' }
        : { conditions: body.conditions.map((c, i) => ({ ...c, name: c.name || `${name}/conditions/${i}` })) }) };
      const index = state[key].findIndex(item => item.name === name);
      if (index < 0) state[key].push(saved); else state[key][index] = saved;
      return saved;
    }
    throw new Error('Unexpected request');
  };
  return { state, calls, request };
}
test('create/reapply preserves all seven other bundles, condition identities, dashboard etag and channels', async () => {
  const source = transport(); const before = structuredClone(source.state);
  const first = await applyDerivedMetricsMonitoring(bundle(), source.request);
  assert.equal(first.metrics, 14); assert.equal(first.policies, 6); assert.equal(source.calls.filter(c => c.method === 'POST').length, 7);
  const createdPolicies = structuredClone(source.state.alertPolicies.slice(before.alertPolicies.length));
  source.calls.length = 0;
  const second = await applyDerivedMetricsMonitoring(bundle(), source.request);
  assert.equal(second.dashboard, first.dashboard); assert.equal(source.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(source.calls.filter(c => c.method === 'PATCH').length, 7);
  assert.equal(source.calls.find(c => c.method === 'PATCH').body.etag, 'next');
  assert.deepEqual(source.state.alertPolicies.slice(before.alertPolicies.length), createdPolicies);
  for (const key of Object.keys(before)) assert.deepEqual(source.state[key].slice(0, before[key].length), before[key]);
  assert.ok(source.calls.every(c => c.method !== 'DELETE' && !c.url.includes('other-') && (c.method === 'GET' || !c.url.includes('/notificationChannels'))));
});
test('unowned resources, incompatible schemas, disabled channels and malformed inventories fail before any write', async () => {
  for (const bad of ['dashboard', 'policy', 'metric', 'schema', 'inventory', 'channel']) {
    const source = transport(); await applyDerivedMetricsMonitoring(bundle(), source.request); source.calls.length = 0;
    if (bad === 'dashboard') delete source.state.dashboards.at(-1).labels[OWNER];
    if (bad === 'policy') source.state.alertPolicies.at(-1).userLabels.policy_id = 'other';
    if (bad === 'metric') source.state.metrics.at(-1).description = 'unowned';
    if (bad === 'schema') source.state.metrics.at(-1).metricDescriptor.unit = 'ms';
    await assert.rejects(applyDerivedMetricsMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body);
      if (bad === 'inventory' && url.endsWith('/metrics')) return { metrics: [{}] };
      if (bad === 'channel' && url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: false };
      return result;
    }));
    assert.ok(source.calls.every(c => c.method === 'GET'));
  }
});
test('paginated inventory retains existing identities and repeated page tokens cannot proceed to writes', async () => {
  const source = transport(); await applyDerivedMetricsMonitoring(bundle(), source.request); source.calls.length = 0;
  await applyDerivedMetricsMonitoring(bundle(), async (method, url, body) => {
    const result = await source.request(method, url.split('?')[0], body);
    if (method === 'GET' && url.includes('/dashboards')) return !url.includes('?')
      ? { dashboards: result.dashboards.slice(0, -1), nextPageToken: 'page / two' } : { dashboards: [result.dashboards.at(-1)] };
    return result;
  });
  assert.equal(source.calls.filter(c => c.method === 'POST').length, 0); source.calls.length = 0;
  await assert.rejects(applyDerivedMetricsMonitoring(bundle(), async (method, url, body) => {
    const result = await source.request(method, url.split('?')[0], body);
    return method === 'GET' && url.includes('/metrics') ? { ...result, nextPageToken: 'repeated' } : result;
  }), /Repeated inventory page token/);
  assert.ok(source.calls.every(c => c.method === 'GET'));
});
