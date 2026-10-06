export const OWNER = 'qs-training-monitoring-v1';
const PREFIX = 'qs_training_';
const MARKER = `[${OWNER}]`;
const providers = 'jsonPayload.provider=("garmin" OR "coros" OR "wahoo" OR "suunto")';
const activeProviders = '(metric.labels.provider="garmin" OR metric.labels.provider="wahoo" OR metric.labels.provider="suunto")';
const labels = keys => keys.map(key => ({ key, valueType: 'STRING', description: `Bounded ${key} category` }));
export const metricType = key => `logging.googleapis.com/user/${PREFIX}${key}_v1`;

export function validateTarget(project, channel) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project || '')) throw new Error('Explicit valid project ID required.');
  if (channel !== undefined && !new RegExp(`^projects/${project}/notificationChannels/[0-9]+$`).test(channel)) {
    throw new Error('Select an existing notification channel in the same project.');
  }
}

export function buildTrainingMonitoring(project, channel) {
  validateTarget(project, channel);
  // All monitored Training workers are second-generation Functions.
  const base = `resource.labels.project_id="${project}" resource.type="cloud_run_revision"`;
  const delivery = `${base} jsonPayload.message="[TrainingDelivery]"`;
  const verification = `${base} jsonPayload.message="[TrainingVerification]"`;
  const health = `${delivery} jsonPayload.event="queue_health" jsonPayload.telemetryVersion=1`;
  const metrics = [];
  function metric(key, filter, description, keys = [], field, bounds) {
    const distribution = field !== undefined;
    const result = {
      name: `${PREFIX}${key}_v1`, description: `${MARKER} ${description}`, filter,
      metricDescriptor: { metricKind: 'DELTA', valueType: distribution ? 'DISTRIBUTION' : 'INT64',
        unit: distribution && field.endsWith('Ms') ? 'ms' : '1', labels: labels(keys) },
      labelExtractors: Object.fromEntries(keys.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
    };
    if (distribution) {
      result.valueExtractor = `EXTRACT(jsonPayload.${field})`;
      result.bucketOptions = { explicitBuckets: { bounds } };
    }
    metrics.push(result);
  }
  metric('delivery_outcomes', `${delivery} ${providers} jsonPayload.event=("accepted" OR "repair_accepted" OR "recovered_acceptance" OR "failure" OR "batch_accepted" OR "batch_failure")`,
    'Delivery attempt outcomes; COROS batch events count batches, not workouts.', ['provider', 'event']);
  metric('delivery_failures', `${delivery} ${providers} jsonPayload.event=("failure" OR "batch_failure") jsonPayload.category=("retryable" OR "auth" OR "permission" OR "provider_access" OR "terminal" OR "uncertain" OR "deferred")`,
    'Classified failures, including recoverable/user-action states.', ['provider', 'category']);
  const latencyBounds = [0, 100, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000];
  metric('delivery_latency', `${delivery} ${providers} jsonPayload.event=("accepted" OR "repair_accepted" OR "failure") jsonPayload.latencyMs>=0`,
    'Single-worker attempt latency; not end-to-end delivery, batching or device receipt.', ['provider'], 'latencyMs', latencyBounds);
  metric('retry_related_failures', `${delivery} ${providers} jsonPayload.event=("failure" OR "batch_failure") jsonPayload.category=("retryable" OR "uncertain")`,
    'Retry-related failure observations, not the count of scheduled retries.', ['provider']);
  metric('stale_suppressed', `${delivery} ${providers} jsonPayload.event="stale_suppressed"`,
    'Suppressed stale work; informational, not a delivery failure.', ['provider']);
  metric('verification_outcomes', `${verification} ${providers} jsonPayload.event=("checked" OR "check_deferred_or_failed")`,
    'Cloud-verification attempts; success need not establish watch receipt.', ['provider', 'event']);
  metric('verification_latency', `${verification} ${providers} jsonPayload.event=("checked" OR "check_deferred_or_failed") jsonPayload.latencyMs>=0`,
    'Cloud-verification attempt latency.', ['provider'], 'latencyMs', latencyBounds);
  metric('queue_samples', health, 'Minute queue-health heartbeat, including idle samples.');
  metric('queue_due', `${health} jsonPayload.dueJobs>=0`, 'Distribution of due-job samples, not cumulative workout counts.',
    [], 'dueJobs', [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000]);
  metric('queue_due_age', `${health} jsonPayload.dueAgeLowerBoundMs>=0`,
    'Lower-bound dispatch delay samples; zero markers use sampled creation time, not epoch.',
    [], 'dueAgeLowerBoundMs', [0, 60000, 300000, 600000, 900000, 1200000, 1800000, 3600000, 7200000, 86400000]);
  metric('queue_overdue_samples', `${health} jsonPayload.dueJobs>0 jsonPayload.dueAgeLowerBoundMs>=900000`,
    'Minute samples with due work demonstrably delayed at least 15 minutes.');
  metric('queue_probe_failures', `${delivery} jsonPayload.telemetryVersion=1 (jsonPayload.event="queue_health_unavailable" OR (jsonPayload.event="queue_health" AND jsonPayload.immediateAgeKnown=false))`,
    'Unavailable or incomplete queue observations; never interpreted as an empty queue.');
  metric('dispatch_failures', `${delivery} jsonPayload.event="dispatch_failure"`, 'Failed enqueue reservations.');
  // Firebase logger.error adds an Error stack to message; substring matching
  // preserves sweep_failed detection without extracting the stack into labels.
  metric('cleanup_failures', `${base} ((jsonPayload.message:"[TrainingCleanup]" AND jsonPayload.event="cleanup_retry_failed") OR (jsonPayload.message:"[TrainingWorkoutExpiry]" AND (jsonPayload.event=("sweep_failed" OR "checkpoint_release_failed" OR "backlog_check_failed") OR (NOT jsonPayload.event:* AND jsonPayload.failed>0))))`,
    'Cleanup failure observations; no double counting of cleanup per-job and summary logs.');

  const sum = (period = '600s', groups = []) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM',
    crossSeriesReducer: 'REDUCE_SUM', groupByFields: groups });
  // Metric alert conditions require an explicit resource type, not metric-only filters.
  const filter = (key, extra = '') => `metric.type="${metricType(key)}" resource.type="cloud_run_revision" resource.labels.project_id="${project}" ${extra}`.trim();
  function threshold(key, title, value, period = '600s', duration = '60s', extra = '') {
    return { displayName: title, conditionThreshold: { filter: filter(key, extra),
      aggregations: [sum(period)], comparison: 'COMPARISON_GT', thresholdValue: value, duration,
      trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } };
  }
  const policies = [];
  function policy(id, title, severity, conditions, instruction) {
    policies.push({ displayName: `QS Training: ${title}`, userLabels: { managed_by: OWNER, policy_id: id },
      enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [],
      alertStrategy: { autoClose: '1800s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Training] ${title}`,
        links: [
          { displayName: 'Training delivery queue', url: 'https://quantified-self.io/admin/queues/training-delivery' },
          { displayName: 'Cloud Monitoring dashboards', url: `https://console.cloud.google.com/monitoring/dashboards?project=${project}` },
          { displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` },
        ],
        content: `${instruction}\n\nOpen the Training delivery queue and QS Training Delivery dashboard using the links above. Inspect aggregate logs before individual records. Never paste credentials, UIDs or provider rejection bodies into incident notes. Cloud acceptance is not watch receipt. Recovery means this alert condition cleared, not proof of a completed workout.\n\nRunbook: https://github.com/jimmykane/quantified-self/blob/develop/docs/training-workspace.md#training-delivery-production-monitoring` } });
  }
  policy('backlog', 'Sustained dispatch backlog', 'ERROR', [
    threshold('queue_overdue_samples', 'At least four overdue samples per 5 minutes, sustained 10 minutes', 3, '300s', '600s'),
  ], 'Due work has a dispatch-delay lower bound of at least 15 minutes. Check dispatcher invocations, Cloud Tasks capacity and the due-job count. Future horizon work and provider receipt are not measured here.');
  policy('dispatch', 'Repeated dispatch failures', 'ERROR', [threshold('dispatch_failures', 'At least three failures in 10 minutes', 2)],
    'Check Cloud Tasks queue/IAM/dispatch reservation failures. Do not blindly resend or change provider entitlement.');
  policy('provider-failures', 'Provider failure surge', 'ERROR', [
    threshold('delivery_failures', 'At least ten delivery failures in 10 minutes', 9, '600s', '60s',
      `${activeProviders} (metric.labels.category="retryable" OR metric.labels.category="terminal" OR metric.labels.category="uncertain")`),
  ], 'Inspect provider/category charts and service status. Expected horizon deferrals and individual disconnected accounts are excluded. COROS is excluded while new sends remain Coming soon.');
  policy('permissions', 'Provider access or scope failures', 'WARNING', [
    threshold('delivery_failures', 'At least five permission/access failures in 10 minutes', 4, '600s', '60s',
      `${activeProviders} (metric.labels.category="permission" OR metric.labels.category="provider_access")`),
  ], 'Inspect bounded error categories and connection-repair instructions. Missing scopes, unsupported entitlement and API access cannot be repaired by repeated delivery retries.');
  policy('cleanup', 'Training cleanup failures', 'WARNING', [threshold('cleanup_failures', 'At least one cleanup failure in 10 minutes', 0)],
    'Inspect TrainingCleanup/TrainingWorkoutExpiry logs, checkpoint lease/backlog checks and the existing 15-minute cleanup/daily expiry invocations. Do not purge data to clear an incident.');
  policy('telemetry', 'Queue telemetry unavailable', 'WARNING', [
    threshold('queue_probe_failures', 'At least two incomplete/failed samples in 10 minutes', 1),
    { displayName: 'No queue-health sample for 30 minutes', conditionAbsent: {
      filter: filter('queue_samples'), duration: '1800s', aggregations: [sum('300s')], trigger: { count: 1 },
    } },
  ], 'Check the minute scheduler, Function execution errors and Firestore reads. An unavailable probe is not zero backlog. Absence detection needs an initial time series and cannot certify initial activation.');

  function chart(title, key, { unit = '1', distribution = false, sampleMean = false, native = false, groups = [], extra = '' } = {}) {
    return { title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: {
      timeSeriesFilter: { filter: native ? `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.queue_id="processTrainingDeliveryTask"` : filter(key, extra),
        aggregation: sampleMean ? { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_SUM',
          crossSeriesReducer: 'REDUCE_MEAN', groupByFields: groups }
          : distribution ? { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_PERCENTILE_95',
          crossSeriesReducer: 'REDUCE_MAX', groupByFields: groups } : native && key === 'depth'
          ? { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX' }
          : sum('600s', groups) }, unitOverride: unit,
    } }], yAxis: { label: unit, scale: 'LINEAR' } } };
  }
  const widgets = [
    { title: 'Meaning and response', text: { format: 'MARKDOWN', content:
      'Aggregate operational data only. Due jobs include delivery, verification and reconciliation. Queue charts show mean observations—not current workout totals. Delay is a lower bound, not watch receipt. Latency percentiles are approximate. Provider outcomes are attempts; COROS outcomes are batches. Email is sent by Cloud Monitoring through the selected existing channel. Thresholds are initial values to tune after observing traffic. [Runbook](https://github.com/jimmykane/quantified-self/blob/develop/docs/training-workspace.md#training-delivery-production-monitoring)' } },
    chart('Cloud Tasks dispatch depth (5-minute maximum)', 'depth', { native: true }),
    chart('Due jobs (mean of samples / 5 minutes)', 'queue_due', { sampleMean: true }),
    chart('Dispatch delay lower bound (mean of samples / 5 minutes)', 'queue_due_age', { sampleMean: true, unit: 'ms' }),
    chart('Delivery outcomes / 10 minutes', 'delivery_outcomes', { groups: ['metric.label.provider', 'metric.label.event'] }),
    chart('Delivery failures / 10 minutes', 'delivery_failures', { groups: ['metric.label.provider', 'metric.label.category'] }),
    chart('Worker-attempt latency (maximum service p95)', 'delivery_latency', { distribution: true, unit: 'ms', groups: ['metric.label.provider'] }),
    chart('Retry-related failures / 10 minutes', 'retry_related_failures', { groups: ['metric.label.provider'] }),
    chart('Stale jobs suppressed / 10 minutes', 'stale_suppressed', { groups: ['metric.label.provider'] }),
    chart('Verification outcomes / 10 minutes', 'verification_outcomes', { groups: ['metric.label.provider', 'metric.label.event'] }),
    chart('Verification latency (maximum service p95)', 'verification_latency', { distribution: true, unit: 'ms', groups: ['metric.label.provider'] }),
    chart('Queue-health samples / 10 minutes', 'queue_samples'),
    chart('Probe failures / 10 minutes', 'queue_probe_failures'),
    chart('Dispatch failures / 10 minutes', 'dispatch_failures'),
    chart('Cleanup failures / 10 minutes', 'cleanup_failures'),
    chart('Cloud Tasks HTTP attempts / 10 minutes (not provider acceptance)', 'task_attempt_count', { native: true, groups: ['metric.label.response_code'] }),
    chart('Cloud Tasks dispatch delay (maximum service p95)', 'task_attempt_delays', { native: true, distribution: true, unit: 'ms' }),
  ];
  const dashboard = { displayName: 'QS Training Delivery', labels: { managed_by: OWNER }, mosaicLayout: {
    columns: 12, tiles: widgets.map((widget, index) => index === 0
      ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } };
  return { project, metrics, dashboard, policies };
}
