import { validateTarget } from '../monitoring/target.mjs';

export const OWNER = 'qs-route-monitoring-v1';
export const metricType = key => `logging.googleapis.com/user/qs_route_${key}_v1`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/route-monitoring.md';
const groups = ['metric.label.lane', 'metric.label.destination'];
const flows = [...groups, 'metric.label.source', 'metric.label.mode'];
const destinations = ['garmin', 'wahoo', 'coros'];
const lanes = [['import', 'qs'], ...destinations.map(destination => ['delivery', destination])];
const choices = values => `(${values.map(value => `"${value}"`).join(' OR ')})`;
const gen1 = 'resource.type="cloud_function" resource.labels.region="europe-west2"';
const gen2 = 'resource.type="cloud_run_revision" resource.labels.location="europe-west2"';
const both = `((${gen1}) OR (${gen2}))`;

export function buildRouteMonitoring(project, channel) {
  validateTarget(project, channel);
  const metrics = [];
  const base = `resource.labels.project_id="${project}" jsonPayload.message="[RouteQueue]" jsonPayload.telemetryVersion=1`;
  const flow = `jsonPayload.source=${choices(['suunto', 'unknown'])} jsonPayload.mode=${choices(['automatic', 'manual', 'unknown'])} ((jsonPayload.lane="import" jsonPayload.destination=${choices(['qs', 'unknown'])}) OR (jsonPayload.lane="delivery" jsonPayload.destination=${choices([...destinations, 'unknown'])}))`;
  const sample = `jsonPayload.source="suunto" ((jsonPayload.lane="import" jsonPayload.destination="qs") OR (jsonPayload.lane="delivery" jsonPayload.destination=${choices(destinations)}))`;
  const probe = `${gen1} resource.labels.function_name="dispatchRouteDeliverySyncQueue" ${sample}`;
  const workers = `${gen2} resource.labels.service_name=${choices(['processroutesynctask', 'processroutedeliverysynctask'])} ${flow}`;
  function metric(key, selection, description, labels = ['lane', 'destination'], field) {
    metrics.push({ name: `qs_route_${key}_v1`, description: `[${OWNER}] ${description}`,
      filter: `${base} ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field?.endsWith('Ms') ? 'ms' : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: {
        bounds: field === 'durationMs' ? [0, 100, 1000, 10000, 60000, 300000, 540000]
          : field === 'ageLowerBoundMs' ? [0, 60000, 1800000, 3600000, 7200000, 86400000] : [0, 1, 5, 10, 20],
      } } } : {}),
    });
  }
  metric('committed', `${workers} jsonPayload.event="committed" jsonPayload.outcome=${choices(['success', 'skipped', 'retry', 'expected_contention', 'dead_lettered', 'manual_reconciliation'])}`, 'Worker post-commit transitions. Only success is confirmed import/delivery; ACK is not success.', ['lane', 'source', 'destination', 'mode', 'outcome']);
  metric('worker_attempts', `${workers} jsonPayload.event="worker_attempt" jsonPayload.outcome=${choices(['acknowledged', 'already_processed', 'already_failed', 'cleanup_removed', 'deferred', 'manual_reconciliation', 'dead_lettered', 'retry', 'failed', 'expected_contention'])}`, 'Whole task attempt outcomes, including payload/read failures; an ACK is not successful persistence or provider delivery.', ['lane', 'source', 'destination', 'mode', 'outcome']);
  metric('worker_latency', `${workers} jsonPayload.event="worker_attempt" jsonPayload.durationMs>=0`, 'Whole route task latency, including unpacking and initial reads.', ['lane', 'source', 'destination', 'mode'], 'durationMs');
  // Retry attempt labels can also follow recognized contention. The guarded commit
  // classification, not HTTP failure or the generic retry attempt, selects real retries.
  metric('worker_failures', `${workers} ((jsonPayload.event="worker_attempt" jsonPayload.outcome="failed") OR (jsonPayload.event="committed" jsonPayload.outcome="retry"))`, 'Failed attempts or committed non-contention retries. Skips, deferrals, expected contention and ordinary ACKs excluded.');
  metric('new_dead_letters', `${workers} jsonPayload.event="committed" jsonPayload.outcome="dead_lettered"`, 'New committed DLQ transitions only; not retained failed_jobs or already-failed ACKs.');
  metric('new_reconciliation', `${workers} jsonPayload.event="committed" jsonPayload.outcome="manual_reconciliation"`, 'New durable replay blockers only; can overlap with DLQ, never authorize a resend.');
  metric('dispatch_failures', `${both} ${flow} (jsonPayload.event="dispatch_failure" OR (jsonPayload.event="dispatch_run" jsonPayload.outcome="failed"))`, 'Actual immediate/reconciliation guard, enqueue, marker, cleanup or whole-run failures across Gen 1 and Gen 2. Deduplicated tasks and successful lifecycle exclusions are not failures.');
  metric('dispatch_runs', `${gen1} resource.labels.function_name="dispatchRouteDeliverySyncQueue" ${flow} jsonPayload.event="dispatch_run" jsonPayload.outcome=${choices(['completed', 'failed'])}`, 'Scheduled reconciliation outcome; completed is not provider success and may include failed candidates.', ['lane', 'outcome']);
  metric('queue_samples', `${probe} jsonPayload.event=${choices(['queue_sample', 'queue_sample_unavailable'])}`, 'Four operational heartbeats on the existing 30-minute dispatcher, including idle and unavailable observations.');
  metric('sampled_due', `${probe} jsonPayload.event="queue_sample" jsonPayload.dueSample>=0`, 'Eligible fresh-undispatched sample lower bound, never complete backlog.', ['lane', 'destination'], 'dueSample');
  metric('sampled_age', `${probe} jsonPayload.event="queue_sample" jsonPayload.ageLowerBoundMs>=0`, 'Conservative last-write/creation delay lower bound, never complete oldest backlog age.', ['lane', 'destination'], 'ageLowerBoundMs');
  metric('overdue_samples', `${probe} jsonPayload.event="queue_sample" jsonPayload.dueSample>0 jsonPayload.ageLowerBoundMs>=3600000`, 'Positive eligible observations at least one hour old; future/retry/lease/lifecycle/provider-claim work is excluded by the probe.');
  metric('probe_failures', `${probe} (jsonPayload.event="queue_sample_unavailable" OR (jsonPayload.event="queue_sample" (jsonPayload.unknownSample>0 OR (jsonPayload.truncated=true NOT jsonPayload.dueSample:*))))`, 'Unavailable or unknown observations, including truncated samples with no proven eligible count. Never healthy zero; positive known saturation alone is not failure.');
  metric('sample_truncated', `${probe} jsonPayload.event="queue_sample" jsonPayload.truncated=true`, 'Bounded sample saturation, diagnostic only; later work may not have been inspected.');
  const cleanup = `${gen2} resource.labels.service_name=${choices(['cleanuprejectedrouteoriginalfile', 'redriverejectedrouteoriginalcleanup'])} jsonPayload.lane="cleanup" jsonPayload.event="original_cleanup" jsonPayload.phase=${choices(['validate', 'route_read', 'storage_delete', 'intent_delete', 'backoff'])}`;
  metric('original_cleanup', `${cleanup} jsonPayload.outcome=${choices(['deleted', 'stale_discarded', 'malformed_discarded', 'failed', 'backoff_failed'])}`, 'Original cleanup outcomes by fixed phase; discarding stale/malformed intent is not failure.', ['phase', 'outcome']);
  metric('cleanup_failures', `${cleanup} jsonPayload.outcome=${choices(['failed', 'backoff_failed'])}`, 'Failed original cleanup or failed backoff persistence; both phases can describe one cleanup attempt.', ['phase']);

  const sum = (period, fields = groups) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const filter = (key, resource = 'cloud_run_revision', extra = '') => `metric.type="${metricType(key)}" resource.type="${resource}" resource.labels.project_id="${project}" ${extra}`.trim();
  const native = key => `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.queue_id=one_of("processRouteSyncTask", "processRouteDeliverySyncTask")`;
  function threshold(key, resource, count, period, fields = groups) {
    return { displayName: `${key} ${resource}`, conditionThreshold: { filter: filter(key, resource), aggregations: [sum(period, fields)], comparison: 'COMPARISON_GT',
      thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } };
  }
  const policies = [];
  function policy(id, title, severity, conditions, instructions) {
    policies.push({ displayName: `QS Routes: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Routes] ${title}`,
        links: [{ displayName: 'Queue Monitor', url: 'https://quantified-self.io/admin/queues' },
          { displayName: 'Cloud dashboards', url: `https://console.cloud.google.com/monitoring/dashboards?project=${project}` },
          { displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` }],
        content: `${instructions}\n\n${runbook}\n\nRoute import and outbound saved-route copies only, not activities or Training workouts. Inspect fixed lane/destination/phase aggregates. Never publish UIDs, account/route/job IDs, names, geometry, original paths, tokens, provider bodies or raw errors. Do not blindly replay, purge, clear provider claims or change retries to silence alerts. Counts are observations, not unique route totals; permanent/manual-review and failure phases can overlap. Thresholds are initial values to tune from measured volume.` },
    });
  }
  policy('backlog', 'Sustained eligible work', 'ERROR', [threshold('overdue_samples', 'cloud_function', 2, '5400s')], 'Two positive eligible samples at least one hour old per lane/destination in 90m. This is bounded undispatched work, not native task retries or complete backlog.');
  policy('dispatch', 'Repeated dispatch failures', 'ERROR', ['cloud_function', 'cloud_run_revision'].map(resource => threshold('dispatch_failures', resource, 3, '5400s')), 'Three actual failures per lane/destination and runtime generation in 90m. Both Gen 1 webhooks/dispatcher and Gen 2 immediate enqueues are covered. Whole-run failures retain unknown destination; duplicates/skips do not count.');
  policy('processing', 'Repeated processing failures', 'ERROR', [threshold('worker_failures', 'cloud_run_revision', 10, '900s')], 'Ten failed-attempt or actual retry observations per lane/destination in 15m. Expected contention, lifecycle skips, deferrals and HTTP ACKs do not count. A generic retry attempt alone is not sufficient.');
  policy('dead-letter', 'New permanent failures', 'WARNING', [threshold('new_dead_letters', 'cloud_run_revision', 3, '1800s')], 'Three new committed DLQ transitions per lane/destination in 30m, not historical failure totals or repeated failed-job ACKs.');
  policy('reconciliation', 'New unresolved provider outcomes', 'WARNING', [threshold('new_reconciliation', 'cloud_run_revision', 3, '1800s')], 'Three newly durable replay blockers per lane/destination in 30m. Accepted or ambiguous side effects stay protected. Inspect private retained evidence; this is not permission to resend.');
  policy('cleanup', 'Repeated original cleanup failures', 'WARNING', [threshold('cleanup_failures', 'cloud_run_revision', 3, '1800s', [])], 'Three failure-phase observations in 30m across rejected-original cleanup and redrive. Backoff-write failure may overlap the original failure. Stale/malformed intent discards are expected and excluded. Inspect the fixed-phase diagnostic chart; do not delete an original to silence this policy.');
  policy('telemetry', 'Observations unavailable', 'WARNING', [threshold('probe_failures', 'cloud_function', 2, '5400s')], 'Two unavailable/unknown samples per lane/destination in 90m, including saturation with no proven eligible count. Missing evidence is not zero backlog. Positive known saturation remains diagnostic.');
  policy('heartbeat', 'Required observation heartbeat missing', 'WARNING', lanes.map(([lane, destination]) => ({ displayName: `${lane} ${destination} heartbeat absent`,
    conditionAbsent: { filter: filter('queue_samples', 'cloud_function', `metric.labels.lane="${lane}" metric.labels.destination="${destination}"`), aggregations: [sum('1800s')], duration: '7200s', trigger: { count: 1 } },
  })), 'No operational sample for two hours. All four fixed groups emit even when idle. This never pages merely for no new routes. Absence requires an initial series after activation; verify every group, not just raw logs.');

  function chart(title, queryFilter, aggregation, unit = '1') {
    return { title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter: queryFilter, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } };
  }
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content: `Suunto route import and outbound saved-route copies to Garmin/Wahoo/COROS, NOT activity or Training delivery. HTTP ACK is not committed success. Native depth/delay includes expected retries and is diagnostic. Four bounded samples on the existing 30-minute scheduler report even when idle; counts and last-write ages are lower bounds. Missing/unknown/saturated data is not healthy zero. DLQ and manual review can overlap; never blindly resend. [Runbook](${runbook})` } },
    chart('Native queue depth — import vs delivery', native('depth'), { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['resource.label.queue_id'] }),
    chart('Native HTTP attempts — not committed success', native('task_attempt_count'), sum('900s', ['resource.label.queue_id', 'metric.label.response_code'])),
    chart('Native dispatch delay p95 — includes normal retry waits', native('task_attempt_delays'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['resource.label.queue_id'] }, 'ms'),
    chart('Worker committed outcomes by lane / destination / mode', filter('committed'), sum('900s', [...flows, 'metric.label.outcome'])),
    chart('Whole-task acknowledgements / retries / failures', filter('worker_attempts'), sum('900s', [...flows, 'metric.label.outcome'])),
    chart('Whole-worker latency p95', filter('worker_latency'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: flows }, 'ms'),
    ...[['worker_failures', 'Failed attempts / actual retries'], ['new_dead_letters', 'Newly committed permanent failures'], ['new_reconciliation', 'New unresolved provider outcomes']].map(([key, title]) => chart(title, filter(key), sum('900s'))),
    ...['cloud_function', 'cloud_run_revision'].map(resource => chart(`Dispatch failures — ${resource === 'cloud_function' ? 'Gen 1' : 'Gen 2'}`, filter('dispatch_failures', resource), sum('900s'))),
    chart('Scheduled reconciliation — not provider success', filter('dispatch_runs', 'cloud_function'), sum('1800s', ['metric.label.lane', 'metric.label.outcome'])),
    ...[['queue_samples', 'Operational observation heartbeats'], ['probe_failures', 'Unknown / unavailable observations'], ['sample_truncated', 'Sample saturation — diagnostic only']].map(([key, title]) => chart(title, filter(key, 'cloud_function'), sum('1800s'))),
    // Distribution means preserve idle zeroes; histogram percentile interpolation
    // can turn a zero observation into an apparent positive backlog.
    ...[['sampled_due', 'Eligible due sample — hourly mean / lower-bound observations', '1'], ['sampled_age', 'Last-write delay lower bound — hourly mean', 'ms']].map(([key, title, unit]) => chart(title, filter(key, 'cloud_function'), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: groups }, unit)),
    chart('Original cleanup outcomes / phases', filter('original_cleanup'), sum('1800s', ['metric.label.phase', 'metric.label.outcome'])),
    chart('Original cleanup failure phases — may overlap', filter('cleanup_failures'), sum('1800s', ['metric.label.phase'])),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Routes', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
