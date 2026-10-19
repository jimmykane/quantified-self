import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildReparseMonitoring, OWNER, TIERS, SERVICES, metricType } from './definitions.mjs';
import { applyReparseMonitoring } from './cli.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildHealthSleepMonitoring } from '../health-sleep-monitoring/definitions.mjs';
import { buildActivityDeliveryMonitoring } from '../activity-delivery-monitoring/definitions.mjs';
import { buildRouteMonitoring } from '../route-monitoring/definitions.mjs';
import { buildConnectionHistoryMonitoring } from '../connection-history-monitoring/definitions.mjs';
import { buildEmailMonitoring } from '../email-monitoring/definitions.mjs';
import { buildDerivedMetricsMonitoring } from '../derived-metrics-monitoring/definitions.mjs';

const project = 'demo-reparse-monitor';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildReparseMonitoring(project, channel);
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
const entry = (event, fields = {}, service = SERVICES[0]) => ({
  resource: { type: 'cloud_run_revision', labels: { project_id: project, location: 'europe-west2', service_name: service } },
  jsonPayload: { message: '[Reparse]', telemetryVersion: 1, tier: 'normal', event, ...fields },
});
const selected = (key, log) => matches(metric(key).filter, log);
const type = filter => /metric\.type="([^"]+)"/.exec(filter)?.[1];

test('exact ownership, ten metrics, seven policies, three fixed tiers and three scoped native queues', () => {
  const config = bundle(); assert.equal(config.metrics.length, 10); assert.equal(config.policies.length, 7);
  assert.deepEqual(TIERS, ['normal', 'heavy', 'route']);
  for (const m of config.metrics) {
    assert.ok(m.description.startsWith(`[${OWNER}]`)); assert.match(m.filter, /telemetryVersion=1/);
    assert.ok(m.metricDescriptor.labels.every(label => ['tier', 'outcome'].includes(label.key)));
    assert.ok(Object.values(m.labelExtractors).every(value => /^EXTRACT\(jsonPayload\.(tier|outcome)\)$/.test(value)));
  }
  const native = [];
  for (const tile of config.dashboard.mosaicLayout.tiles.slice(1)) {
    const q = tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter.filter;
    if (q.includes('cloudtasks.googleapis.com')) {
      native.push(q); assert.match(q, /resource\.labels\.location="europe-west2"/);
      assert.match(q, /resource\.labels\.queue_id="processSportsLib(?:Reparse(?:Heavy)?|RouteReparse)Task"/);
    } else assert.ok(config.metrics.some(m => type(q) === `logging.googleapis.com/user/${m.name}`));
  }
  assert.equal(native.length, 9);
});
test('ACK, successful commit, skips, rollout waits, deduplication and failures are distinct', () => {
  assert.equal(selected('job_commits', entry('worker_attempt', { outcome: 'acknowledged' })), false);
  for (const outcome of ['completed', 'skipped', 'superseded']) assert.equal(selected('job_commits', entry('job_commit', { outcome })), true);
  for (const tier of TIERS) assert.equal(selected('worker_attempts', entry('worker_attempt', { tier, outcome: 'rollout_wait' })), true);
  assert.equal(selected('enqueue_attempts', entry('enqueue_attempt', { outcome: 'deduplicated' })), true);
  for (const bad of [{ tier: 'PRIVATE_UID' }, { telemetryVersion: 2 }]) assert.equal(selected('worker_attempts', entry('worker_attempt', { outcome: 'failed', ...bad })), false);
  const wrong = entry('worker_attempt', { outcome: 'failed' }); wrong.resource.labels.service_name = 'unrelated';
  assert.equal(selected('worker_attempts', wrong), false);
});
test('only positive proven stalls page; unknown and capped prefixes cannot masquerade as healthy idle', () => {
  const sample = fields => entry('queue_sample', { truncated: false, unknownSample: 0, ...fields }, SERVICES[3]);
  for (const patch of [{ pendingSample: 0, stalled: true }, { pendingSample: 1, stalled: false }, { stalled: true }]) {
    assert.equal(selected('stalled_samples', sample(patch)), false);
  }
  assert.equal(selected('stalled_samples', sample({ pendingSample: 1, stalled: true, truncated: true })), true);
  for (const patch of [{ unknownSample: 1 }, { truncated: true }]) assert.equal(selected('probe_failures', sample(patch)), true);
  assert.equal(selected('probe_failures', sample({ truncated: true, pendingSample: 1 })), false);
  assert.equal(selected('probe_failures', entry('queue_sample_unavailable', {}, SERVICES[3])), true);
  assert.equal(selected('sampled_pending', sample({ truncated: true })), false);
});
test('heavy thresholds are longer; no absence or depth policies can page an intentionally inactive batch', () => {
  for (const p of bundle().policies) {
    assert.equal(p.enabled, true); assert.deepEqual(p.notificationChannels, [channel]);
    assert.equal(p.userLabels.managed_by, OWNER); assert.deepEqual(p.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    assert.match(p.documentation.content, /Never replay/);
    for (const c of p.conditions) {
      assert.equal(c.conditionAbsent, undefined); assert.ok(c.conditionThreshold);
      assert.equal(c.conditionThreshold.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
      assert.doesNotMatch(c.conditionThreshold.filter, /\bOR\b/);
      assert.ok(bundle().metrics.some(m => type(c.conditionThreshold.filter) === `logging.googleapis.com/user/${m.name}`));
      assert.deepEqual(c.conditionThreshold.aggregations[0].groupByFields, ['metric.label.tier']);
    }
  }
  assert.equal(bundle().policies.find(p => p.userLabels.policy_id === 'heavy_worker').conditions[0].conditionThreshold.aggregations[0].alignmentPeriod, '21600s');
  for (const id of ['stall', 'heavy_stall', 'telemetry']) {
    const condition = bundle().policies.find(p => p.userLabels.policy_id === id).conditions[0].conditionThreshold;
    assert.equal(condition.aggregations[0].alignmentPeriod, '10800s');
    assert.equal(condition.thresholdValue, 1); // Two hourly samples, not an unreachable three-in-one-hour threshold.
  }
});
test('hourly probe policies tolerate boundary/ingestion drift while event-driven failure thresholds stay unchanged', () => {
  const eventPolicies = { worker: [4, '1800s'], heavy_worker: [2, '21600s'], enqueue: [2, '3600s'], scanner: [2, '3600s'] };
  for (const [id, [threshold, period]] of Object.entries(eventPolicies)) {
    const condition = bundle().policies.find(p => p.userLabels.policy_id === id).conditions[0].conditionThreshold;
    assert.equal(condition.thresholdValue, threshold); assert.equal(condition.aggregations[0].alignmentPeriod, period);
  }
  for (const id of ['stall', 'heavy_stall', 'telemetry']) {
    const condition = bundle().policies.find(p => p.userLabels.policy_id === id).conditions[0].conditionThreshold;
    const seconds = Number.parseInt(condition.aggregations[0].alignmentPeriod, 10);
    const samples = [0, 3_600]; const evaluationTime = 7_260;
    const recent = samples.filter(time => time > evaluationTime - seconds && time <= evaluationTime);
    assert.equal(recent.length, 2);
    assert.ok(recent.length > condition.thresholdValue);
    assert.equal(1 > condition.thresholdValue, false); // One isolated bad observation cannot open an incident.
  }
  assert.match(bundle().dashboard.mosaicLayout.tiles[0].widget.text.content, /top-of-hour scheduled tick/);
  assert.match(metric('queue_samples').description, /hourly/);
});
test('preview is offline, unconfirmed apply is rejected, CI and narrowly scoped progress indexes are registered', () => {
  for (const args of [[`--project=${project}`], [`--project=${project}`, '--apply'], [`--project=${project}`, '--delete']]) {
    const result = spawnSync(process.execPath, ['tools/reparse-monitoring/cli.mjs', ...args], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
    assert.equal(result.status, args.length === 1 ? 0 : 1);
    if (result.status === 0) assert.equal(JSON.parse(result.stdout).policies.length, 7);
  }
  assert.throws(() => buildReparseMonitoring(project, 'projects/other/notificationChannels/123'));
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:reparse-monitoring'], 'node --test tools/reparse-monitoring/monitoring.test.mjs');
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /run: npm run test:reparse-monitoring/);
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
  for (const collection of ['sportsLibReparseJobs', 'sportsLibRouteReparseJobs']) {
    const progress = indexes.find(i => i.collectionGroup === collection && i.fields[0].fieldPath === 'targetSportsLibVersion');
    assert.equal(progress.queryScope, 'COLLECTION');
    assert.deepEqual(progress.fields.map(f => f.fieldPath), ['targetSportsLibVersion', ...(collection === 'sportsLibReparseJobs' ? ['processingTier'] : []), 'status', 'updatedAt']);
    // limitToLast reverses the wire ordering: the existing DESC history index
    // cannot satisfy the oldest-first ASC sample (confirmed with plan-only API reads).
    const oldest = indexes.find(i => i.collectionGroup === collection && i.fields.length === 2
      && i.fields[0].fieldPath === 'status' && i.fields[1].order === 'ASCENDING');
    assert.equal(oldest.queryScope, 'COLLECTION');
    assert.deepEqual(oldest.fields, ['status', 'updatedAt'].map(fieldPath => ({ fieldPath, order: 'ASCENDING' })));
  }
});

function transport() {
  const others = [buildTrainingMonitoring, buildImportMonitoring, buildHealthSleepMonitoring, buildActivityDeliveryMonitoring,
    buildRouteMonitoring, buildConnectionHistoryMonitoring, buildEmailMonitoring, buildDerivedMetricsMonitoring].map(build => build(project, channel));
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
      const name = method === 'POST' ? `projects/${project}/${key}/reparse-${state[key].length}` : body.name;
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
test('serial reapply preserves all eight existing bundles, every condition ID, etags and email channels', async () => {
  const source = transport(); const before = structuredClone(source.state);
  const first = await applyReparseMonitoring(bundle(), source.request);
  assert.equal(first.metrics, 10); assert.equal(first.policies, 7); assert.equal(source.calls.filter(c => c.method === 'POST').length, 8);
  const policies = structuredClone(source.state.alertPolicies.slice(before.alertPolicies.length)); source.calls.length = 0;
  const second = await applyReparseMonitoring(bundle(), source.request);
  assert.equal(second.dashboard, first.dashboard); assert.equal(source.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(source.calls.filter(c => c.method === 'PATCH').length, 8);
  assert.equal(source.calls.find(c => c.method === 'PATCH').body.etag, 'next');
  assert.deepEqual(source.state.alertPolicies.slice(before.alertPolicies.length), policies);
  for (const key of Object.keys(before)) assert.deepEqual(source.state[key].slice(0, before[key].length), before[key]);
  assert.ok(source.calls.every(c => c.method !== 'DELETE' && !c.url.includes('other-') && (c.method === 'GET' || !c.url.includes('/notificationChannels'))));
});
test('ownership collisions, incompatible schemas, malformed inventories and disabled channels fail before any write', async () => {
  for (const bad of ['dashboard', 'policy', 'metric', 'schema', 'inventory', 'channel']) {
    const source = transport(); await applyReparseMonitoring(bundle(), source.request); source.calls.length = 0;
    if (bad === 'dashboard') delete source.state.dashboards.at(-1).labels[OWNER];
    if (bad === 'policy') source.state.alertPolicies.at(-1).userLabels.policy_id = 'other';
    if (bad === 'metric') source.state.metrics.at(-1).description = 'unowned';
    if (bad === 'schema') source.state.metrics.at(-1).metricDescriptor.unit = 'ms';
    await assert.rejects(applyReparseMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body);
      if (bad === 'inventory' && url.endsWith('/metrics')) return { metrics: [{}] };
      if (bad === 'channel' && url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: false };
      return result;
    }));
    assert.ok(source.calls.every(c => c.method === 'GET'));
  }
});
