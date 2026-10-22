import { validateTarget } from '../monitoring/target.mjs';

export const OWNER = 'qs-derived-metrics-monitoring-v1';
export const metricType = key => `logging.googleapis.com/user/qs_derived_metrics_${key}_v1`;
export const SERVICES = ['processderivedmetricsingresstask', 'processderivedmetricstask', 'observederivedmetricshealth',
  'ensurederivedmetrics', 'settrainingbuildbenchmark', 'mcpapi', 'assistantchat', 'onconnectionhistoryimportwritten'];
// Mirrors the lightweight canonical identities; the offline test rejects drift.
export const METRIC_KINDS = ['form', 'recovery_now', 'acwr', 'ramp_rate', 'monotony_strain', 'form_now', 'form_plus_7d',
  'easy_percent', 'hard_percent', 'efficiency_delta_4w', 'freshness_forecast', 'intensity_distribution', 'efficiency_trend',
  'training_summary', 'training_capacity', 'training_power_systems', 'power_curve', 'training_explanation', 'training_durability',
  'training_build_comparison', 'training_readiness', 'body_weight_trend', 'training_swim_performance'];
const states = ['queued', 'processing', 'failed'];
const choices = values => `(${values.map(value => `"${value}"`).join(' OR ')})`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/training-workspace.md#derived-metrics-cloud-monitoring-831';

export function buildDerivedMetricsMonitoring(project, channel) {
  validateTarget(project, channel);
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2"`;
  const base = `${runtime} resource.labels.service_name=${choices(SERVICES)} jsonPayload.message="[DerivedMetrics]" jsonPayload.telemetryVersion=1`;
  const kinds = `jsonPayload.metricKind=${choices([...METRIC_KINDS, 'unknown'])}`;
  const probe = `resource.labels.service_name="observederivedmetricshealth" jsonPayload.state=${choices(states)}`;
  const worker = `resource.labels.service_name=${choices(SERVICES.slice(0, 2))}`;
  const metrics = [];
  function metric(key, selection, description, labels = [], field) {
    metrics.push({ name: `qs_derived_metrics_${key}_v1`, description: `[${OWNER}] ${description}`, filter: `${base} ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field?.endsWith('Ms') ? 'ms' : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: { bounds:
        field === 'durationMs' ? [0, 100, 1000, 10000, 60000, 120000, 540000]
          : field === 'ageLowerBoundMs' ? [0, 60000, 900000, 1800000, 3600000, 14400000, 86400000] : [0, 1, 5, 10, 20],
      } } } : {}),
    });
  }
  metric('ingress', 'resource.labels.service_name="processderivedmetricsingresstask" jsonPayload.event="ingress" jsonPayload.outcome=("queued" OR "coalesced" OR "not_admitted" OR "invalid")',
    'Ingress dirty-work admission; not_admitted includes lifecycle skips and rejected enqueue attempts, distinguished by guarded enqueue-failure commits. Queued/coalesced is not snapshot publication.', ['outcome']);
  metric('worker_attempts', `${worker} jsonPayload.event="worker_attempt" jsonPayload.stage=("ingress" OR "calculation") jsonPayload.outcome=("acknowledged" OR "failed")`,
    'Invocation ACK includes stale, unchanged, superseded and deletion-fenced no-ops; not publication.', ['stage', 'outcome']);
  metric('worker_latency', `${worker} jsonPayload.event="worker_attempt" jsonPayload.stage=("ingress" OR "calculation") jsonPayload.durationMs>=0`,
    'Whole-task duration, including claim, sources and publication; not per-kind compute time.', ['stage'], 'durationMs');
  metric('snapshot_commits', `${kinds} jsonPayload.event="snapshot_commit" jsonPayload.outcome=("ready" OR "failed")`,
    'Claim/deletion-fenced snapshot writes observed after transaction commit. Ready can precede a follow-up generation.', ['metricKind', 'outcome']);
  metric('coordinator_commits', `${kinds} jsonPayload.event="coordinator_commit" jsonPayload.outcome=("settled" OR "requeued" OR "failed" OR "enqueue_failed")`,
    'Guarded coordinator commits: settled has no pending kinds at that commit; requeued is intentional follow-up, not failure.', ['metricKind', 'outcome']);
  metric('calculation_failures', `${kinds} jsonPayload.event="coordinator_commit" jsonPayload.outcome="failed"`,
    'Committed calculation failures by canonical kind, excluding stale claims and deletion-fenced writes. Not unique users or tasks.', ['metricKind']);
  metric('enqueue_failures', `${kinds} jsonPayload.event="coordinator_commit" jsonPayload.outcome="enqueue_failed"`,
    'Guarded enqueue-failure commits; deterministic task deduplication and late/superseded failure writes excluded.', ['metricKind']);
  metric('ingress_failures', 'resource.labels.service_name="processderivedmetricsingresstask" jsonPayload.event="worker_attempt" jsonPayload.stage="ingress" jsonPayload.outcome="failed"',
    'Actual ingress exceptions, not coalescing, unchanged inputs or lifecycle exclusions.');
  metric('queue_samples', `${probe} jsonPayload.event=("queue_sample" OR "queue_sample_unavailable")`,
    'Three quarter-hour state heartbeats, even when idle or unavailable.', ['state']);
  metric('sampled_pending', `${probe} jsonPayload.event="queue_sample" jsonPayload.pendingSample>=0`,
    'Bounded eligible pending-generation sample, not all accounts or stale snapshots.', ['state'], 'pendingSample');
  metric('sampled_age', `${probe} jsonPayload.event="queue_sample" jsonPayload.ageLowerBoundMs>=0`,
    'Eligible pending-generation requested/deadline or claim age; never last activity or last ready snapshot age.', ['state'], 'ageLowerBoundMs');
  metric('overdue_samples', `${probe} jsonPayload.event="queue_sample" jsonPayload.pendingSample>0 jsonPayload.ageLowerBoundMs>=1800000`,
    'Positive samples waiting at least 30 eligible minutes. Future build deadlines are excluded; failed coordinators wait out the four-hour retry grace.', ['state']);
  metric('probe_failures', `${probe} (jsonPayload.event="queue_sample_unavailable" OR (jsonPayload.event="queue_sample" (jsonPayload.unknownSample>0 OR (jsonPayload.truncated=true NOT jsonPayload.pendingSample:*))))`,
    'Unknown/unavailable or saturated prefixes without a proven positive lower bound; never healthy zero.', ['state']);
  metric('sample_truncated', `${probe} jsonPayload.event="queue_sample" jsonPayload.truncated=true`,
    'Shared twenty-coordinator sample saturated; later accounts can be unseen.', ['state']);

  const filter = (key, extra = '') => `metric.type="${metricType(key)}" ${runtime} ${extra}`.trim();
  const sum = (period, fields = []) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const policies = [];
  function threshold(key, count, period, groups = []) {
    return [{ displayName: key, conditionThreshold: { filter: filter(key), aggregations: [sum(period, groups)], comparison: 'COMPARISON_GT',
      thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } }];
  }
  function policy(id, title, severity, conditions, explanation) {
    policies.push({ displayName: `QS Derived metrics: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Derived metrics] ${title}`,
        links: [{ displayName: 'Queue Monitor', url: 'https://quantified-self.io/admin/queues' },
          { displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` }],
        content: `${explanation}\n\n[Runbook](${runbook})\n\nACK, guarded snapshot publication and coordinator settlement are different. Native queue emptiness does not prove fresh snapshots. Bounded observations are lower bounds. Never blindly rebuild, replay, purge, clear claims or alter retries. Preserve generation/publication and deletion fences. No UIDs, job IDs, payloads, athlete values, credentials or raw errors in incident text. Initial thresholds need tuning from measured volume.` } });
  }
  policy('backlog', 'Sustained pending generation', 'ERROR', threshold('overdue_samples', 3, '3600s', ['metric.label.state']),
    'Three positive eligible observations at least 30 minutes old in one hour. Queued/failed age starts at the later of requestedAtMs and a saved buildNotBeforeMs; active claims use startedAtMs. Future build deadlines are excluded. Failed work is excluded until four hours after its last failed write; intentional batching and native retry backoff are not stalls.');
  policy('calculation', 'Repeated committed calculation failures', 'ERROR', threshold('calculation_failures', 5, '1800s', ['metric.label.metricKind']),
    'Five guarded failure observations for one canonical kind in 30 minutes. Per-kind observations are not unique tasks; one multi-kind failure must not be summed into a global incident.');
  policy('enqueue', 'Repeated enqueue failures', 'ERROR', threshold('enqueue_failures', 3, '900s', ['metric.label.metricKind']),
    'Three guarded enqueue-failure observations for a canonical kind in 15 minutes. Superseded enqueue errors cannot mark a healthy replacement failed.');
  policy('ingress', 'Repeated ingress failures', 'ERROR', threshold('ingress_failures', 3, '900s'),
    'Three actual ingress exceptions in 15 minutes. Acknowledged coalescing, invalid tasks and lifecycle exclusions do not count.');
  policy('telemetry', 'Coordinator observations unavailable', 'WARNING', threshold('probe_failures', 2, '3600s', ['metric.label.state']),
    'Two unknown/unavailable observations in one hour. Saturation and malformed metadata are not a healthy zero; inspect the private coordinator without rebuilding.');
  policy('heartbeat', 'Required coordinator heartbeat missing', 'WARNING', states.map(state => ({ displayName: `${state} heartbeat absent`, conditionAbsent: {
    filter: filter('queue_samples', `metric.labels.state="${state}"`), aggregations: [sum('900s', ['metric.label.state'])], duration: '3600s', trigger: { count: 1 },
  } })), 'No operational observation for one hour. All three state groups emit while idle. Verify positive post-activation series before claiming absence coverage; an inactive athlete is not an outage.');

  const native = (queue, key) => `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.queue_id="${queue}"`;
  const chart = (title, queryFilter, aggregation = sum('900s'), unit = '1') => ({ title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter: queryFilter, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } });
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content: `Derived snapshots only, not provider delivery. Ingress admission != worker ACK != guarded ready snapshot != settled coordinator. One read-only quarter-hour job samples at most 20 active coordinators, with a five-second observation deadline. No source histories, payloads, queue writes or rebuilds. Idle athletes never create staleness incidents. [Runbook](${runbook})` } },
    ...['processDerivedMetricsIngressTask', 'processDerivedMetricsTask'].flatMap(queue => [
      chart(`${queue}: native depth`, native(queue, 'depth'), { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX', groupByFields: [] }),
      chart(`${queue}: native HTTP attempts — not publication`, native(queue, 'task_attempt_count'), sum('900s', ['metric.label.response_code'])),
      chart(`${queue}: native dispatch delay p95`, native(queue, 'task_attempt_delays'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: [] }, 'ms'),
    ]),
    chart('Ingress queued / coalesced / not admitted / invalid', filter('ingress'), sum('900s', ['metric.label.outcome'])),
    chart('Whole-task ACKs / exceptions — not publication', filter('worker_attempts'), sum('900s', ['metric.label.stage', 'metric.label.outcome'])),
    chart('Whole-task latency p95', filter('worker_latency'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['metric.label.stage'] }, 'ms'),
    ...[['snapshot_commits', 'Guarded ready / failed snapshots'], ['coordinator_commits', 'Settled / follow-up / failed coordinator commits']].map(([key, title]) => chart(title, filter(key), sum('900s', ['metric.label.metricKind', 'metric.label.outcome']))),
    ...[['calculation_failures', 'Committed calculation failures'], ['enqueue_failures', 'Committed enqueue failures']].map(([key, title]) => chart(title, filter(key), sum('1800s', ['metric.label.metricKind']))),
    chart('Ingress exceptions', filter('ingress_failures')),
    ...[['queue_samples', 'State observation heartbeats'], ['overdue_samples', 'Overdue pending-generation observations'], ['probe_failures', 'Unknown / unavailable observations'], ['sample_truncated', 'Bounded sample saturation']].map(([key, title]) => chart(title, filter(key), sum('3600s', ['metric.label.state']))),
    ...[['sampled_pending', 'Eligible pending lower bound — hourly mean', '1'], ['sampled_age', 'Pending-generation age lower bound — hourly mean', 'ms']].map(([key, title, unit]) => chart(title, filter(key), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: ['metric.label.state'] }, unit)),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Derived Metrics', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
