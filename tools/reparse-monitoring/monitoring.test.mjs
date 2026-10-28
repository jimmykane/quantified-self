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
import { buildCleanupMonitoring } from '../cleanup-monitoring/definitions.mjs';

const project = 'demo-reparse-monitor';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildReparseMonitoring(project, channel);
const metric = key => bundle().metrics.find(m => `logging.googleapis.com/user/${m.name}` === metricType(key));
function matches(filter, entry) {
  const tokens = filter.match(/"(?:[^"\\]|\\.)*"|>=|[=(),:>*]|[\w.]+/g); let at = 0;
  const take = expected => assert.equal(tokens[at++], expected);
  const value = token => token.startsWith('"') ? JSON.parse(token) : token === 'true' ? true : token === 'false' ? false : Number(token);
  function primary() {
    if (tokens[at] === 'NOT') { at++; return !primary(); }
    if (tokens[at] === '(') { at++; const result = expression(); take(')'); return result; }
    const path = tokens[at++]; const op = tokens[at++]; assert.ok(['=', '>=', '>', ':'].includes(op));
    const actual = path.split('.').reduce((object, key) => object?.[key], entry); const values = [];
    if (tokens[at] === 'one_of') {
      at++; take('('); values.push(value(tokens[at++]));
      while (tokens[at] === ',') { at++; values.push(value(tokens[at++])); } take(')');
    } else if (tokens[at] === '(') {
      at++; values.push(value(tokens[at++]));
      while (tokens[at] === 'OR') { at++; values.push(value(tokens[at++])); } take(')');
    } else values.push(tokens[at] === '*' ? tokens[at++] : value(tokens[at++]));
    if (op === ':') { assert.deepEqual(values, ['*']); return actual !== undefined; }
    return actual !== undefined && values.some(expected => op === '=' ? actual === expected : typeof actual === 'number' && (op === '>' ? actual > expected : actual >= expected));
  }
  // Logging evaluates OR before implicit/explicit AND. The native Monitoring
  // filters tested here use only conjunctions and exact one_of membership.
  function disjunction() {
    let result = primary();
    while (tokens[at] === 'OR') { at++; const right = primary(); result = result || right; } return result;
  }
  function expression() {
    let result = disjunction();
    while (at < tokens.length && tokens[at] !== ')') {
      if (tokens[at] === 'AND') at++;
      const right = disjunction(); result = result && right;
    }
    return result;
  }
  const result = expression(); assert.equal(at, tokens.length); return result;
}
const entry = (event, fields = {}, service = SERVICES[0]) => ({
  resource: { type: 'cloud_run_revision', labels: { project_id: project, location: 'europe-west2', service_name: service } },
  jsonPayload: { message: '[Reparse]', telemetryVersion: 1, tier: 'normal', event, ...fields },
});
const selected = (key, log) => matches(metric(key).filter, log);
const type = filter => /metric\.type="([^"]+)"/.exec(filter)?.[1];
const scanners = ['schedulesportslibreparsescan', 'schedulesportslibroutereparsescan'];
const nativeResponse = (service = scanners[0], code = 504, revision = 'first') => ({
  resource: { type: 'cloud_run_revision', labels: {
    project_id: project, location: 'europe-west2', service_name: service, revision_name: revision,
  } },
  metric: { type: 'run.googleapis.com/request_count', labels: { response_code: `${code}`, response_code_class: `${Math.floor(code / 100)}xx` } },
});
const nativeMetricTypes = new Set(['depth', 'task_attempt_count', 'task_attempt_delays']
  .map(key => `cloudtasks.googleapis.com/queue/${key}`));
function assertDashboardMetric(filter, config) {
  const metricType = type(filter);
  if (metricType === 'run.googleapis.com/request_count') {
    assert.match(filter, /resource\.type="cloud_run_revision"/);
    assert.ok(filter.includes(`resource.labels.project_id="${project}"`));
    assert.match(filter, /resource\.labels\.location="europe-west2"/);
    assert.match(filter, /resource\.labels\.service_name=one_of\("schedulesportslibreparsescan","schedulesportslibroutereparsescan"\)/);
    assert.match(filter, /metric\.labels\.response_code_class="5xx"/);
    return true;
  }
  if (nativeMetricTypes.has(metricType)) {
    assert.match(filter, /resource\.labels\.location="europe-west2"/);
    assert.match(filter, /resource\.labels\.queue_id="processSportsLib(?:Reparse(?:Heavy)?|RouteReparse)Task"/);
    return true;
  }
  assert.ok(config.metrics.some(m => metricType === `logging.googleapis.com/user/${m.name}`));
  return false;
}

test('exact ownership, ten metrics, seven policies, three native queues and two native scanner runtimes', () => {
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
    if (assertDashboardMetric(q, config)) native.push(q);
  }
  assert.equal(native.length, 10);
  assert.equal(config.policies.reduce((count, policy) => count + policy.conditions.length, 0), 8);
});
test('filter fixtures retain Logging OR-before-AND precedence and explicit membership semantics', () => {
  const sample = entry('queue_sample', {}, SERVICES[3]);
  assert.equal(matches('jsonPayload.event="other" jsonPayload.tier="normal" OR jsonPayload.event="queue_sample"', sample), false);
  assert.equal(matches('(jsonPayload.event="other" jsonPayload.tier="normal") OR jsonPayload.event="queue_sample"', sample), true);
  assert.equal(matches('jsonPayload.tier=one_of("normal","route") AND jsonPayload.event="queue_sample"', sample), true);
});
test('dashboard validation rejects lookalike metric hosts and identifiers outside metric.type', () => {
  const scope = 'resource.labels.location="europe-west2" resource.labels.queue_id="processSportsLibReparseTask"';
  for (const metricType of [
    'evil.cloudtasks.googleapis.com/queue/depth',
    'cloudtasks.googleapis.com.evil.test/queue/depth',
    'cloudtasksXgoogleapisYcom/queue/depth',
    'cloudtasks.googleapis.com/queue/unknown',
    'logging.googleapis.com/user/unregistered',
    'evil.run.googleapis.com/request_count',
    'run.googleapis.com.evil.test/request_count',
    'run.googleapis.com/request_latencies',
  ]) assert.throws(() => assertDashboardMetric(`metric.type="${metricType}" ${scope}`, bundle()));
  assert.throws(() => assertDashboardMetric(`note="cloudtasks.googleapis.com/queue/depth" ${scope}`, bundle()));
  assert.throws(() => assertDashboardMetric('metric.type="cloudtasks.googleapis.com/queue/depth" resource.labels.location="us-central1" resource.labels.queue_id="processSportsLibReparseTask"', bundle()));
  assert.throws(() => assertDashboardMetric('metric.type="cloudtasks.googleapis.com/queue/depth" resource.labels.location="europe-west2" resource.labels.queue_id="unrelatedTask"', bundle()));
  const native = bundle().policies.find(p => p.userLabels.policy_id === 'scanner').conditions[1].conditionThreshold.filter;
  for (const [original, changed] of [
    ['run.googleapis.com/request_count', 'evil.run.googleapis.com/request_count'],
    ['resource.type="cloud_run_revision"', 'resource.type="global"'],
    [`project_id="${project}"`, 'project_id="foreign-project"'],
    ['europe-west2', 'us-central1'],
    [scanners[0], `${scanners[0]}-unrelated`],
    ['response_code_class="5xx"', 'response_code_class="2xx"'],
  ]) assert.throws(() => assertDashboardMetric(native.replace(original, changed), bundle()));
});
test('native scanner errors include timeout responses without app telemetry and exclude other runtimes or response classes', () => {
  const filter = bundle().policies.find(p => p.userLabels.policy_id === 'scanner').conditions[1].conditionThreshold.filter;
  for (const service of scanners) {
    for (const code of [500, 502, 503, 504, 599]) assert.equal(matches(filter, nativeResponse(service, code)), true);
    for (const code of [100, 200, 204, 301, 400, 401, 403, 404, 429]) assert.equal(matches(filter, nativeResponse(service, code)), false);
  }
  for (const service of [...SERVICES.slice(0, 3), 'unrelated', `${scanners[0]}-other`, `other-${scanners[1]}`]) {
    assert.equal(matches(filter, nativeResponse(service)), false);
  }
  for (const patch of [
    { type: 'global' },
    { labels: { ...nativeResponse().resource.labels, project_id: 'foreign-project' } },
    { labels: { ...nativeResponse().resource.labels, location: 'us-central1' } },
  ]) assert.equal(matches(filter, { ...nativeResponse(), resource: { ...nativeResponse().resource, ...patch } }), false);
  for (const wrongType of ['run.googleapis.com/request_latencies', 'evil.run.googleapis.com/request_count', metricType('scan_attempts')]) {
    assert.equal(matches(filter, { ...nativeResponse(), metric: { ...nativeResponse().metric, type: wrongType } }), false);
  }
  assert.doesNotMatch(filter, /jsonPayload|outcome|tier/);
});
test('native timeout threshold is independent of late ACKs, grouped by scanner across revisions, and sustained', () => {
  const policy = bundle().policies.find(p => p.userLabels.policy_id === 'scanner');
  assert.equal(policy.combiner, 'OR'); assert.equal(policy.conditions.length, 2);
  const [structured, native] = policy.conditions.map(c => c.conditionThreshold);
  assert.equal(type(structured.filter), metricType('scan_attempts'));
  assert.match(structured.filter, /metric\.labels\.outcome="failed"/);
  for (const condition of [structured, native]) {
    assert.equal(condition.thresholdValue, 2); assert.equal(condition.duration, '60s');
    assert.equal(condition.aggregations[0].alignmentPeriod, '3600s');
    assert.equal(condition.aggregations[0].perSeriesAligner, 'ALIGN_SUM');
    assert.equal(condition.aggregations[0].crossSeriesReducer, 'REDUCE_SUM');
    assert.deepEqual(condition.trigger, { count: 1 });
    assert.equal(condition.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
  }
  assert.deepEqual(native.aggregations[0].groupByFields, ['resource.label.service_name']);
  const counts = records => {
    const grouped = new Map();
    for (const record of records.filter(record => matches(native.filter, record))) {
      const service = record.resource.labels.service_name;
      grouped.set(service, (grouped.get(service) || 0) + 1);
    }
    return [...grouped.values()].some(count => count > native.thresholdValue);
  };
  const lateAck = { metric: { type: metricType('scan_attempts'), labels: { tier: 'normal', outcome: 'acknowledged' } }, resource: nativeResponse().resource };
  assert.equal(counts([]), false);
  assert.equal(counts([nativeResponse(), lateAck]), false);
  const twoNormalAndOneRoute = [nativeResponse(scanners[0], 504, 'old'), nativeResponse(scanners[0], 500, 'new'), nativeResponse(scanners[1], 504)];
  assert.equal(counts(twoNormalAndOneRoute), false);
  assert.equal(counts([...twoNormalAndOneRoute, nativeResponse(scanners[0], 503, 'new'), lateAck]), true);
  assert.match(policy.documentation.content, /independent conditions/);
  const chart = bundle().dashboard.mosaicLayout.tiles.find(tile => tile.widget.title.startsWith('Scanner native HTTP')).widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
  assert.equal(chart.filter, native.filter);
  assert.deepEqual(chart.aggregation.groupByFields, ['resource.label.service_name', 'metric.label.response_code']);
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
      if (type(c.conditionThreshold.filter) === 'run.googleapis.com/request_count') {
        assert.equal(p.userLabels.policy_id, 'scanner');
        assert.deepEqual(c.conditionThreshold.aggregations[0].groupByFields, ['resource.label.service_name']);
      } else {
        assert.ok(bundle().metrics.some(m => type(c.conditionThreshold.filter) === `logging.googleapis.com/user/${m.name}`));
        assert.deepEqual(c.conditionThreshold.aggregations[0].groupByFields, ['metric.label.tier']);
      }
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
  assert.match(bundle().dashboard.mosaicLayout.tiles[0].widget.text.content, /scheduled tick in the first ten minutes/);
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
    buildRouteMonitoring, buildConnectionHistoryMonitoring, buildEmailMonitoring, buildDerivedMetricsMonitoring, buildCleanupMonitoring].map(build => build(project, channel));
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
test('serial reapply preserves all nine existing bundles, every condition ID, etags and email channels', async () => {
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
test('upgrading the deployed structured-only scanner alert appends one condition without replacing any existing identity', async () => {
  const source = transport(); const legacy = bundle();
  legacy.policies.find(p => p.userLabels.policy_id === 'scanner').conditions.splice(1);
  legacy.dashboard.mosaicLayout.tiles = legacy.dashboard.mosaicLayout.tiles.filter(tile => !tile.widget.title.startsWith('Scanner native HTTP'));
  const first = await applyReparseMonitoring(legacy, source.request);
  const before = structuredClone(source.state);
  const oldScanner = before.alertPolicies.find(p => p.userLabels?.managed_by === OWNER && p.userLabels.policy_id === 'scanner');
  source.calls.length = 0;
  const upgraded = await applyReparseMonitoring(bundle(), source.request);
  assert.equal(upgraded.dashboard, first.dashboard);
  assert.equal(upgraded.metrics, 10); assert.equal(upgraded.policies, 7);
  assert.ok(source.calls.every(call => call.method !== 'POST' && call.method !== 'DELETE'));
  const scanner = source.state.alertPolicies.find(p => p.name === oldScanner.name);
  assert.equal(scanner.conditions.length, 2);
  assert.deepEqual(scanner.conditions[0], oldScanner.conditions[0]);
  assert.ok(scanner.conditions[1].name);
  for (const oldPolicy of before.alertPolicies.filter(p => p.name !== oldScanner.name)) {
    assert.deepEqual(source.state.alertPolicies.find(p => p.name === oldPolicy.name), oldPolicy);
  }
  assert.deepEqual(source.state.metrics, before.metrics);
  const identities = source.state.alertPolicies.map(p => [p.name, ...p.conditions.map(c => c.name)]);
  source.calls.length = 0;
  await applyReparseMonitoring(bundle(), source.request);
  assert.deepEqual(source.state.alertPolicies.map(p => [p.name, ...p.conditions.map(c => c.name)]), identities);
  assert.ok(source.calls.every(call => call.method !== 'POST' && call.method !== 'DELETE'));
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
