import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildCleanupMonitoring, OWNER, metricType, PROVIDERS, LANES } from './definitions.mjs';
import { applyCleanupMonitoring } from './cli.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildHealthSleepMonitoring } from '../health-sleep-monitoring/definitions.mjs';
import { buildActivityDeliveryMonitoring } from '../activity-delivery-monitoring/definitions.mjs';
import { buildRouteMonitoring } from '../route-monitoring/definitions.mjs';
import { buildConnectionHistoryMonitoring } from '../connection-history-monitoring/definitions.mjs';
import { buildEmailMonitoring } from '../email-monitoring/definitions.mjs';
import { buildDerivedMetricsMonitoring } from '../derived-metrics-monitoring/definitions.mjs';
import { buildReparseMonitoring } from '../reparse-monitoring/definitions.mjs';

const project = 'demo-cleanup-monitor';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildCleanupMonitoring(project, channel);
const metric = key => bundle().metrics.find(m => `logging.googleapis.com/user/${m.name}` === metricType(key));
// Evaluate the actual Logging filter against fixtures rather than restating its predicates.
function matches(filter, entry) {
  const tokens = filter.match(/"(?:[^"\\]|\\.)*"|>=|[=():>*]|[\w.]+/g); let at = 0;
  const take = expected => assert.equal(tokens[at++], expected);
  const value = token => token.startsWith('"') ? JSON.parse(token) : token === 'true' ? true : token === 'false' ? false : Number(token);
  function primary() {
    if (tokens[at] === '(') { at++; const result = expression(); take(')'); return result; }
    const path = tokens[at++]; const op = tokens[at++]; assert.ok(['=', '>=', '>'].includes(op));
    const actual = path.split('.').reduce((object, key) => object?.[key], entry); const values = [];
    if (tokens[at] === '(') {
      at++; values.push(value(tokens[at++]));
      while (tokens[at] === 'OR') { at++; values.push(value(tokens[at++])); } take(')');
    } else values.push(value(tokens[at++]));
    return actual !== undefined && values.some(expected => op === '=' ? actual === expected : typeof actual === 'number' && (op === '>' ? actual > expected : actual >= expected));
  }
  function conjunction() {
    let result = primary();
    while (at < tokens.length && !['OR', ')'].includes(tokens[at])) { const right = primary(); result = result && right; } return result;
  }
  function expression() { let result = conjunction(); while (tokens[at] === 'OR') { at++; const right = conjunction(); result = result || right; } return result; }
  const result = expression(); assert.equal(at, tokens.length); return result;
}
const entry = (fields = {}, resource = 'cloud_run_revision') => ({ resource: { type: resource, labels: {
  project_id: project, location: 'europe-west2', region: 'europe-west2',
} }, jsonPayload: { message: '[CleanupHealth]', telemetryVersion: 1, event: 'outcome', flow: 'disconnect', provider: 'SuuntoApp', lane: 'explicit', ...fields } });
const selected = (key, fields, resource) => matches(metric(key).filter, entry(fields, resource));

test('fixed categories, nine owned metrics, seven policies and mixed runtime boundaries', () => {
  const b = bundle(); assert.equal(b.metrics.length, 9); assert.equal(b.policies.length, 7);
  assert.equal(b.dashboard.displayName, 'QS Account Cleanup & Disconnect Recovery');
  for (const m of b.metrics) {
    assert.ok(m.description.startsWith(`[${OWNER}]`));
    assert.ok(m.metricDescriptor.labels.every(l => ['flow', 'provider', 'lane', 'outcome', 'capped'].includes(l.key)));
    assert.ok(Object.values(m.labelExtractors).every(v => /^EXTRACT\(jsonPayload\.(flow|provider|lane|outcome|capped)\)$/.test(v)));
  }
  for (const provider of PROVIDERS) for (const lane of LANES) {
    for (const resource of ['cloud_function', 'cloud_run_revision']) assert.equal(selected('outcomes', { outcome: 'completed', provider, lane }, resource), true);
  }
  for (const patch of [{ provider: 'PRIVATE_USER' }, { lane: 'PRIVATE_ERROR' }, { flow: 'private' }, { telemetryVersion: 2 }]) assert.equal(selected('outcomes', { outcome: 'completed', ...patch }), false);
  const foreign = entry({ outcome: 'failed' }); foreign.resource.labels.location = 'us-central1';
  assert.equal(matches(metric('failures').filter, foreign), false);
});
test('subscription cleanup includes its existing west3 trigger but not unrelated west3 functions', () => {
  const subscription = entry({ flow: 'recovery', outcome: 'partial', lane: 'queue_release' });
  subscription.resource.labels.location = 'europe-west3';
  subscription.resource.labels.service_name = 'onsubscriptionupdated';
  assert.equal(matches(metric('failures').filter, subscription), true);
  subscription.resource.labels.service_name = 'unrelated';
  assert.equal(matches(metric('failures').filter, subscription), false);
  subscription.resource.labels.service_name = 'onsubscriptionupdated';
  subscription.resource.labels.location = 'us-central1';
  assert.equal(matches(metric('failures').filter, subscription), false);
  subscription.resource.type = 'cloud_function';
  subscription.resource.labels.region = 'europe-west3';
  assert.equal(matches(metric('failures').filter, subscription), false);
});
test('expected waits, stale/deleted no-ops, remote limitations and terminal review do not count as failures', () => {
  for (const outcome of ['acknowledged', 'completed', 'started', 'deferred', 'superseded', 'remote_unconfirmed', 'manual_review']) {
    assert.equal(selected('failures', { outcome }), false);
    assert.equal(selected('overdue', { outcome, ageMs: 1e9 }), false);
  }
  for (const outcome of ['failed', 'partial', 'retry']) assert.equal(selected('failures', { outcome }), true);
  assert.equal(selected('remote_unconfirmed', { outcome: 'remote_unconfirmed' }), true);
  assert.equal(selected('manual_review', { outcome: 'manual_review' }), true);
  assert.equal(selected('outcomes', { event: 'retained_tombstone', outcome: 'completed' }), false);
});
test('overdue is real validated failure timing, never a creation-time/tombstone/backoff inference', () => {
  assert.equal(selected('overdue', { flow: 'operational', outcome: 'retry', ageMs: 86400000 }), true);
  assert.equal(selected('overdue', { flow: 'disconnect', outcome: 'retry', ageMs: 21600000 }), true);
  assert.equal(selected('overdue', { flow: 'account', outcome: 'failed', ageMs: 86400000 }), true);
  for (const fields of [
    { flow: 'operational', outcome: 'retry', ageMs: 86399999 },
    { flow: 'disconnect', outcome: 'retry', ageMs: 21599999 },
    { flow: 'account', outcome: 'failed' },
    { flow: 'account', outcome: 'acknowledged', ageMs: 1e9 },
    { flow: 'recovery', outcome: 'deferred', ageMs: 1e9 },
  ]) assert.equal(selected('overdue', fields), false);
});
test('idle/capped pages and failed scheduler ACK are distinct from eligible backlog and cleanup success', () => {
  for (const capped of [true, false]) {
    assert.equal(selected('pages', { event: 'page', capped, examined: 0 }), true);
    assert.equal(selected('examined', { event: 'page', capped, examined: 0 }), true);
    assert.equal(selected('outcomes', { event: 'page', capped, examined: 0 }), false);
  }
  assert.equal(selected('heartbeat', { event: 'heartbeat', lane: 'scheduler', provider: 'all', outcome: 'failed' }), true);
  assert.equal(selected('heartbeat', { event: 'page', lane: 'scheduler', provider: 'all', outcome: 'acknowledged' }), false);
  assert.doesNotMatch(readFileSync('functions/src/cleanup-monitoring.ts', 'utf8'), /firebase-admin|\.collection\(|\.doc\(|\.set\(|\.delete\(/);
});
test('policy thresholds are sustained, native abrupt account errors covered, only scheduler has absence policy', () => {
  for (const p of bundle().policies) {
    assert.equal(p.userLabels.managed_by, OWNER); assert.equal(p.enabled, true); assert.deepEqual(p.notificationChannels, [channel]);
    assert.deepEqual(p.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    assert.match(p.documentation.content, /No automatic remediation/);
    for (const c of p.conditions) {
      const condition = c.conditionThreshold || c.conditionAbsent;
      assert.match(condition.filter, /resource.type="cloud_(function|run_revision)"/);
      assert.ok(!/\bOR\b/.test(condition.filter));
      if (c.conditionAbsent) {
        assert.equal(p.userLabels.policy_id, 'heartbeat'); assert.equal(c.conditionAbsent.duration, '7200s');
      } else assert.equal(condition.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
    }
  }
  assert.match(bundle().policies[0].conditions[1].conditionThreshold.filter, /execution_count.*cleanupUserAccounts.*status!="ok"/);
  const overdue = bundle().policies.find(p => p.userLabels.policy_id === 'overdue').conditions[0].conditionThreshold;
  assert.equal(overdue.thresholdValue, 1); assert.equal(overdue.aggregations[0].alignmentPeriod, '21600s');
  const scheduler = bundle().policies.find(p => p.userLabels.policy_id === 'recovery').conditions[1].conditionThreshold;
  assert.match(scheduler.filter, /qs_cleanup_heartbeat_v1.*outcome="failed"/);
  assert.deepEqual(scheduler.aggregations[0].groupByFields, []);
  assert.equal(scheduler.thresholdValue, 1);
  const disconnect = bundle().policies.find(p => p.userLabels.policy_id === 'disconnect').conditions[0].conditionThreshold;
  assert.equal(disconnect.thresholdValue, 2);
  assert.equal(disconnect.aggregations[0].alignmentPeriod, '86400s');
  // One persistent episode can reach this threshold through its real backoff,
  // without needing five retries inside an impossible six-hour window.
  const attempts = [30 * 60, 150 * 60, 510 * 60];
  assert.ok(attempts.every(time => time < 86400));
  assert.ok(attempts.length > disconnect.thresholdValue);
});
test('a single partner revocation failure emails through the existing channel in either runtime', () => {
  const remote = bundle().policies.find(p => p.userLabels.policy_id === 'remote');
  assert.deepEqual(remote.notificationChannels, [channel]);
  assert.equal(remote.enabled, true);
  assert.equal(remote.conditions.length, 2);
  assert.match(remote.documentation.content, /last local token is already gone/);
  assert.match(remote.documentation.content, /provider connection may remain active/);
  for (const [index, resource] of ['cloud_function', 'cloud_run_revision'].entries()) {
    const c = remote.conditions[index].conditionThreshold;
    assert.match(c.filter, new RegExp(`qs_cleanup_remote_unconfirmed_v1.*resource.type="${resource}"`));
    assert.equal(c.thresholdValue, 0);
    assert.equal(c.duration, '60s');
    assert.equal(c.aggregations[0].alignmentPeriod, '3600s');
    for (const provider of PROVIDERS.filter(p => p !== 'all')) {
      for (const flow of ['disconnect', 'account']) {
        assert.equal(selected('remote_unconfirmed', { provider, flow, outcome: 'remote_unconfirmed' }, resource), true);
      }
    }
  }
  for (const outcome of ['completed', 'acknowledged', 'deferred', 'superseded', 'started']) {
    assert.equal(selected('remote_unconfirmed', { outcome }), false);
  }
});
test('offline preview, explicit cloud approval, CI registration and no index/Rules deployment requirement', () => {
  for (const args of [[`--project=${project}`], [`--project=${project}`, '--apply'], [`--project=${project}`, '--delete']]) {
    const result = spawnSync(process.execPath, ['tools/cleanup-monitoring/cli.mjs', ...args], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
    assert.equal(result.status, args.length === 1 ? 0 : 1);
    if (result.status === 0) assert.equal(JSON.parse(result.stdout).metrics.length, 9);
  }
  assert.throws(() => buildCleanupMonitoring(project, 'projects/other/notificationChannels/123'));
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:cleanup-monitoring'], 'node --test tools/cleanup-monitoring/monitoring.test.mjs');
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /run: npm run test:cleanup-monitoring/);
});

function transport() {
  const others = [buildTrainingMonitoring, buildImportMonitoring, buildHealthSleepMonitoring, buildActivityDeliveryMonitoring,
    buildRouteMonitoring, buildConnectionHistoryMonitoring, buildEmailMonitoring, buildDerivedMetricsMonitoring, buildReparseMonitoring].map(build => build(project, channel));
  const state = { dashboards: others.map((b, i) => ({ ...b.dashboard, name: `projects/${project}/dashboards/other-${i}`, etag: 'other' })),
    alertPolicies: others.flatMap((b, i) => b.policies.map((p, j) => ({ ...p, name: `projects/${project}/alertPolicies/other-${i}-${j}` }))), metrics: others.flatMap(b => b.metrics) };
  const calls = [];
  const request = async (method, url, body) => {
    const endpoint = new URL(url);
    if (!['logging.googleapis.com', 'monitoring.googleapis.com'].includes(endpoint.hostname) || endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password) throw Error('Unexpected URL');
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
      const name = method === 'POST' ? `projects/${project}/${key}/cleanup-${state[key].length}` : body.name;
      const saved = { ...structuredClone(body), name, ...(key === 'dashboards' ? { etag: 'next' }
        : { conditions: body.conditions.map((c, i) => ({ ...c, name: c.name || `${name}/conditions/${i}` })) }) };
      const index = state[key].findIndex(item => item.name === name);
      if (index < 0) state[key].push(saved); else state[key][index] = saved;
      return saved;
    }
    throw Error('Unexpected request');
  };
  return { state, calls, request };
}
test('serial reapplication preserves all nine other bundles and every condition ID; no deletion or channel changes', async () => {
  const source = transport(); const before = structuredClone(source.state);
  const first = await applyCleanupMonitoring(bundle(), source.request);
  const policies = structuredClone(source.state.alertPolicies.slice(before.alertPolicies.length)); source.calls.length = 0;
  const second = await applyCleanupMonitoring(bundle(), source.request);
  assert.equal(second.dashboard, first.dashboard); assert.equal(source.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(source.calls.filter(c => c.method === 'PATCH').length, 8);
  assert.deepEqual(source.state.alertPolicies.slice(before.alertPolicies.length), policies);
  for (const key of Object.keys(before)) assert.deepEqual(source.state[key].slice(0, before[key].length), before[key]);
  assert.ok(source.calls.every(c => c.method !== 'DELETE' && !c.url.includes('other-') && (c.method === 'GET' || !c.url.includes('/notificationChannels'))));
});
test('adding the remote policy to the original six preserves existing policies, conditions and dashboard', async () => {
  const source = transport(); const original = bundle();
  original.policies = original.policies.filter(p => p.userLabels.policy_id !== 'remote');
  const first = await applyCleanupMonitoring(original, source.request);
  const before = structuredClone(source.state.alertPolicies.filter(p => p.userLabels.managed_by === OWNER));
  source.calls.length = 0;
  const second = await applyCleanupMonitoring(bundle(), source.request);
  assert.equal(second.dashboard, first.dashboard);
  const posts = source.calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.userLabels.policy_id, 'remote');
  for (const policy of before) {
    assert.deepEqual(source.state.alertPolicies.find(p => p.name === policy.name), policy);
  }
});
test('ownership collisions and malformed/disabled configuration fail before writes', async () => {
  for (const bad of ['dashboard', 'policy', 'metric', 'schema', 'inventory', 'channel']) {
    const source = transport(); await applyCleanupMonitoring(bundle(), source.request); source.calls.length = 0;
    if (bad === 'dashboard') delete source.state.dashboards.at(-1).labels[OWNER];
    if (bad === 'policy') source.state.alertPolicies.at(-1).userLabels.policy_id = 'other';
    if (bad === 'metric') source.state.metrics.at(-1).description = 'unowned';
    if (bad === 'schema') source.state.metrics.at(-1).metricDescriptor.unit = 'ms';
    await assert.rejects(applyCleanupMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body);
      if (bad === 'inventory' && url.endsWith('/metrics')) return { metrics: [{}] };
      if (bad === 'channel' && url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: false };
      return result;
    }));
    assert.ok(source.calls.every(c => c.method === 'GET'));
  }
});
