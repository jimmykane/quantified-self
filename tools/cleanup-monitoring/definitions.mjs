import { validateTarget } from '../monitoring/target.mjs';

export const OWNER = 'qs-cleanup-monitoring-v1';
export const metricType = key => `logging.googleapis.com/user/qs_cleanup_${key}_v1`;
export const PROVIDERS = ['GarminAPI', 'SuuntoApp', 'COROSAPI', 'WahooAPI', 'all'];
export const LANES = ['operational', 'subscription', 'explicit', 'health_projection', 'route_restore', 'queue_release', 'wahoo_release', 'scheduler'];
const choices = values => `(${values.map(v => `"${v}"`).join(' OR ')})`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/account-cleanup-monitoring.md';

export function buildCleanupMonitoring(project, channel) {
  validateTarget(project, channel);
  // The same lifecycle owner runs in Gen 1 disconnect/Auth endpoints and the
  // existing Gen 2 scheduler. No generic severity/raw-error matching.
  const resources = '(resource.type="cloud_function" resource.labels.region="europe-west2" OR resource.type="cloud_run_revision" resource.labels.location="europe-west2")';
  const base = `resource.labels.project_id="${project}" ${resources} jsonPayload.message="[CleanupHealth]" jsonPayload.telemetryVersion=1 jsonPayload.provider=${choices(PROVIDERS)} jsonPayload.flow=("account" OR "disconnect" OR "operational" OR "recovery") jsonPayload.lane=${choices(LANES)}`;
  const metrics = [];
  function metric(key, selection, description, labels = ['flow', 'provider', 'lane'], field) {
    metrics.push({ name: `qs_cleanup_${key}_v1`, description: `[${OWNER}] ${description}`, filter: `${base} ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field ? (field === 'ageMs' ? 'ms' : '1') : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: { bounds:
        field === 'ageMs' ? [0, 1800000, 7200000, 21600000, 86400000, 604800000] : [0, 1, 5, 10, 25, 50],
      } } } : {}),
    });
  }
  metric('outcomes', 'jsonPayload.event="outcome" jsonPayload.outcome=("started" OR "acknowledged" OR "completed" OR "partial" OR "retry" OR "deferred" OR "superseded" OR "failed" OR "remote_unconfirmed" OR "manual_review")',
    'Attempt/stage outcomes, not unique accounts. Completed is local scope only; Auth ACK does not prove extension/remote completion.', ['flow', 'provider', 'lane', 'outcome']);
  metric('failures', 'jsonPayload.event="outcome" jsonPayload.outcome=("failed" OR "partial" OR "retry")',
    'Actual exceptional attempts, partial local cleanup and committed retry failures. Expected deferrals, stale work and remote limitations excluded.');
  metric('remote_unconfirmed', 'jsonPayload.event="outcome" jsonPayload.outcome="remote_unconfirmed"',
    'Failed or unconfirmed partner revocation, including lost credentials. First observation alerts separately from repeated local failures; stage observations can overlap.');
  metric('manual_review', 'jsonPayload.event="outcome" jsonPayload.outcome="manual_review"', 'New committed exhausted-disconnect transitions; retained manual-review rows do not repeatedly page.');
  metric('overdue', 'jsonPayload.event="outcome" ((jsonPayload.flow="operational" jsonPayload.outcome="retry" jsonPayload.ageMs>=86400000) OR (jsonPayload.flow=("disconnect" OR "recovery") jsonPayload.outcome="retry" jsonPayload.ageMs>=21600000) OR (jsonPayload.flow="account" jsonPayload.outcome="failed" jsonPayload.ageMs>=86400000))',
    'Validated retained operational failure >=24h since cutoff, subscription retry >=6h overdue at processing, or failed Auth retry >=24h from event. Tombstones are never sampled.');
  metric('age', 'jsonPayload.event="outcome" jsonPayload.outcome=("retry" OR "failed") jsonPayload.ageMs>=0',
    'Observed failure age only; missing/invalid timing stays unavailable, not zero. No global pending-account inventory.', undefined, 'ageMs');
  metric('pages', 'jsonPayload.event="page" jsonPayload.capped=(true OR false)',
    'Existing bounded recovery pages, including idle. A capped page or advanced cursor is not complete queue coverage.', ['lane', 'provider', 'capped']);
  metric('examined', 'jsonPayload.event="page" jsonPayload.examined>=0', 'Rows in an existing recovery page, NOT eligible remaining backlog.', ['lane', 'provider'], 'examined');
  metric('heartbeat', 'jsonPayload.event="heartbeat" jsonPayload.lane="scheduler" jsonPayload.provider="all" jsonPayload.outcome=("acknowledged" OR "failed")',
    'Whole existing 30-minute scheduler outcome. Caught lane failures are separate; ACK never proves empty/fresh queues.', ['outcome']);

  const groups = ['metric.label.flow', 'metric.label.provider', 'metric.label.lane'];
  const sum = (period, fields = groups) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const filter = (key, resource, extra = '') => `metric.type="${metricType(key)}" resource.type="${resource}" resource.labels.project_id="${project}" ${extra}`.trim();
  function threshold(key, resource, extra, count, period) {
    return { displayName: `${key} ${resource}`, conditionThreshold: { filter: filter(key, resource, extra), aggregations: [sum(period)],
      comparison: 'COMPARISON_GT', thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } };
  }
  const policies = [];
  function policy(id, title, conditions, explanation, severity = 'WARNING') {
    policies.push({ displayName: `QS Cleanup: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Cleanup] ${title}`, content:
        `${explanation}\n\n[Runbook](${runbook})\n\nAccount Auth handler ACK is not proof of complete extension/remote cleanup. Remote unconfirmed includes revoked access: inspect privately, never force indefinite provider retries or claim remote deletion. Preserve tombstones, recursive deletion, source/account/lease/revision fences and existing schedules. No automatic remediation. Never delete accounts, disconnect providers, replay cleanup, purge state or change cloud resources without exact separate approval. No identities, credentials or raw errors in incident notes. Initial thresholds require volume-based tuning.` } });
  }
  const accountNative = `metric.type="cloudfunctions.googleapis.com/function/execution_count" resource.type="cloud_function" resource.labels.project_id="${project}" resource.labels.region="europe-west2" resource.labels.function_name="cleanupUserAccounts"`;
  const nativeAccountFailure = { displayName: 'Account handler native errors (includes abrupt termination)', conditionThreshold: {
    filter: `${accountNative} metric.labels.status!="ok"`, aggregations: [sum('3600s', [])],
    comparison: 'COMPARISON_GT', thresholdValue: 2, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE',
  } };
  policy('account', 'Repeated account cleanup failures', [threshold('failures', 'cloud_function', 'metric.labels.flow="account"', 3, '3600s'), nativeAccountFailure],
    'Three failed attempts or partial stages in one hour; counts are observations, not unique accounts. Retained completed tombstones have no signal.', 'ERROR');
  policy('disconnect', 'Repeated disconnect failures', ['cloud_function', 'cloud_run_revision'].map(resource => threshold('failures', resource, 'metric.labels.flow="disconnect"', 3, '86400s')),
    'Three actual failure/retry observations per provider/lane/runtime in 24 hours, allowing the existing 30-minute/2-hour/6-hour backoff to become observable. Normal future backoff and supersession do not page. Remote revocation has its own first-observation policy.');
  policy('remote', 'Partner disconnect revocation unconfirmed', ['cloud_function', 'cloud_run_revision'].map(resource => threshold('remote_unconfirmed', resource, '', 1, '3600s')),
    'One failed or unconfirmed partner revocation requires attention even when local cleanup succeeds or the last local token is already gone. The provider connection may remain active; this is not proof that it does. Covers Garmin, Suunto, COROS and Wahoo explicit disconnect, subscription enforcement, requested terminal-auth revocation and account deletion. Inspect private execution logs and provider connected-app status; if credentials are unavailable, use the provider-side revoke path rather than endlessly retrying or recreating credentials. A source failure and its returned cleanup stage may overlap; counts are observations, not distinct affected accounts.');
  const schedulerFailures = threshold('heartbeat', 'cloud_run_revision', 'metric.labels.outcome="failed"', 2, '5400s');
  schedulerFailures.conditionThreshold.aggregations = [sum('5400s', [])];
  policy('recovery', 'Repeated recovery failures', [threshold('failures', 'cloud_run_revision', 'metric.labels.flow=one_of("recovery","operational")', 3, '5400s'), schedulerFailures],
    'Three recovery exceptions or committed operational retries in 90 minutes. Deferred leases and stale generations are excluded.');
  policy('overdue', 'Persistently overdue cleanup', ['cloud_function', 'cloud_run_revision'].map(resource => threshold('overdue', resource, '', 2, '21600s')),
    'Two validated overdue failure observations in six hours. Operational age is original credential-removal cutoff; subscription age is overdue nextAttemptAt, not total episode age. Auth age is event retry age. No scan of completed tombstones or all accounts.');
  policy('manual', 'Disconnect retry exhausted', ['cloud_function', 'cloud_run_revision'].map(resource => threshold('manual_review', resource, '', 1, '3600s')),
    'A newly committed terminal manual-review transition requires operator review, not automatic replay; retained rows never increment this metric.');
  policy('heartbeat', 'Recovery scheduler heartbeat missing', [{ displayName: 'Existing recovery scheduler heartbeat absent', conditionAbsent: {
    filter: filter('heartbeat', 'cloud_run_revision'), aggregations: [sum('1800s', [])], duration: '7200s', trigger: { count: 1 },
  } }], 'Two hours without a natural scheduler heartbeat. Idle work emits heartbeats. Requires initial post-creation series; this alone cannot establish first activation or lane success.');
  const chart = (title, query, aggregation = sum('3600s'), unit = '1') => ({ title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: {
    timeSeriesFilter: { filter: query, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } });
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content:
    `Account cleanup, explicit/subscription disconnect and local recovery are distinct. Local completion is not remote deletion. The Auth ACK is not the Delete User Data extension's completion. Existing 30-minute recovery pages are reused: no additional Firestore reads, indexes, persistence or observer Function. Pages are bounded/cursor-based, not global backlog counts; no-work is not failed telemetry. No duplicate Training cleanup policy. [Runbook](${runbook})` } },
  ...['cloud_function', 'cloud_run_revision'].flatMap(resource => [
    chart(`${resource}: local outcomes / remote limitations`, filter('outcomes', resource), sum('3600s', [...groups, 'metric.label.outcome'])),
    chart(`${resource}: actual failures / retries`, filter('failures', resource)),
    chart(`${resource}: remote cleanup unconfirmed (not local failure)`, filter('remote_unconfirmed', resource)),
    chart(`${resource}: newly exhausted disconnect retries`, filter('manual_review', resource)),
    chart(`${resource}: overdue failure observations`, filter('overdue', resource)),
    chart(`${resource}: failure age p95 (not global backlog age)`, filter('age', resource), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: groups }, 'ms'),
  ]),
  chart('Existing recovery page coverage / caps', filter('pages', 'cloud_run_revision'), sum('3600s', ['metric.label.lane', 'metric.label.provider', 'metric.label.capped'])),
  chart('Existing page sizes / hourly mean (not remaining backlog)', filter('examined', 'cloud_run_revision'), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: ['metric.label.lane', 'metric.label.provider'] }),
  chart('Existing recovery scheduler outcomes', filter('heartbeat', 'cloud_run_revision'), sum('1800s', ['metric.label.outcome'])),
  chart('Account Auth handler native executions (not extension completion)', accountNative, sum('3600s', ['metric.label.status'])),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Account Cleanup & Disconnect Recovery', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, i) => i === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (i - 1) % 2 * 6, yPos: 3 + Math.floor((i - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
