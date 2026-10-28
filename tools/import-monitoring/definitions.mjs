import { validateTarget } from '../monitoring/target.mjs';
export const OWNER = 'qs-import-monitoring-v1';
export const metricType = key => `logging.googleapis.com/user/qs_import_${key}_v1`;
const providerSet = ['garmin', 'suunto', 'coros', 'wahoo'];
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/activity-import-monitoring.md';

export function buildImportMonitoring(project, channel) {
  validateTarget(project, channel);
  const metrics = [];
  const base = `resource.labels.project_id="${project}" jsonPayload.message="[ActivityImport]" jsonPayload.telemetryVersion=1 jsonPayload.provider=("garmin" OR "suunto" OR "coros" OR "wahoo")`;
  function metric(key, resource, selection, description, keys = ['provider'], field, bounds) {
    const distribution = field !== undefined;
    metrics.push({ name: `qs_import_${key}_v1`, description: `[${OWNER}] ${description}`,
      filter: `${base} resource.type="${resource}" ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: distribution ? 'DISTRIBUTION' : 'INT64',
        unit: field?.endsWith('Ms') ? 'ms' : '1', labels: keys.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(keys.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(distribution ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: { bounds } } } : {}),
    });
  }
  metric('committed', 'cloud_run_revision', 'jsonPayload.event="committed" jsonPayload.outcome=("imported" OR "skipped" OR "dead_lettered")', 'Durably committed queue outcomes, not HTTP acknowledgements or unique lifetime activities.', ['provider', 'outcome']);
  metric('new_dead_letters', 'cloud_run_revision', 'jsonPayload.event="committed" jsonPayload.outcome="dead_lettered"', 'Newly committed dead-letter transitions; never retained failed_jobs totals.');
  metric('worker_attempts', 'cloud_run_revision', 'jsonPayload.event="worker_attempt" jsonPayload.outcome=("acknowledged" OR "already_processed" OR "already_dead_lettered" OR "cleanup_removed" OR "stale" OR "deferred" OR "token_refresh_deferred" OR "dead_lettered" OR "retry" OR "failed")', 'Worker attempts; acknowledged is NOT successful import.', ['provider', 'outcome']);
  metric('processing_failures', 'cloud_run_revision', 'jsonPayload.event="worker_attempt" jsonPayload.outcome=("retry" OR "failed")', 'Retry/failure attempts; excludes expected token contention, skips, stale and cleanup acknowledgements.');
  metric('worker_latency', 'cloud_run_revision', 'jsonPayload.event="worker_attempt" jsonPayload.durationMs>=0', 'Worker attempt latency, not end-to-end ingestion delay.', ['provider'], 'durationMs', [0, 100, 1000, 10000, 60000, 120000, 300000, 540000]);
  metric('dispatch_failures', 'cloud_function', 'jsonPayload.event="dispatch_run" jsonPayload.outcome="failed"', 'Failed scheduled dispatch invocations, not individual task totals.');
  metric('queue_samples', 'cloud_function', 'jsonPayload.event=("queue_sample" OR "queue_sample_unavailable")', '30-minute observation heartbeat, including failed observations and idle queues.');
  metric('sampled_due', 'cloud_function', 'jsonPayload.event="queue_sample" jsonPayload.dueSample>=0', 'Eligible undispatched jobs in a bounded sample; lower bound, not total backlog.', ['provider'], 'dueSample', [0, 1, 5, 10, 20]);
  metric('sampled_age', 'cloud_function', 'jsonPayload.event="queue_sample" jsonPayload.ageLowerBoundMs>=0', 'Maximum last-write dispatch-delay lower bound within the bounded eligible sample.', ['provider'], 'ageLowerBoundMs', [0, 60000, 900000, 1800000, 3600000, 7200000, 86400000]);
  metric('overdue_samples', 'cloud_function', 'jsonPayload.event="queue_sample" jsonPayload.dueSample>0 jsonPayload.ageLowerBoundMs>=3600000', 'Samples with eligible undispatched work untouched for at least one hour.');
  metric('probe_failures', 'cloud_function', '(jsonPayload.event="queue_sample_unavailable" OR (jsonPayload.event="queue_sample" AND jsonPayload.unknownSample>0))', 'Failed or unknown observations; never zero backlog. A truncated known sample is not a failure.');

  const sum = (period, groups = ['metric.label.provider']) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: groups });
  const filter = (key, resource = 'cloud_run_revision', extra = '') => `metric.type="${metricType(key)}" resource.type="${resource}" resource.labels.project_id="${project}" ${extra}`.trim();
  const native = key => `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.queue_id="processWorkoutTask"`;
  function threshold(key, resource, value, period = '900s', extra = '') {
    return { displayName: key, conditionThreshold: { filter: filter(key, resource, extra), aggregations: [sum(period)],
      comparison: 'COMPARISON_GT', thresholdValue: value, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } };
  }
  const policies = [];
  function policy(id, title, severity, conditions, instruction) {
    policies.push({ displayName: `QS Activity Imports: ${title}`, userLabels: { managed_by: OWNER, policy_id: id },
      enabled: true, severity, combiner: 'OR', conditions, notificationChannels: channel ? [channel] : [],
      alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Imports] ${title}`,
        links: [{ displayName: 'Queue Monitor', url: 'https://quantified-self.io/admin/queues' },
          { displayName: 'Cloud dashboards', url: `https://console.cloud.google.com/monitoring/dashboards?project=${project}` },
          { displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` }],
        content: `${instruction}\n\n${runbook}\n\nInspect provider aggregates first. Never paste UIDs, queue IDs, signed URLs, tokens, payloads or raw error text into incident notes. HTTP 200 and alert recovery are not proof of import success. Thresholds are initial values to tune against observed traffic. Do not purge or replay queues to silence alerts.` } });
  }
  policy('backlog', 'Sustained undispatched work', 'ERROR', [threshold('overdue_samples', 'cloud_function', 1, '5400s')], 'At least two overdue observations for one provider in 90 minutes. Sampling is bounded and can miss later eligible work; consult Admin Queue Monitor. Already-dispatched tasks are observed separately by native metrics.');
  policy('dispatch', 'Repeated dispatch failures', 'ERROR', [threshold('dispatch_failures', 'cloud_function', 1, '5400s')], 'At least two failed scheduler invocations for one provider in 90 minutes. Check queue capacity/IAM and Function failures without changing retry policy.');
  policy('processing', 'Processing failure surge', 'ERROR', [threshold('processing_failures', 'cloud_run_revision', 9)], 'At least ten retry/failure attempts for one provider in 15 minutes. Distinguish transient downloads/parsing/persistence from expected lifecycle skips.');
  policy('dead-letter', 'New dead-letter surge', 'WARNING', [threshold('new_dead_letters', 'cloud_run_revision', 2, '1800s')], 'At least three new dead-letter moves for one provider in 30 minutes. Retained historical failed_jobs do not trigger this policy.');
  policy('http', 'Repeated task HTTP failures', 'WARNING', [{ displayName: 'At least twenty non-ok attempts / 15 minutes', conditionThreshold: {
    filter: `${native('task_attempt_count')} metric.labels.response_code!="ok"`, aggregations: [sum('900s', [])],
    comparison: 'COMPARISON_GT', thresholdValue: 19, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE',
  } }], 'Shared processWorkoutTask HTTP failures. Native response codes do not identify providers or import outcomes; correlate the fixed-label worker charts.');
  policy('telemetry', 'Observations unavailable', 'WARNING', [threshold('probe_failures', 'cloud_function', 1, '5400s'), ...providerSet.map(provider => ({
    displayName: `${provider} heartbeat absent for two hours`, conditionAbsent: { filter: filter('queue_samples', 'cloud_function', `metric.labels.provider="${provider}"`),
      duration: '7200s', aggregations: [sum('1800s')], trigger: { count: 1 } },
  }))], 'Check the existing 30-minute schedulers and field-masked Firestore probe. Missing observations are not empty queues. Absence detection needs an initial series and cannot prove initial activation.');

  function chart(title, key, { resource = 'cloud_run_revision', groups = ['metric.label.provider'], distribution = false, sample = false, nativeMetric = false, unit = '1' } = {}) {
    return { title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: {
      filter: nativeMetric ? native(key) : filter(key, resource), aggregation: sample ? { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: groups }
        : distribution ? { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: groups }
          : nativeMetric && key === 'depth' ? { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX' } : sum('900s', groups),
    }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } };
  }
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content: `Inbound recorded activities only; NOT Training delivery. The four existing 30-minute dispatchers sample at most twenty undispatched rows plus look-ahead. Eligible counts and last-write ages are lower bounds, not global totals. Unknown reads never become zero. Commit outcomes are distinct from acknowledgements; counters are best-effort operational observations, not an audit ledger. Native HTTP metrics are shared across providers. [Runbook](${runbook})` } },
    chart('Cloud Tasks depth (5-minute maximum)', 'depth', { nativeMetric: true, groups: [] }),
    chart('HTTP attempts / 15 minutes — NOT import success', 'task_attempt_count', { nativeMetric: true, groups: ['metric.label.response_code'] }),
    chart('Task dispatch delay p95', 'task_attempt_delays', { nativeMetric: true, distribution: true, groups: [], unit: 'ms' }),
    chart('Committed import / skip / dead-letter outcomes', 'committed', { groups: ['metric.label.provider', 'metric.label.outcome'] }),
    chart('Worker attempt outcomes — ACK is not import', 'worker_attempts', { groups: ['metric.label.provider', 'metric.label.outcome'] }),
    chart('Worker attempt latency p95', 'worker_latency', { distribution: true, unit: 'ms' }),
    chart('Processing retry/failure attempts', 'processing_failures'), chart('New dead-letter moves', 'new_dead_letters'),
    chart('Eligible undispatched sample (hourly mean, lower bound)', 'sampled_due', { resource: 'cloud_function', sample: true }),
    chart('Sample delay lower bound (hourly mean)', 'sampled_age', { resource: 'cloud_function', sample: true, unit: 'ms' }),
    chart('Failed dispatcher invocations', 'dispatch_failures', { resource: 'cloud_function' }),
    chart('Observation heartbeats', 'queue_samples', { resource: 'cloud_function' }), chart('Unknown / failed observations', 'probe_failures', { resource: 'cloud_function' }),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Activity Imports', labels: { [OWNER]: '' }, mosaicLayout: {
    columns: 12, tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
