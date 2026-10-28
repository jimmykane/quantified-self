import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildRouteMonitoring, OWNER, metricType } from './definitions.mjs';
import { applyRouteMonitoring } from './cli.mjs';
import { buildActivityDeliveryMonitoring } from '../activity-delivery-monitoring/definitions.mjs';
import { buildHealthSleepMonitoring } from '../health-sleep-monitoring/definitions.mjs';
import { buildImportMonitoring } from '../import-monitoring/definitions.mjs';
import { buildTrainingMonitoring } from '../training-monitoring/definitions.mjs';

const project = 'demo-route-monitor';
const channel = `projects/${project}/notificationChannels/123`;
const bundle = () => buildRouteMonitoring(project, channel);
const type = filter => /metric\.type="([^"]+)"/.exec(filter)?.[1];
const metric = key => bundle().metrics.find(m => m.name === `qs_route_${key}_v1`);

// Evaluate the Logging filter subset used here against synthetic entries. Fail on
// unsupported syntax instead of accepting an untested production filter silently.
function matches(filter, entry) {
  const tokens = filter.match(/"(?:[^"\\]|\\.)*"|>=|[=():>*]|[\w.]+/g);
  let at = 0;
  const take = expected => { assert.equal(tokens[at++], expected); };
  const value = token => token.startsWith('"') ? JSON.parse(token) : token === 'true' ? true : token === 'false' ? false : Number(token);
  function primary() {
    if (tokens[at] === 'NOT') { at++; return !primary(); }
    if (tokens[at] === '(') { at++; const result = expression(); take(')'); return result; }
    const path = tokens[at++]; const op = tokens[at++];
    assert.ok(['=', '>=', '>', ':'].includes(op));
    const actual = path.split('.').reduce((object, key) => object?.[key], entry);
    const values = [];
    if (tokens[at] === '(') {
      at++; values.push(value(tokens[at++]));
      while (tokens[at] === 'OR') { at++; values.push(value(tokens[at++])); }
      take(')');
    } else values.push(tokens[at] === '*' ? tokens[at++] : value(tokens[at++]));
    if (op === ':') { assert.deepEqual(values, ['*']); return actual !== undefined; }
    if (actual === undefined) return false;
    return values.some(expected => op === '=' ? actual === expected : typeof actual === 'number' && (op === '>' ? actual > expected : actual >= expected));
  }
  function conjunction() {
    let result = primary();
    while (at < tokens.length && !['OR', ')'].includes(tokens[at])) {
      if (tokens[at] === 'AND') at++;
      const right = primary(); result = result && right;
    }
    return result;
  }
  function expression() {
    let result = conjunction();
    while (tokens[at] === 'OR') { at++; const right = conjunction(); result = result || right; }
    return result;
  }
  const result = expression(); assert.equal(at, tokens.length); return result;
}
function entry(event, fields = {}, resource = 'cloud_run_revision') {
  return { resource: { type: resource, labels: { project_id: project, location: 'europe-west2', region: 'europe-west2',
    service_name: 'processroutedeliverysynctask', function_name: 'dispatchRouteDeliverySyncQueue' } },
  jsonPayload: { message: '[RouteQueue]', telemetryVersion: 1, lane: 'delivery', source: 'suunto', destination: 'wahoo', mode: 'automatic', event, ...fields } };
}
const selected = (key, log) => matches(metric(key).filter, log);

test('fixed versioned metrics, correct resource generations, chart references and native queues', () => {
  const config = bundle(); assert.equal(config.metrics.length, 16); assert.equal(config.policies.length, 8);
  const known = new Set(config.metrics.map(m => `logging.googleapis.com/user/${m.name}`));
  for (const m of config.metrics) {
    assert.ok(m.description.startsWith(`[${OWNER}]`)); assert.match(m.filter, /telemetryVersion=1/);
    assert.match(m.filter, /jsonPayload.message="\[RouteQueue\]"/);
    assert.equal(m.metricDescriptor.metricKind, 'DELTA');
    assert.ok(m.metricDescriptor.labels.every(l => ['lane', 'source', 'destination', 'mode', 'outcome', 'phase'].includes(l.key)));
    assert.doesNotMatch(JSON.stringify(m.labelExtractors), /userID|routeID|jobID|title|name|geometry|path|credential|error/i);
    if (m.valueExtractor) {
      assert.equal(m.metricDescriptor.valueType, 'DISTRIBUTION');
      assert.ok(m.bucketOptions.explicitBuckets.bounds.every((n, i, a) => i === 0 || n > a[i - 1]));
    }
  }
  const tiles = config.dashboard.mosaicLayout.tiles;
  assert.equal(tiles.length, 20);
  for (const tile of tiles.slice(1)) {
    const query = tile.widget.xyChart.dataSets[0].timeSeriesQuery.timeSeriesFilter;
    assert.match(query.filter, /resource.labels.project_id="demo-route-monitor"/);
    if (known.has(type(query.filter))) {
      const m = config.metrics.find(m => `logging.googleapis.com/user/${m.name}` === type(query.filter));
      assert.ok(query.aggregation.groupByFields.every(field => m.metricDescriptor.labels.some(label => field === `metric.label.${label.key}`)));
      if (m.metricDescriptor.valueType === 'DISTRIBUTION') {
        if (m.name === 'qs_route_worker_latency_v1') assert.equal(query.aggregation.perSeriesAligner, 'ALIGN_PERCENTILE_95');
        else {
          assert.equal(query.aggregation.perSeriesAligner, 'ALIGN_SUM');
          assert.equal(query.aggregation.crossSeriesReducer, 'REDUCE_MEAN');
          assert.match(tile.widget.title, /hourly mean/);
        }
      }
    } else {
      assert.match(type(query.filter), /^cloudtasks.googleapis.com\/queue\/(depth|task_attempt_count|task_attempt_delays)$/);
      assert.match(query.filter, /resource.type="cloud_tasks_queue"/);
      assert.match(query.filter, /location="europe-west2"/);
      assert.match(query.filter, /queue_id=one_of\("processRouteSyncTask", "processRouteDeliverySyncTask"\)/);
    }
  }
});

test('real transitions are separated from acknowledgement, contention and retained failures', () => {
  for (const lane of ['import', 'delivery']) {
    const fields = { lane, destination: lane === 'import' ? 'qs' : 'garmin' };
    for (const outcome of ['success', 'skipped', 'retry', 'expected_contention', 'dead_lettered', 'manual_reconciliation']) {
      const log = entry('committed', { ...fields, outcome });
      assert.equal(selected('committed', log), true);
      assert.equal(selected('worker_failures', log), outcome === 'retry');
      assert.equal(selected('new_dead_letters', log), outcome === 'dead_lettered');
      assert.equal(selected('new_reconciliation', log), outcome === 'manual_reconciliation');
    }
    for (const outcome of ['acknowledged', 'already_processed', 'already_failed', 'cleanup_removed', 'deferred', 'manual_reconciliation', 'dead_lettered', 'retry', 'failed', 'expected_contention']) {
      const log = entry('worker_attempt', { ...fields, outcome, durationMs: 50 });
      assert.equal(selected('worker_attempts', log), true);
      assert.equal(selected('worker_latency', log), true);
      assert.equal(selected('committed', log), false);
      assert.equal(selected('worker_failures', log), outcome === 'failed');
      assert.equal(selected('new_dead_letters', log), false);
    }
  }
  const unknown = entry('worker_attempt', { lane: 'import', source: 'unknown', destination: 'unknown', outcome: 'failed' });
  assert.equal(selected('worker_failures', unknown), true);
  const hostile = entry('committed', { destination: 'private-route-id', outcome: 'success' });
  assert.equal(selected('committed', hostile), false);
  for (const key of ['project_id', 'location']) {
    const other = entry('committed', { outcome: 'success' }); other.resource.labels[key] = 'other';
    assert.equal(selected('committed', other), false);
  }
  for (const [key, value] of [['message', '[TrainingDelivery]'], ['telemetryVersion', 2]]) {
    assert.equal(selected('committed', entry('committed', { outcome: 'success', [key]: value })), false);
  }
});

test('immediate dispatch across both generations and whole-run failure are observable, not duplicate/skip', () => {
  for (const resource of ['cloud_function', 'cloud_run_revision']) {
    for (const lane of ['import', 'delivery']) {
      assert.equal(selected('dispatch_failures', entry('dispatch_failure', { lane, destination: 'unknown', source: 'unknown', phase: 'enqueue', dispatchMode: 'immediate' }, resource)), true);
    }
  }
  assert.equal(selected('dispatch_failures', entry('dispatch_run', { destination: 'unknown', source: 'unknown', outcome: 'failed' }, 'cloud_function')), true);
  for (const outcome of ['completed', 'deduplicated', 'skipped']) {
    assert.equal(selected('dispatch_failures', entry('dispatch_run', { outcome }, 'cloud_function')), false);
  }
  assert.equal(selected('dispatch_runs', entry('dispatch_run', { outcome: 'completed' }, 'cloud_function')), true);
});

test('idle, old eligible work, unavailable and partial/saturated samples never invent healthy zero', () => {
  for (const [lane, destination] of [['import', 'qs'], ['delivery', 'garmin'], ['delivery', 'wahoo'], ['delivery', 'coros']]) {
    const sample = fields => entry('queue_sample', { lane, destination, mode: undefined, unknownSample: 0, truncated: false, ...fields }, 'cloud_function');
    const idle = sample({ dueSample: 0, ageLowerBoundMs: 0 });
    assert.equal(selected('queue_samples', idle), true); assert.equal(selected('sampled_due', idle), true);
    assert.equal(selected('overdue_samples', idle), false); assert.equal(selected('probe_failures', idle), false);
    for (const age of [3599999, 3600000]) assert.equal(selected('overdue_samples', sample({ dueSample: 1, ageLowerBoundMs: age })), age >= 3600000);
    const partial = sample({ unknownSample: 1 });
    assert.equal(selected('probe_failures', partial), true); assert.equal(selected('sampled_due', partial), false); assert.equal(selected('sampled_age', partial), false);
    const saturated = sample({ truncated: true });
    assert.equal(selected('probe_failures', saturated), true); assert.equal(selected('sampled_due', saturated), false);
    assert.equal(selected('sample_truncated', saturated), true);
    assert.equal(selected('probe_failures', sample({ truncated: true, dueSample: 1, ageLowerBoundMs: 0 })), false);
    const unavailable = entry('queue_sample_unavailable', { lane, destination, mode: undefined }, 'cloud_function');
    assert.equal(selected('queue_samples', unavailable), true); assert.equal(selected('probe_failures', unavailable), true);
    assert.equal(selected('sampled_due', unavailable), false);
  }
});

test('cleanup includes retryable failures but excludes deliberate stale/malformed discards', () => {
  for (const service of ['cleanuprejectedrouteoriginalfile', 'redriverejectedrouteoriginalcleanup']) {
    for (const outcome of ['deleted', 'stale_discarded', 'malformed_discarded', 'failed', 'backoff_failed']) {
      const log = entry('original_cleanup', { lane: 'cleanup', source: undefined, destination: undefined, mode: undefined, outcome, phase: 'storage_delete' });
      log.resource.labels.service_name = service;
      assert.equal(selected('original_cleanup', log), true);
      assert.equal(selected('cleanup_failures', log), ['failed', 'backoff_failed'].includes(outcome));
    }
  }
});

test('sustained policies group by lane/destination, cover both dispatch runtimes and four idle heartbeats', () => {
  const config = bundle();
  for (const policy of config.policies) {
    assert.equal(policy.userLabels.managed_by, OWNER); assert.deepEqual(policy.notificationChannels, [channel]);
    assert.equal(policy.enabled, true); assert.equal(policy.combiner, 'OR');
    assert.deepEqual(policy.alertStrategy.notificationPrompts, ['OPENED', 'CLOSED']);
    assert.match(policy.documentation.content, /Do not blindly replay/);
    assert.ok(policy.conditions.length <= 6);
    for (const condition of policy.conditions) {
      const body = condition.conditionThreshold || condition.conditionAbsent;
      assert.ok(type(body.filter).startsWith('logging.googleapis.com/user/qs_route_'));
      assert.deepEqual(body.aggregations[0].groupByFields, policy.userLabels.policy_id === 'cleanup' ? [] : ['metric.label.lane', 'metric.label.destination']);
      if (condition.conditionThreshold) { assert.equal(body.evaluationMissingData, 'EVALUATION_MISSING_DATA_INACTIVE'); assert.equal(body.duration, '60s'); }
      else { assert.equal(body.duration, '7200s'); assert.equal(type(body.filter), metricType('queue_samples')); }
    }
  }
  const heartbeat = config.policies.find(p => p.userLabels.policy_id === 'heartbeat');
  assert.equal(heartbeat.conditions.length, 4);
  assert.match(heartbeat.conditions[0].conditionAbsent.filter, /lane="import" metric.labels.destination="qs"/);
  assert.equal(config.policies.find(p => p.userLabels.policy_id === 'dispatch').conditions.length, 2);
});

test('offline preview and invalid arguments do not require credentials or network', () => {
  for (const args of [[`--project=${project}`], [`--project=${project}`, '--apply'], [`--project=${project}`, '--delete'], [`--project=${project}`, '--project=other']]) {
    const result = spawnSync(process.execPath, ['tools/route-monitoring/cli.mjs', ...args], { encoding: 'utf8', env: { PATH: '/no-credentials' } });
    assert.equal(result.status, args.length === 1 ? 0 : 1);
    if (result.status === 0) assert.deepEqual(JSON.parse(result.stdout).policies[0].notificationChannels, []);
  }
  assert.throws(() => buildRouteMonitoring(project, 'projects/other/notificationChannels/123'));
  assert.throws(() => buildRouteMonitoring(`${project} bad`));
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.scripts['test:route-monitoring'], 'node --test tools/route-monitoring/monitoring.test.mjs');
  assert.match(readFileSync('.github/workflows/_run-tests.yml', 'utf8'), /run: npm run test:route-monitoring/);
});

test('CLI invoked through a symlinked checkout runs preview and rejects unconfirmed apply', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'qs-route-cli-'));
  try {
    const alias = join(temporary, 'checkout alias');
    symlinkSync(process.cwd(), alias, 'dir');
    const cli = join(alias, 'tools/route-monitoring/cli.mjs');
    for (const flags of [[], ['--preserve-symlinks-main']]) {
      const preview = spawnSync(process.execPath, [...flags, cli, `--project=${project}`], {
        encoding: 'utf8', env: { PATH: '/no-credentials' },
      });
      assert.equal(preview.status, 0, preview.stderr);
      assert.equal(JSON.parse(preview.stdout).dashboard.displayName, 'QS Routes');
      const unconfirmed = spawnSync(process.execPath, [...flags, cli, `--project=${project}`, '--apply'], {
        encoding: 'utf8', env: { PATH: '/no-credentials' },
      });
      assert.equal(unconfirmed.status, 1);
      assert.match(unconfirmed.stderr, /Route monitoring setup failed/);
    }
  } finally {
    // Only the unique fixture directory and its symlink, never the linked checkout.
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('importing the CLI from eval with non-file arguments never starts setup', () => {
  const url = new URL('./cli.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
    `await import(${JSON.stringify(url)}); console.log('imported');`, '--', 'not-an-entrypoint-file'], {
    encoding: 'utf8', env: { PATH: '/no-credentials' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'imported');
  assert.equal(result.stderr, '');
});

function transport() {
  const others = [buildTrainingMonitoring(project, channel), buildImportMonitoring(project, channel), buildHealthSleepMonitoring(project, channel), buildActivityDeliveryMonitoring(project, channel)];
  const state = { dashboards: others.map((b, i) => ({ ...b.dashboard, name: `projects/${project}/dashboards/other-${i}`, etag: 'other' })),
    alertPolicies: others.flatMap((b, i) => b.policies.map((p, j) => ({ ...p, name: `projects/${project}/alertPolicies/other-${i}-${j}` }))),
    metrics: others.flatMap(b => b.metrics) };
  const calls = [];
  const request = async (method, url, body) => {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password
        || !['logging.googleapis.com', 'monitoring.googleapis.com'].includes(endpoint.hostname)) {
      throw new Error('Unexpected synthetic request');
    }
    calls.push({ method, url, body });
    if (method === 'GET') {
      if (endpoint.pathname.endsWith('/notificationChannels/123')) return { type: 'email', enabled: true };
      for (const key of Object.keys(state)) if (endpoint.pathname.endsWith(`/${key}`)) return { [key]: structuredClone(state[key]) };
    } else if (endpoint.hostname === 'logging.googleapis.com') {
      const at = state.metrics.findIndex(m => m.name === body.name);
      if (at < 0) state.metrics.push(structuredClone(body)); else state.metrics[at] = structuredClone(body);
      return body;
    } else {
      const key = endpoint.pathname.includes('/dashboards') ? 'dashboards' : 'alertPolicies';
      const name = method === 'POST' ? `projects/${project}/${key}/route-${state[key].length}` : body.name;
      const saved = { ...structuredClone(body), name, ...(key === 'dashboards' ? { etag: 'next-etag' } : {
        conditions: body.conditions.map((c, i) => ({ ...c, name: c.name || `${name}/conditions/${i}` })),
      }) };
      const at = state[key].findIndex(x => x.name === name);
      if (at < 0) state[key].push(saved); else state[key][at] = saved;
      return saved;
    }
    throw new Error('Unexpected synthetic request');
  };
  return { state, calls, request };
}
test('synthetic transport rejects look-alike API URLs before reading or changing state', async () => {
  const source = transport(); const original = structuredClone(source.state);
  const path = `/v2/projects/${project}/metrics`;
  const badUrls = [
    `https://logging.googleapis.com.evil.test${path}`,
    `https://evil-logging.googleapis.com${path}`,
    `https://logging.googleapis.com@evil.test${path}`,
    `https://evil.test/logging.googleapis.com${path}`,
    `https://evil.test${path}?host=logging.googleapis.com`,
    `https://monitoring.googleapis.com.evil.test${path}`,
    `https://evil.test${path}?host=monitoring.googleapis.com`,
    `https://user:password@logging.googleapis.com${path}`,
    `https://logging.googleapis.com:8443${path}`,
    `http://logging.googleapis.com${path}`,
  ];
  for (const url of badUrls) {
    for (const method of ['GET', 'PUT']) {
      await assert.rejects(source.request(method, url, bundle().metrics[0]), /Unexpected synthetic request/);
    }
  }
  assert.deepEqual(source.state, original);
  assert.deepEqual(source.calls, []);
  await assert.rejects(source.request('PUT', 'not-an-absolute-url', bundle().metrics[0]), { code: 'ERR_INVALID_URL' });
  assert.deepEqual(source.state, original);
  assert.deepEqual(source.calls, []);
});
test('synthetic transport preserves canonical HTTPS hosts, default ports and query strings', async () => {
  const source = transport(); const original = structuredClone(source.state);
  const metrics = await source.request('GET', `https://LOGGING.googleapis.com:443/v2/projects/${project}/metrics?pageToken=next`);
  assert.deepEqual(metrics, { metrics: original.metrics });
  const selected = await source.request('GET', `https://MONITORING.googleapis.com:443/v3/${channel}`);
  assert.deepEqual(selected, { type: 'email', enabled: true });
  const metric = bundle().metrics[0];
  await source.request('PUT', `https://LOGGING.googleapis.com:443/v2/projects/${project}/metrics/${metric.name}`, metric);
  assert.deepEqual(source.state.metrics.at(-1), metric);
});
test('serial create/reapply does not duplicate, delete or modify other bundles, and preserves condition IDs/etag', async () => {
  const source = transport(); const original = structuredClone(source.state);
  const first = await applyRouteMonitoring(bundle(), source.request);
  assert.equal(first.metrics, 16); assert.equal(first.policies, 8);
  assert.equal(source.calls.filter(c => c.method === 'POST').length, 9);
  source.calls.length = 0;
  const second = await applyRouteMonitoring(bundle(), source.request);
  assert.equal(first.dashboard, second.dashboard);
  assert.equal(source.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(source.calls.filter(c => c.method === 'PATCH').length, 9);
  assert.equal(source.calls.find(c => c.method === 'PATCH').body.etag, 'next-etag');
  for (const key of Object.keys(original)) assert.deepEqual(source.state[key].slice(0, original[key].length), original[key]);
  for (const call of source.calls.filter(c => c.method === 'PATCH' && c.url.includes('/alertPolicies/'))) assert.ok(call.body.conditions.every(c => c.name));
  assert.equal(source.state.dashboards.filter(d => Object.hasOwn(d.labels, OWNER)).length, 1);
  assert.equal(source.state.alertPolicies.filter(p => p.userLabels.managed_by === OWNER).length, 8);
  assert.ok(source.calls.every(c => c.method !== 'DELETE' && !c.url.includes('other-')));
});
test('ownership collisions, duplicate configuration and immutable metric drift fail before cloud writes', async () => {
  for (const bad of ['dashboard', 'policy', 'metric', 'duplicate', 'schema', 'inventory', 'channel']) {
    const source = transport(); await applyRouteMonitoring(bundle(), source.request); source.calls.length = 0;
    if (bad === 'dashboard') delete source.state.dashboards.at(-1).labels[OWNER];
    if (bad === 'policy') source.state.alertPolicies.at(-1).userLabels.policy_id = 'other';
    if (bad === 'metric') source.state.metrics.at(-1).description = 'unowned';
    if (bad === 'duplicate') source.state.dashboards.push(structuredClone(source.state.dashboards.at(-1)));
    if (bad === 'schema') source.state.metrics.at(-1).metricDescriptor.unit = 'ms';
    await assert.rejects(applyRouteMonitoring(bundle(), async (method, url, body) => {
      const result = await source.request(method, url, body);
      if (bad === 'inventory' && url.endsWith('/metrics')) return { metrics: [{}] };
      if (bad === 'channel' && url.endsWith('/notificationChannels/123')) return { type: 'email', enabled: false };
      return result;
    }));
    assert.ok(source.calls.every(c => c.method === 'GET'));
  }
});
test('paginated inventories retain ownership checks and repeated page tokens fail before writes', async () => {
  for (const duplicate of [false, true]) {
    const source = transport(); await applyRouteMonitoring(bundle(), source.request); source.calls.length = 0;
    const request = async (method, url, body) => {
      if (method === 'GET' && url.includes('/dashboards')) {
        const result = await source.request(method, url.split('?')[0], body);
        if (!url.includes('?')) return { dashboards: result.dashboards.slice(0, -1), nextPageToken: 'route / page' };
        assert.equal(new URL(url).searchParams.get('pageToken'), 'route / page');
        return { dashboards: duplicate ? [result.dashboards.at(-1), result.dashboards.at(-1)] : [result.dashboards.at(-1)] };
      }
      return source.request(method, url, body);
    };
    if (duplicate) {
      await assert.rejects(applyRouteMonitoring(bundle(), request), /Duplicate managed configuration/);
      assert.ok(source.calls.every(c => c.method === 'GET'));
    } else {
      await applyRouteMonitoring(bundle(), request);
      assert.equal(source.calls.filter(c => c.method === 'POST').length, 0);
    }
  }
  const source = transport();
  await assert.rejects(applyRouteMonitoring(bundle(), async (method, url, body) => {
    const result = await source.request(method, url.split('?')[0], body);
    return url.includes('/metrics') ? { ...result, nextPageToken: 'repeated' } : result;
  }), /Repeated inventory page token/);
  assert.ok(source.calls.every(c => c.method === 'GET'));
});
