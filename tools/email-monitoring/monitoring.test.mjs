import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildEmailMonitoring, OWNER, SERVICES, metricType } from './definitions.mjs';
import { applyEmailMonitoring } from './cli.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildHealthSleepMonitoring } from '../health-sleep-monitoring/definitions.mjs';
import { buildActivityDeliveryMonitoring } from '../activity-delivery-monitoring/definitions.mjs';
import { buildRouteMonitoring } from '../route-monitoring/definitions.mjs';
import { buildConnectionHistoryMonitoring } from '../connection-history-monitoring/definitions.mjs';

const project = 'demo-email-monitoring';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildEmailMonitoring(project, channel);
const metric = key => bundle().metrics.find(item => `logging.googleapis.com/user/${item.name}` === metricType(key));
const cloudTasksMarkers = /cloud_tasks_queue|cloudtasks\.googleapis\.com|queue_id/;
// Evaluate the emitted Logging subset, including conjunctions, comparisons and absence.
function matches(filter, entry) {
  const tokens = filter.match(/"(?:[^"\\]|\\.)*"|>=|[=():>*]|[\w.]+/g); let at = 0;
  const take = expected => assert.equal(tokens[at++], expected);
  const value = token => token.startsWith('"') ? JSON.parse(token) : token === 'true' ? true : Number(token);
  function primary() {
    if (tokens[at] === 'NOT') { at++; return !primary(); }
    if (tokens[at] === '(') { at++; const result = expression(); take(')'); return result; }
    const path = tokens[at++]; const op = tokens[at++]; assert.ok(['=', '>=', '>', ':'].includes(op));
    const actual = path.split('.').reduce((object, key) => object?.[key], entry); const values = [];
    if (tokens[at] === '(') { at++; values.push(value(tokens[at++])); while (tokens[at] === 'OR') { at++; values.push(value(tokens[at++])); } take(')'); }
    else values.push(tokens[at] === '*' ? tokens[at++] : value(tokens[at++]));
    if (op === ':') { assert.deepEqual(values, ['*']); return actual !== undefined; }
    return actual !== undefined && values.some(expected => op === '=' ? actual === expected : typeof actual === 'number' && (op === '>' ? actual > expected : actual >= expected));
  }
  function conjunction() { let result = primary(); while (at < tokens.length && !['OR', ')'].includes(tokens[at])) { const right = primary(); result = result && right; } return result; }
  function expression() { let result = conjunction(); while (tokens[at] === 'OR') { at++; const right = conjunction(); result = result || right; } return result; }
  const result = expression(); assert.equal(at, tokens.length); return result;
}
const entry = (event, fields = {}, service = 'trackmarketingdelivery') => ({ resource: { type: 'cloud_run_revision', labels: { project_id: project, location: 'europe-west2', service_name: service } },
  jsonPayload: { message: '[EmailDelivery]', telemetryVersion: 1, source: 'transactional', event, ...fields } });
const selected = (key, log) => matches(metric(key).filter, log);

test('Cloud Tasks absence assertion matches literal dots, not look-alike domains', () => {
  for (const marker of ['cloud_tasks_queue', 'cloudtasks.googleapis.com', 'queue_id']) {
    assert.match(marker, cloudTasksMarkers);
  }
  for (const lookalike of ['cloudtasksXgoogleapis.com', 'cloudtasks.googleapisXcom', 'cloudtasksXgoogleapisYcom']) {
    assert.doesNotMatch(lookalike, cloudTasksMarkers);
  }
});

test('12 fixed-category metrics, 7 sustained policies and real email runtimes, never invented Cloud Tasks', () => {
  const b = bundle(); assert.equal(b.metrics.length, 12); assert.equal(b.policies.length, 7);
  assert.doesNotMatch(JSON.stringify(b), cloudTasksMarkers);
  for (const m of b.metrics) {
    assert.ok(m.description.startsWith(`[${OWNER}]`));
    assert.ok(m.metricDescriptor.labels.every(label => ['source', 'state', 'operation', 'outcome'].includes(label.key)));
    assert.doesNotMatch(JSON.stringify(m.labelExtractors), /uid|address|mailId|campaign|subject|token|error|body|messageId/i);
  }
  assert.match(metric('runtime_errors').filter, /ext-firestore-send-email-processQueue/);
  assert.match(metric('runtime_errors').filter, /ext-firestore-send-email-processqueue/);
  assert.doesNotMatch(metric('runtime_errors').filter, /changemarketingcampaignstatus/);
  assert.equal(b.dashboard.mosaicLayout.tiles.length, 16);
  const queries = b.dashboard.mosaicLayout.tiles.slice(1).map(tile => tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter);
  for (const query of queries) {
    if (!query.filter.includes('logging.googleapis.com/user/')) continue;
    const descriptor = b.metrics.find(m => query.filter.includes(`"logging.googleapis.com/user/${m.name}"`)).metricDescriptor;
    assert.ok(query.aggregation.groupByFields.every(field => descriptor.labels.some(label => field === `metric.label.${label.key}`)));
  }
  for (const service of SERVICES) assert.ok(queries.some(query => query.filter.includes(service)));
});
test('queued, extension processing, SMTP acceptance, partial acceptance and errors are distinct', () => {
  for (const state of ['queued', 'pending', 'processing', 'retry', 'smtp_accepted', 'smtp_partial', 'error', 'unknown']) {
    assert.equal(selected('states', entry('state_observed', { state })), true);
    assert.equal(selected('smtp_failures', entry('state_observed', { state })), ['error', 'smtp_partial'].includes(state));
  }
  for (const fields of [{ source: 'private-account' }, { state: 'private error' }, { telemetryVersion: 2 }]) assert.equal(selected('states', entry('state_observed', { state: 'queued', ...fields })), false);
  assert.equal(selected('states', entry('state_observed', { state: 'error' }, 'unrelated')), false);
});
test('dispatch caps, schedules, suppression, pauses and idle work never count as failure', () => {
  for (const reason of ['daily_cap', 'schedule', 'suppression', 'pause', 'no_recipient']) assert.equal(selected('operation_failures', entry('dispatch_deferred', { reason }, 'dispatchmarketingcampaigns')), false);
  assert.equal(selected('operation_failures', entry('operation', { operation: 'dispatch', outcome: 'completed', submitted: 0 }, 'dispatchmarketingcampaigns')), false);
  assert.equal(selected('operation_failures', entry('operation', { operation: 'dispatch', outcome: 'failed' }, 'dispatchmarketingcampaigns')), true);
  assert.equal(selected('smtp_failures', entry('operation', { operation: 'dispatch', outcome: 'completed', submitted: 25 }, 'dispatchmarketingcampaigns')), false);
});
test('backlog samples preserve idle, future leases, unknown and saturated-prefix semantics', () => {
  const sample = fields => entry('outbox_sample', { unknownSample: 0, truncated: false, ...fields }, 'dispatchmarketingcampaigns');
  assert.equal(selected('overdue_samples', sample({ dueSample: 0, ageLowerBoundMs: 900000 })), false);
  for (const age of [899999, 900000]) assert.equal(selected('overdue_samples', sample({ dueSample: 1, ageLowerBoundMs: age })), age === 900000);
  for (const fields of [{ unknownSample: 1 }, { truncated: true }]) {
    assert.equal(selected('probe_failures', sample(fields)), true); assert.equal(selected('sampled_due', sample(fields)), false);
  }
  assert.equal(selected('probe_failures', sample({ truncated: true, dueSample: 20, ageLowerBoundMs: 900000 })), false);
  assert.equal(selected('probe_failures', entry('outbox_sample_unavailable', {}, 'dispatchmarketingcampaigns')), true);
  assert.equal(selected('sampled_due', entry('outbox_sample_unavailable', {}, 'dispatchmarketingcampaigns')), false);
});
test('alerts use independent direct email, initialized idle heartbeat and no public/private mail content', () => {
  for (const policy of bundle().policies) {
    assert.equal(policy.userLabels.managed_by, OWNER); assert.deepEqual(policy.notificationChannels, [channel]);
    assert.equal(policy.enabled, true); assert.match(policy.documentation.content, /Never blindly resend/);
    assert.match(policy.documentation.content, /not unique recipients/);
    for (const condition of policy.conditions) {
      const filter = (condition.conditionThreshold || condition.conditionAbsent).filter;
      assert.match(filter, /resource.type="(cloud_run_revision|cloud_function)"/);
      if (condition.conditionThreshold) assert.equal(condition.conditionThreshold.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE');
      else assert.equal(condition.conditionAbsent.duration, '3600s');
    }
  }
  assert.equal(bundle().policies.at(-1).conditions.length, 2);
  const native = bundle().policies.find(policy => policy.userLabels.policy_id === 'runtime');
  assert.equal(native.conditions.length, 2);
  assert.equal(new Set(native.conditions.map(condition => condition.displayName)).size, 2);
});
test('offline CLI preview is credential-free, unconfirmed apply refuses, CI runs this bundle', () => {
  for (const args of [[`--project=${project}`], [`--project=${project}`, '--apply'], [`--project=${project}`, '--delete']]) {
    const result = spawnSync(process.execPath, ['tools/email-monitoring/cli.mjs', ...args], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
    assert.equal(result.status, args.length === 1 ? 0 : 1); if (!result.status) assert.equal(JSON.parse(result.stdout).policies.length, 7);
  }
  assert.throws(() => buildEmailMonitoring(project, 'projects/other/notificationChannels/123'));
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:email-monitoring'], 'node --test tools/email-monitoring/monitoring.test.mjs');
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /run: npm run test:email-monitoring/);
  assert.deepEqual(SERVICES, ['dispatchmarketingcampaigns', 'trackmarketingdelivery', 'changemarketingcampaignstatus']);
  assert.doesNotMatch(readFileSync('functions/src/full-entrypoint.ts', 'utf8'), /observeEmailDelivery/);
  assert.equal(/^TTL_EXPIRE_TYPE=never$/m.test(readFileSync('extensions/firestore-send-email.env', 'utf8')), true, 'Initializing PENDING must preserve the configured external TTL boundary.');
});
test('all application and operator mail producers initialize pending metadata in their existing write', () => {
  const paths = ['email/registration-welcome.ts', 'stripe/email-triggers.ts', 'user/user.ts', 'schedule/notifications.ts',
    'admin/handlers/subscription-gifts.handlers.ts', 'admin/marketing/service.ts', 'scripts/test-all-emails.ts',
    'scripts/queue-mcp-connection-update.ts', 'scripts/queue_development_update_emails.ts'];
  for (const path of paths) assert.match(readFileSync(`functions/src/${path}`, 'utf8'), /\.\.\.newEmailDeliveryFields\(\)/, `${path} must use existing-mail metadata, never a second queue.`);
  assert.doesNotMatch(readFileSync('functions/src/email/monitoring-probe.ts', 'utf8'), /\.set\(|\.update\(|\.create\(|\.delete\(|runTransaction|\.collection\('email/);
  const docs = readFileSync('docs/email-lifecycle.md', 'utf8');
  assert.match(docs, /## Cloud Monitoring \(#835\)/); assert.match(docs, /Future production deployments/);
  assert.match(docs, /first five-minute slot of each UTC quarter-hour/);
  assert.match(docs, /MCP\/Assistant impact: \*\*none\*\*/); assert.match(docs, /no delivery state at all/);
  assert.match(docs, /No extra document write or Function invocation/);
});

function transport() {
  const others = [buildTrainingMonitoring, buildImportMonitoring, buildHealthSleepMonitoring, buildActivityDeliveryMonitoring, buildRouteMonitoring, buildConnectionHistoryMonitoring].map(build => build(project, channel));
  const state = { dashboards: others.map((b, i) => ({ ...b.dashboard, name: `projects/${project}/dashboards/other-${i}`, etag: 'other' })),
    alertPolicies: others.flatMap((b, i) => b.policies.map((p, j) => ({ ...p, name: `projects/${project}/alertPolicies/other-${i}-${j}` }))), metrics: others.flatMap(b => b.metrics) };
  const calls = [];
  const request = async (method, url, body) => {
    const endpoint = new URL(url); calls.push({ method, url, body });
    if (method === 'GET') {
      if (endpoint.pathname.endsWith('/notificationChannels/123')) return { type: 'email', enabled: true };
      for (const key of Object.keys(state)) if (endpoint.pathname.endsWith(`/${key}`)) return { [key]: structuredClone(state[key]) };
    } else if (endpoint.hostname === 'logging.googleapis.com') {
      const index = state.metrics.findIndex(m => m.name === body.name); if (index < 0) state.metrics.push(structuredClone(body)); else state.metrics[index] = structuredClone(body); return body;
    } else {
      const key = endpoint.pathname.includes('/dashboards') ? 'dashboards' : 'alertPolicies';
      const name = method === 'POST' ? `projects/${project}/${key}/email-${state[key].length}` : body.name;
      const saved = { ...structuredClone(body), name, ...(key === 'dashboards' ? { etag: 'next' } : { conditions: body.conditions.map((c, i) => ({ ...c, name: c.name || `${name}/conditions/${i}` })) }) };
      const index = state[key].findIndex(item => item.name === name); if (index < 0) state[key].push(saved); else state[key][index] = saved; return saved;
    }
    throw new Error('Unexpected request');
  };
  return { state, calls, request };
}
test('serial apply/reapply preserves six other bundles, condition IDs, channels and resources without DELETE', async () => {
  const source = transport(); const before = structuredClone(source.state);
  const first = await applyEmailMonitoring(bundle(), source.request); assert.equal(first.metrics, 12); assert.equal(first.policies, 7);
  source.calls.length = 0; const second = await applyEmailMonitoring(bundle(), source.request);
  assert.equal(first.dashboard, second.dashboard); assert.ok(source.calls.every(c => c.method !== 'DELETE' && c.method !== 'POST' && !c.url.includes('other-')));
  for (const key of Object.keys(before)) assert.deepEqual(source.state[key].slice(0, before[key].length), before[key]);
  assert.equal(source.calls.find(c => c.method === 'PATCH' && c.url.includes('/dashboards')).body.etag, 'next');
  assert.ok(source.calls.filter(c => c.method === 'PATCH' && c.url.includes('alertPolicies')).every(c => c.body.conditions.every(condition => condition.name)));
});
test('ownership collisions, immutable schemas, disabled channels and malformed inventories fail before writes', async () => {
  for (const bad of ['dashboard', 'policy', 'metric', 'schema', 'inventory', 'channel']) {
    const source = transport(); await applyEmailMonitoring(bundle(), source.request); source.calls.length = 0;
    if (bad === 'dashboard') delete source.state.dashboards.at(-1).labels[OWNER];
    if (bad === 'policy') source.state.alertPolicies.at(-1).userLabels.policy_id = 'other';
    if (bad === 'metric') source.state.metrics.at(-1).description = 'unowned';
    if (bad === 'schema') source.state.metrics.at(-1).metricDescriptor.unit = 'ms';
    await assert.rejects(applyEmailMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body);
      if (bad === 'inventory' && url.endsWith('/metrics')) return { metrics: [{}] };
      if (bad === 'channel' && url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: false };
      return result;
    }));
    assert.ok(source.calls.every(c => c.method === 'GET'));
  }
});
test('paginated inventories reuse owned resources and repeated tokens stop before mutation', async () => {
  const source = transport(); await applyEmailMonitoring(bundle(), source.request); source.calls.length = 0;
  await applyEmailMonitoring(bundle(), async (method, url, body) => {
    const result = await source.request(method, url.split('?')[0], body);
    if (method === 'GET' && url.includes('/dashboards')) return !url.includes('?') ? { dashboards: result.dashboards.slice(0, -1), nextPageToken: 'next / page' } : { dashboards: result.dashboards.slice(-1) };
    return result;
  });
  assert.ok(source.calls.every(c => c.method !== 'POST')); source.calls.length = 0;
  await assert.rejects(applyEmailMonitoring(bundle(), async (method, url, body) => {
    const result = await source.request(method, url.split('?')[0], body);
    return method === 'GET' && url.includes('/metrics') ? { ...result, nextPageToken: 'repeated' } : result;
  }), /Repeated inventory page token/);
  assert.ok(source.calls.every(c => c.method === 'GET'));
});
