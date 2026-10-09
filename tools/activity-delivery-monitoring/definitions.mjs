import { validateTarget } from '../monitoring/target.mjs';
export const OWNER = 'qs-activity-delivery-monitoring-v1';
export const metricType = key => `logging.googleapis.com/user/qs_activity_delivery_${key}_v1`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/activity-delivery-monitoring.md';
const flow = ['metric.label.source', 'metric.label.destination', 'metric.label.mode'];
const destinations = ['suunto', 'wahoo', 'coros'];
const outcomes = ['delivered', 'skipped', 'provider_pending', 'retry', 'expected_contention', 'dead_lettered', 'manual_reconciliation'];
const attempts = ['acknowledged', 'already_processed', 'already_failed', 'cleanup_removed', 'stale', 'deferred', 'provider_pending', 'manual_reconciliation', 'dead_lettered', 'retry', 'failed', 'expected_contention'];
const choices = values => `(${values.map(value => `"${value}"`).join(' OR ')})`;

export function buildActivityDeliveryMonitoring(project, channel) {
  validateTarget(project, channel);
  const metrics = [];
  const base = `resource.labels.project_id="${project}" jsonPayload.message="[ActivityDelivery]" jsonPayload.telemetryVersion=1 jsonPayload.source=${choices(['garmin', 'suunto', 'coros', 'wahoo', 'manualUpload', 'unknown', 'all'])} jsonPayload.destination=${choices([...destinations, 'unknown'])} jsonPayload.mode=${choices(['automatic', 'historical', 'unknown', 'all'])}`;
  function metric(key, resource, selection, description, labels = ['destination'], field) {
    metrics.push({ name: `qs_activity_delivery_${key}_v1`, description: `[${OWNER}] ${description}`,
      filter: `${base} resource.type="${resource}" ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field?.endsWith('Ms') ? 'ms' : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: {
        bounds: field === 'durationMs' ? [0, 100, 1000, 10000, 60000, 300000, 540000]
          : field === 'ageLowerBoundMs' ? [0, 60000, 1800000, 3600000, 7200000, 86400000] : [0, 1, 5, 10, 20],
      } } } : {}),
    });
  }
  metric('committed', 'cloud_run_revision', `jsonPayload.event="committed" jsonPayload.outcome=${choices(outcomes)}`, 'Post-commit transitions. Only delivered is final success; pending, retries, manual reconciliation and DLQ are distinct.', ['source', 'destination', 'mode', 'outcome']);
  metric('worker_attempts', 'cloud_run_revision', `jsonPayload.event="worker_attempt" jsonPayload.outcome=${choices(attempts)}`, 'Whole task attempt outcomes. Acknowledgement/HTTP success is not confirmed delivery.', ['source', 'destination', 'mode', 'outcome']);
  metric('worker_latency', 'cloud_run_revision', 'jsonPayload.event="worker_attempt" jsonPayload.durationMs>=0', 'Whole invocation latency including asynchronous status polls.', ['source', 'destination', 'mode'], 'durationMs');
  metric('worker_failures', 'cloud_run_revision', '((jsonPayload.event="worker_attempt" jsonPayload.outcome="failed") OR (jsonPayload.event="committed" jsonPayload.outcome="retry"))', 'Failed attempts or committed non-pending retries; recognized Suunto NEW/PROCESSING waits, normal pending polls, stale ACKs and lease/refresh contention excluded. Unknown status, transport errors and exhausted retries remain failures.');
  metric('new_dead_letters', 'cloud_run_revision', 'jsonPayload.event="committed" jsonPayload.outcome="dead_lettered"', 'New guarded DLQ commits only; not retained failed_jobs or repeated acknowledgements.');
  metric('new_reconciliation', 'cloud_run_revision', 'jsonPayload.event="committed" jsonPayload.outcome="manual_reconciliation"', 'New durable manual-reconciliation transitions only; can overlap with new dead letters, never replay uploads.');
  metric('dispatch_failures', 'cloud_function', 'jsonPayload.event="dispatch_run" jsonPayload.outcome="failed"', 'Whole-run and individual dispatch/deletion-guard read failures; deterministic task deduplication and stale marker refusals are not failures.');
  metric('queue_samples', 'cloud_function', 'jsonPayload.event=("queue_sample" OR "queue_sample_unavailable")', 'Three destination heartbeats on the existing 30-minute scheduler, even when idle or unavailable.');
  metric('sampled_due', 'cloud_function', 'jsonPayload.event="queue_sample" jsonPayload.dueSample>=0', 'Bounded eligible new-work and overdue lost-poll lower bound; not a complete backlog count.', ['destination'], 'dueSample');
  metric('sampled_age', 'cloud_function', 'jsonPayload.event="queue_sample" jsonPayload.ageLowerBoundMs>=0', 'Conservative last-write/due-time delay, not the age of the source recording.', ['destination'], 'ageLowerBoundMs');
  metric('overdue_samples', 'cloud_function', 'jsonPayload.event="queue_sample" jsonPayload.dueSample>0 jsonPayload.ageLowerBoundMs>=3600000', 'Eligible work >=1h old. Accepted Wahoo/COROS polls must also be >=2h past saved due time with no native tasks.');
  metric('probe_failures', 'cloud_function', '(jsonPayload.event="queue_sample_unavailable" OR (jsonPayload.event="queue_sample" jsonPayload.unknownSample>0))', 'Unknown/failed observations, not healthy zero. Sample saturation alone is diagnostic, not failure.');

  const sum = (period, fields = ['metric.label.destination']) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const filter = (key, resource = 'cloud_run_revision', extra = '') => `metric.type="${metricType(key)}" resource.type="${resource}" resource.labels.project_id="${project}" ${extra}`.trim();
  const native = key => `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.queue_id="processActivitySyncTask"`;
  function threshold(key, resource, count, period) {
    return { displayName: key, conditionThreshold: { filter: filter(key, resource), aggregations: [sum(period)], comparison: 'COMPARISON_GT',
      thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } };
  }
  const policies = [];
  function policy(id, title, severity, conditions, instructions) {
    policies.push({ displayName: `QS Activity Delivery: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Activity Delivery] ${title}`,
        links: [{ displayName: 'Queue Monitor', url: 'https://quantified-self.io/admin/queues' },
          { displayName: 'Cloud dashboards', url: `https://console.cloud.google.com/monitoring/dashboards?project=${project}` },
          { displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` }],
        content: `${instructions}\n\n${runbook}\n\nRecorded-activity delivery only, not Training workouts or inbound imports. Inspect aggregate source/destination/mode. Do not publish user/event/upload IDs, titles, original files, credentials, continuation URLs or raw errors. Never blindly resend, purge, change retries or clear a provider claim to silence an incident. Thresholds are initial values to tune against actual volume.` },
    });
  }
  policy('backlog', 'Sustained eligible work', 'ERROR', [threshold('overdue_samples', 'cloud_function', 2, '5400s')], 'Two >=1h-old eligible observations per destination in 90m. Future work, retry backoff and lifecycle waits are excluded. This shared twenty-row sample is a lower bound, not a global health guarantee.');
  policy('dispatch', 'Repeated dispatch failures', 'ERROR', [threshold('dispatch_failures', 'cloud_function', 3, '5400s')], 'Three dispatch/deletion-guard read failures in 90m. Deterministic task deduplication and stale marker refusals do not count. Correlate with native task transport and privately inspect original exceptions.');
  policy('processing', 'Repeated processing failures', 'ERROR', [threshold('worker_failures', 'cloud_run_revision', 10, '900s')], 'Ten failed attempts or actual retries per destination in 15m. Expected asynchronous polls, stale acknowledgements, lifecycle skips and contention do not count.');
  policy('dead-letter', 'New permanent failures', 'WARNING', [threshold('new_dead_letters', 'cloud_run_revision', 3, '1800s')], 'Three newly committed DLQ records per destination in 30m. These are not historical retained failure totals.');
  policy('reconciliation', 'New unresolved provider outcomes', 'WARNING', [threshold('new_reconciliation', 'cloud_run_revision', 3, '1800s')], 'Three newly durable manual-reconciliation markers per destination in 30m. Accepted or ambiguous external side effects remain protected. Inspect the retained job privately; this is NOT an automatic resend action.');
  policy('telemetry', 'Observations unavailable', 'WARNING', [threshold('probe_failures', 'cloud_function', 2, '5400s')], 'Two unknown/unavailable observations per destination in 90m. Missing observations are not zero backlog.');
  policy('heartbeat', 'Required observation heartbeat missing', 'WARNING', destinations.map(destination => ({ displayName: `${destination} heartbeat absent`,
    conditionAbsent: { filter: filter('queue_samples', 'cloud_function', `metric.labels.destination="${destination}"`), aggregations: [sum('1800s')], duration: '7200s', trigger: { count: 1 } },
  })), 'No operational observation for two hours. Idle destinations still report; lack of new athlete activity never pages. Absence requires initial series, so activation needs positive sample proof.');
  function chart(title, queryFilter, aggregation, unit = '1') {
    return { title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter: queryFilter, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } };
  }
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content: `Recorded-activity delivery to Suunto/Wahoo/COROS, NOT Training or inbound parsing. HTTP ACK is not final success. Pending provider processing, actual retries, newly unresolved outcomes and DLQ are separate. Manual reconciliation and DLQ may overlap. Native attempts include expected polls/contention; diagnostic only. The shared 20-row probe excludes normal backoff, future work and lifecycle waits. Counts/last-write ages are lower bounds, never complete backlog coverage. Unknown data is not zero. No automatic resends. [Runbook](${runbook})` } },
    chart('Native queue depth', native('depth'), { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['resource.label.queue_id'] }),
    chart('Native HTTP attempts — not delivery success', native('task_attempt_count'), sum('900s', ['metric.label.response_code'])),
    chart('Native dispatch delay p95', native('task_attempt_delays'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['resource.label.queue_id'] }, 'ms'),
    chart('Committed outcomes by source / destination / mode', filter('committed'), sum('900s', [...flow, 'metric.label.outcome'])),
    chart('Worker acknowledgements / pending / failures', filter('worker_attempts'), sum('900s', [...flow, 'metric.label.outcome'])),
    chart('Whole-worker latency p95', filter('worker_latency'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: flow }, 'ms'),
    ...[['worker_failures', 'Failed attempts / actual retries'], ['new_dead_letters', 'Newly committed permanent failures'], ['new_reconciliation', 'New unresolved provider outcomes'], ['dispatch_failures', 'Dispatch failures'], ['queue_samples', 'Observation heartbeats'], ['probe_failures', 'Unknown / unavailable observations']].map(([key, title]) => chart(title, filter(key, ['dispatch_failures', 'queue_samples', 'probe_failures'].includes(key) ? 'cloud_function' : 'cloud_run_revision'), sum('900s'))),
    ...[['sampled_due', 'Eligible due sample — hourly mean/lower bound', '1'], ['sampled_age', 'Last-write delay lower bound — hourly mean', 'ms']].map(([key, title, unit]) => chart(title, filter(key, 'cloud_function'), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: ['metric.label.destination'] }, unit)),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Activity Delivery', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
