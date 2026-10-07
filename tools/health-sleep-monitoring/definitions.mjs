import { validateTarget } from '../monitoring/target.mjs';
export const OWNER = 'qs-health-sleep-monitoring-v1';
export const metricType = key => `logging.googleapis.com/user/qs_health_sleep_${key}_v1`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/sleep-sync-operations.md#cloud-monitoring-830';
const groups = ['metric.label.provider', 'metric.label.workload'];
const workloads = [
  ['GarminAPI', 'sleep_sync'], ['SuuntoApp', 'sleep_sync'], ['COROSAPI', 'sleep_sync'], ['GarminAPI', 'garmin_health_backfill'],
];

export function buildHealthSleepMonitoring(project, channel) {
  validateTarget(project, channel);
  const metrics = [];
  const base = `resource.labels.project_id="${project}" jsonPayload.telemetryVersion=1 jsonPayload.provider=("GarminAPI" OR "SuuntoApp" OR "COROSAPI" OR "unknown") jsonPayload.workload=("sleep_sync" OR "garmin_health_backfill")`;
  const operational = 'jsonPayload.message="[HealthSleep]"';
  const summary = 'jsonPayload.message=("[SleepSyncTaskWorker] Invocation summary" OR "[GarminHealthBackfillTaskWorker] Invocation summary")';
  function metric(key, resource, selection, description, labels = ['provider', 'workload'], field) {
    metrics.push({ name: `qs_health_sleep_${key}_v1`, description: `[${OWNER}] ${description}`,
      filter: `${base} resource.type="${resource}" ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field?.endsWith('Ms') ? 'ms' : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: {
        bounds: field === 'durationMs' ? [0, 100, 1000, 10000, 60000, 300000, 540000, 1800000]
          : field === 'ageLowerBoundMs' ? [0, 60000, 1800000, 3600000, 21600000, 86400000] : [0, 1, 5, 10, 20],
      } } } : {}),
    });
  }
  metric('committed', 'cloud_run_revision', `${operational} jsonPayload.event="committed" jsonPayload.outcome=("completed" OR "skipped" OR "dead_lettered")`, 'Post-commit terminal transitions; backfill completion is request submission, NOT ingested history.', ['provider', 'workload', 'outcome']);
  metric('worker_attempts', 'cloud_run_revision', `${summary} jsonPayload.outcome=("processed" OR "deferred" OR "moved_to_dlq" OR "retry_incremented" OR "failed" OR "error" OR "missing" OR "already_failed" OR "deleted_for_cleanup" OR "stale_revision" OR "already_processed" OR "wrong_worker" OR "expected_contention")`, 'Existing ordinary worker summary and independent backfill summary; processed/HTTP ACK is not successful ingestion.', ['provider', 'workload', 'outcome']);
  metric('worker_latency', 'cloud_run_revision', `${summary} jsonPayload.durationMs>=0`, 'Whole invocation latency; backfill requests are deliberately paced.', ['provider', 'workload'], 'durationMs');
  metric('worker_failures', 'cloud_run_revision', `((${summary} jsonPayload.outcome=("failed" OR "error" OR "missing")) OR (${operational} jsonPayload.event="retry_transition" jsonPayload.outcome="retry"))`, 'Failed attempts and committed ordinary retry transitions; expected lease/refresh contention excluded.');
  metric('new_dead_letters', 'cloud_run_revision', `${operational} jsonPayload.event="committed" jsonPayload.outcome="dead_lettered"`, 'New committed permanent failures, not retained failed_jobs or repeated ACKs.');
  metric('dispatch_failures', 'cloud_function', `${operational} jsonPayload.event="dispatch_run" jsonPayload.outcome="failed"`, 'Unconfirmed/failed dispatch attempts and whole-run failures; not stale post-enqueue marker refusals.');
  metric('queue_samples', 'cloud_function', `${operational} jsonPayload.event=("queue_sample" OR "queue_sample_unavailable")`, 'Four observation heartbeats on the existing 30-minute scheduler, including idle/failed observations.');
  metric('sampled_due', 'cloud_function', `${operational} jsonPayload.event="queue_sample" jsonPayload.dueSample>=0`, 'Bounded actionable undispatched lower bound, excluding future work/retries/leases/lifecycle and intentional serialized backfill waits.', ['provider', 'workload'], 'dueSample');
  metric('sampled_age', 'cloud_function', `${operational} jsonPayload.event="queue_sample" jsonPayload.ageLowerBoundMs>=0`, 'Last-write delay lower bound, not oldest creation time or complete backlog age.', ['provider', 'workload'], 'ageLowerBoundMs');
  metric('overdue_samples', 'cloud_function', `${operational} jsonPayload.event="queue_sample" jsonPayload.dueSample>0 ((jsonPayload.workload="sleep_sync" jsonPayload.ageLowerBoundMs>=3600000) OR (jsonPayload.workload="garmin_health_backfill" jsonPayload.ageLowerBoundMs>=21600000))`, 'Live-ingestion observations at least one hour overdue, or eligible backfill at least six hours overdue while its native queue is empty.');
  metric('probe_failures', 'cloud_function', `${operational} (jsonPayload.event="queue_sample_unavailable" OR (jsonPayload.event="queue_sample" jsonPayload.unknownSample>0))`, 'Unknown/failed reads, not zero backlog; known sample saturation alone is not failure.');
  const sum = (period, fields = groups) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const filter = (key, resource = 'cloud_run_revision', extra = '') => `metric.type="${metricType(key)}" resource.type="${resource}" resource.labels.project_id="${project}" ${extra}`.trim();
  const native = (key, queue) => `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" ${queue ? `resource.labels.queue_id="${queue}"` : 'resource.labels.queue_id=("processSleepSyncTask" OR "processGarminHealthBackfillTask")'}`;
  function threshold(key, resource, count, period, workload) {
    return { displayName: `${key} ${workload}`, conditionThreshold: { filter: filter(key, resource, `metric.labels.workload="${workload}"`), aggregations: [sum(period)],
      comparison: 'COMPARISON_GT', thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } };
  }
  const policies = [];
  function policy(id, title, severity, conditions, instructions) {
    policies.push({ displayName: `QS Health & Sleep: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Health/Sleep] ${title}`,
        links: [{ displayName: 'Queue Monitor', url: 'https://quantified-self.io/admin/queues' },
          { displayName: 'Cloud dashboards', url: `https://console.cloud.google.com/monitoring/dashboards?project=${project}` },
          { displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` }],
        content: `${instructions}\n\n${runbook}\n\nInspect fixed provider/workload aggregates. Never publish UIDs, account/job IDs, callback URLs, tokens, Health/Sleep payloads or raw errors. Backfill request completion is not callback ingestion. Do not purge, replay or change concurrency to silence alerts. Thresholds are initial values to tune from actual volume.` },
    });
  }
  policy('backlog', 'Sustained undispatched work', 'ERROR', [threshold('overdue_samples', 'cloud_function', 2, '5400s', 'sleep_sync'), threshold('overdue_samples', 'cloud_function', 2, '14400s', 'garmin_health_backfill')], 'Ordinary ingestion: two eligible observations >=1h old in 90m. Backfill: two >=6h old observations in 4h, only while its native task queue is empty. One shared bounded sample is not global coverage.');
  policy('dispatch', 'Repeated dispatch failures', 'ERROR', [threshold('dispatch_failures', 'cloud_function', 3, '5400s', 'sleep_sync'), threshold('dispatch_failures', 'cloud_function', 3, '21600s', 'garmin_health_backfill')], 'Three failed/unconfirmed attempts. Unknown-provider ordinary failures can describe a scheduler/scan failure; inspect the original exception privately. Existing temporary #759 diagnostics are not required.');
  policy('processing', 'Repeated processing failures', 'ERROR', [threshold('worker_failures', 'cloud_run_revision', 10, '900s', 'sleep_sync'), threshold('worker_failures', 'cloud_run_revision', 3, '21600s', 'garmin_health_backfill')], 'Ten ordinary failures/retries in 15m, or three backfill failures/retries in 6h. Expected refresh/lease contention, stale revisions, skips and deferred acknowledgements are excluded.');
  policy('dead-letter', 'New permanent failures', 'WARNING', [threshold('new_dead_letters', 'cloud_run_revision', 3, '1800s', 'sleep_sync'), threshold('new_dead_letters', 'cloud_run_revision', 1, '21600s', 'garmin_health_backfill')], 'Three new ordinary DLQ commits in 30m or one new historical backfill failure in 6h. Retained failure totals and already-failed acknowledgements never trigger this signal.');
  policy('telemetry', 'Observations unavailable', 'WARNING', [threshold('probe_failures', 'cloud_function', 2, '5400s', 'sleep_sync'), threshold('probe_failures', 'cloud_function', 2, '5400s', 'garmin_health_backfill')], 'Two unknown/unavailable observations per provider/lane in 90m. Read failures and unknown metadata are not zero backlog.');
  policy('heartbeat', 'Required observation heartbeat missing', 'WARNING', workloads.map(([provider, workload]) => ({
    displayName: `${provider} ${workload} heartbeat absent`, conditionAbsent: { filter: filter('queue_samples', 'cloud_function', `metric.labels.provider="${provider}" metric.labels.workload="${workload}"`), aggregations: [sum('1800s')], duration: '7200s', trigger: { count: 1 } },
  })), 'Only operational observation loss is monitored, never lack of new Sleep or Health measurements. Idle queues still emit heartbeats. Absence detection requires an initial series; it does not prove first activation.');
  function chart(title, queryFilter, aggregation, unit = '1') {
    return { title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter: queryFilter, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } };
  }
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content: `Health/Sleep processing, NOT activity imports or Training delivery. Ordinary ingestion and paced, single-task Garmin history use separate task queues. HTTP ACK/processed is not success. Native HTTP attempts are diagnostic only: expected contention retries must not page. Terminal counts are post-commit observations, not an audit ledger. Backfill completed means requests submitted, NOT all callbacks ingested. The shared 20-row sample excludes future/retry/lifecycle/lease work and backfill waits while native tasks remain. Counts/ages are lower bounds; saturation can hide later work. Missing/unknown data is never zero. [Runbook](${runbook})` } },
    chart('Native queue depth — ordinary vs serialized backfill', native('depth'), { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['resource.label.queue_id'] }),
    chart('Native HTTP attempts — not ingestion success', native('task_attempt_count'), sum('900s', ['resource.label.queue_id', 'metric.label.response_code'])),
    chart('Native dispatch delay p95 — includes intentional backfill wait', native('task_attempt_delays'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['resource.label.queue_id'] }, 'ms'),
    chart('Committed terminal outcomes — backfill is request completion', filter('committed'), sum('900s', [...groups, 'metric.label.outcome'])),
    chart('Worker summaries — processed/ACK is not ingestion success', filter('worker_attempts'), sum('900s', [...groups, 'metric.label.outcome'])),
    chart('Whole-worker latency p95', filter('worker_latency'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: groups }, 'ms'),
    ...[['worker_failures', 'Failed attempts / committed retries'], ['new_dead_letters', 'Newly committed permanent failures'], ['dispatch_failures', 'Dispatch failures'], ['queue_samples', 'Observation heartbeats'], ['probe_failures', 'Unknown / failed observations']].map(([key, title]) => chart(title, filter(key, ['dispatch_failures', 'queue_samples', 'probe_failures'].includes(key) ? 'cloud_function' : 'cloud_run_revision'), sum('900s'))),
    ...[['sampled_due', 'Eligible undispatched sample — hourly mean/lower bound', '1'], ['sampled_age', 'Last-write delay lower bound — hourly mean', 'ms']].map(([key, title, unit]) => chart(title, filter(key, 'cloud_function'), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: groups }, unit)),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Health & Sleep', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
