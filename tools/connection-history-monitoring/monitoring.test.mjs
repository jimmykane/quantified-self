import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildConnectionHistoryMonitoring, OWNER, SERVICES, metricType } from './definitions.mjs';
import { applyConnectionHistoryMonitoring } from './cli.mjs';
import { buildRouteMonitoring } from '../route-monitoring/definitions.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildHealthSleepMonitoring } from '../health-sleep-monitoring/definitions.mjs';
import { buildActivityDeliveryMonitoring } from '../activity-delivery-monitoring/definitions.mjs';

const project = 'demo-history-monitor';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildConnectionHistoryMonitoring(project, channel);
const metric = key => bundle().metrics.find(m => `logging.googleapis.com/user/${m.name}` === metricType(key));
// Strict synthetic evaluator for the Logging subset, including absence and comparisons.
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
const entry = (event, fields = {}, service = SERVICES[0]) => ({
  resource: { type: 'cloud_run_revision', labels: { project_id: project, location: 'europe-west2', service_name: service } },
  jsonPayload: { message: '[ConnectionHistory]', telemetryVersion: 1, provider: 'wahoo', event, ...fields },
});
const selected = (key, log) => matches(metric(key).filter, log);

test('separate ownership, fixed labels, all four Gen 2 endpoints and native coordinator queue', () => {
  const config = bundle(); assert.equal(config.metrics.length, 14); assert.equal(config.policies.length, 6);
  for (const m of config.metrics) {
    assert.ok(m.description.startsWith(`[${OWNER}]`)); assert.match(m.filter, /telemetryVersion=1/);
    assert.match(m.filter, /resource.type="cloud_run_revision"/);
    assert.ok(m.metricDescriptor.labels.every(l => ['provider', 'outcome'].includes(l.key)));
    assert.doesNotMatch(JSON.stringify(m.labelExtractors), /uid|runId|account|token|error|name|title/i);
    if (m.valueExtractor) assert.ok(m.bucketOptions.explicitBuckets.bounds.every((n, i, a) => i === 0 || n > a[i - 1]));
  }
  const tiles = config.dashboard.mosaicLayout.tiles;
  assert.equal(tiles.length, 19);
  const native = tiles.slice(1, 6).map(t => t.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter.filter);
  for (const query of native.slice(0, 3)) { assert.match(query, /queue_id="processConnectionHistoryTask"/); assert.match(query, /resource.type="cloud_tasks_queue"/); }
  for (const query of native.slice(3)) for (const service of SERVICES) assert.ok(query.includes(`"${service}"`));
  for (const tile of tiles.slice(6)) {
    const query = tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
    const m = config.metrics.find(m => query.filter.includes(`"logging.googleapis.com/user/${m.name}"`)); assert.ok(m);
    assert.ok(query.aggregation.groupByFields.every(field => m.metricDescriptor.labels.some(label => field === `metric.label.${label.key}`)));
    if (m.name.includes('sampled_')) { assert.equal(query.aggregation.perSeriesAligner, 'ALIGN_SUM'); assert.equal(query.aggregation.crossSeriesReducer, 'REDUCE_MEAN'); }
  }
});
test('ACK, requests, committed processing, failures, capacity and lifecycle exclusions differ', () => {
  for (const outcome of ['active', 'requested', 'processed', 'skipped', 'failed']) {
    const log = entry('checkpoint', { outcome }); assert.equal(selected('checkpoints', log), true);
    assert.equal(selected('failed_runs', log), outcome === 'failed'); assert.equal(selected('processing_failures', log), false);
  }
  assert.equal(selected('worker_attempts', entry('worker_attempt', { outcome: 'acknowledged' })), true);
  assert.equal(selected('processing_failures', entry('worker_attempt', { outcome: 'acknowledged' })), false);
  assert.equal(selected('processing_failures', entry('worker_attempt', { outcome: 'failed', provider: 'unknown' })), true);
  assert.equal(selected('processing_failures', entry('operation_retry')), true);
  assert.equal(selected('processing_failures', entry('worker_attempt', { outcome: 'expected_contention' })), false);
  assert.equal(selected('failed_runs', entry('checkpoint', { outcome: 'expected_contention' })), false);
  for (const event of ['capacity_wait', 'lease_contention', 'stale_revision', 'permission_skip', 'cooldown_skip']) {
    assert.equal(selected('processing_failures', entry(event)), false); assert.equal(selected('failed_runs', entry(event)), false);
  }
  for (const service of SERVICES.slice(1, 3)) {
    assert.equal(selected('dispatch_failures', entry('dispatch_attempt', { outcome: 'accepted' }, service)), false);
    assert.equal(selected('dispatch_failures', entry('dispatch_attempt', { outcome: 'failed' }, service)), true);
  }
  for (const change of ['project_id', 'location', 'service_name']) {
    const log = entry('operation_retry'); log.resource.labels[change] = 'other'; assert.equal(selected('processing_failures', log), false);
  }
  assert.equal(selected('processing_failures', entry('operation_retry', { telemetryVersion: 2 })), false);
  assert.equal(selected('processing_failures', entry('operation_retry', { provider: 'private' })), false);
});
test('idle, old, incomplete and saturated sample filters retain unknown semantics', () => {
  const sample = fields => entry('queue_sample', { unknownSample: 0, truncated: false, ...fields }, SERVICES[2]);
  for (const provider of ['garmin', 'suunto', 'coros', 'wahoo']) assert.equal(selected('queue_samples', sample({ provider, dueSample: 0, ageLowerBoundMs: 0 })), true);
  assert.equal(selected('overdue_samples', sample({ dueSample: 0, ageLowerBoundMs: 900000 })), false);
  for (const age of [899999, 900000]) assert.equal(selected('overdue_samples', sample({ dueSample: 1, ageLowerBoundMs: age })), age >= 900000);
  for (const fields of [{ unknownSample: 1 }, { truncated: true }]) {
    assert.equal(selected('probe_failures', sample(fields)), true);
    assert.equal(selected('sampled_due', sample(fields)), false); assert.equal(selected('sampled_age', sample(fields)), false);
  }
  assert.equal(selected('probe_failures', sample({ truncated: true, dueSample: 1, ageLowerBoundMs: 900000 })), false);
  const unavailable = entry('queue_sample_unavailable', {}, SERVICES[2]);
  assert.equal(selected('queue_samples', unavailable), true); assert.equal(selected('probe_failures', unavailable), true);
  assert.equal(selected('sampled_due', unavailable), false);
});
test('six sustained policies and four initialized idle heartbeat series, no no-imports alert', () => {
  for (const policy of bundle().policies) {
    assert.equal(policy.userLabels.managed_by, OWNER); assert.deepEqual(policy.notificationChannels, [channel]);
    assert.equal(policy.enabled, true); assert.equal(policy.combiner, 'OR');
    assert.match(policy.documentation.content, /Never blindly replay/);
    for (const condition of policy.conditions) {
      const body = condition.conditionThreshold || condition.conditionAbsent;
      assert.deepEqual(body.aggregations[0].groupByFields, ['metric.label.provider']);
      if (condition.conditionThreshold) assert.equal(body.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
      else { assert.equal(body.duration, '3600s'); assert.ok(body.filter.includes(metricType('queue_samples'))); }
    }
  }
  assert.equal(bundle().policies.at(-1).conditions.length, 4);
});
test('offline preview / unconfirmed apply need no credentials or network; CI includes this suite', () => {
  for (const args of [[`--project=${project}`], [`--project=${project}`, '--apply'], [`--project=${project}`, '--delete']]) {
    const result = spawnSync(process.execPath, ['tools/connection-history-monitoring/cli.mjs', ...args], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
    assert.equal(result.status, args.length === 1 ? 0 : 1); if (result.status === 0) assert.equal(JSON.parse(result.stdout).policies.length, 6);
  }
  assert.throws(() => buildConnectionHistoryMonitoring(project, 'projects/other/notificationChannels/123'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['test:connection-history-monitoring'], 'node --test tools/connection-history-monitoring/monitoring.test.mjs');
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /run: npm run test:connection-history-monitoring/);
});

function transport() {
  const others = [buildRouteMonitoring, buildTrainingMonitoring, buildImportMonitoring, buildHealthSleepMonitoring, buildActivityDeliveryMonitoring].map(build => build(project, channel));
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
      const index = state.metrics.findIndex(m => m.name === body.name); if (index < 0) state.metrics.push(structuredClone(body)); else state.metrics[index] = structuredClone(body); return body;
    } else {
      const key = endpoint.pathname.includes('/dashboards') ? 'dashboards' : 'alertPolicies';
      const name = method === 'POST' ? `projects/${project}/${key}/history-${state[key].length}` : body.name;
      const saved = { ...structuredClone(body), name, ...(key === 'dashboards' ? { etag: 'next' } : { conditions: body.conditions.map((c, i) => ({ ...c, name: c.name || `${name}/conditions/${i}` })) }) };
      const index = state[key].findIndex(item => item.name === name); if (index < 0) state[key].push(saved); else state[key][index] = saved; return saved;
    }
    throw new Error('Unexpected request');
  };
  return { state, calls, request };
}
test('serial create/reapply preserves every other bundle, condition IDs and etag, without deletes/duplicates', async () => {
  const source = transport(); const original = structuredClone(source.state);
  const first = await applyConnectionHistoryMonitoring(bundle(), source.request); assert.equal(first.metrics, 14); assert.equal(first.policies, 6);
  assert.equal(source.calls.filter(call => call.method === 'POST').length, 7); source.calls.length = 0;
  const second = await applyConnectionHistoryMonitoring(bundle(), source.request); assert.equal(first.dashboard, second.dashboard);
  assert.equal(source.calls.filter(call => call.method === 'POST').length, 0); assert.equal(source.calls.filter(call => call.method === 'PATCH').length, 7);
  assert.equal(source.calls.find(call => call.method === 'PATCH').body.etag, 'next');
  for (const key of Object.keys(original)) assert.deepEqual(source.state[key].slice(0, original[key].length), original[key]);
  assert.ok(source.calls.every(call => call.method !== 'DELETE' && !call.url.includes('other-')));
  for (const call of source.calls.filter(call => call.method === 'PATCH' && call.url.includes('alertPolicies'))) assert.ok(call.body.conditions.every(condition => condition.name));
});
test('ownership, immutable schema, disabled channels and malformed inventories fail before writes', async () => {
  for (const bad of ['dashboard', 'policy', 'metric', 'schema', 'inventory', 'channel']) {
    const source = transport(); await applyConnectionHistoryMonitoring(bundle(), source.request); source.calls.length = 0;
    if (bad === 'dashboard') delete source.state.dashboards.at(-1).labels[OWNER];
    if (bad === 'policy') source.state.alertPolicies.at(-1).userLabels.policy_id = 'other';
    if (bad === 'metric') source.state.metrics.at(-1).description = 'unowned';
    if (bad === 'schema') source.state.metrics.at(-1).metricDescriptor.unit = 'ms';
    await assert.rejects(applyConnectionHistoryMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body);
      if (bad === 'inventory' && url.endsWith('/metrics')) return { metrics: [{}] };
      if (bad === 'channel' && url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: false };
      return result;
    }));
    assert.ok(source.calls.every(call => call.method === 'GET'));
  }
});
test('paginated owned inventory reuses resources; repeated cursors cannot proceed to writes', async () => {
  const source = transport(); await applyConnectionHistoryMonitoring(bundle(), source.request); source.calls.length = 0;
  await applyConnectionHistoryMonitoring(bundle(), async (method, url, body) => {
    const result = await source.request(method, url.split('?')[0], body);
    if (method === 'GET' && url.includes('/dashboards')) return !url.includes('?')
      ? { dashboards: result.dashboards.slice(0, -1), nextPageToken: 'page / two' }
      : { dashboards: [result.dashboards.at(-1)] };
    return result;
  });
  assert.equal(source.calls.filter(call => call.method === 'POST').length, 0); source.calls.length = 0;
  await assert.rejects(applyConnectionHistoryMonitoring(bundle(), async (method, url, body) => {
    const result = await source.request(method, url.split('?')[0], body);
    return method === 'GET' && url.includes('/metrics') ? { ...result, nextPageToken: 'repeated' } : result;
  }), /Repeated inventory page token/);
  assert.ok(source.calls.every(call => call.method === 'GET'));
});
