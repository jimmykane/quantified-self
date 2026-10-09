import { validateTarget } from '../monitoring/target.mjs';

export const OWNER = 'qs-connection-history-monitoring-v1';
export const metricType = key => `logging.googleapis.com/user/qs_connection_history_${key}_v1`;
export const SERVICES = ['processconnectionhistorytask', 'onconnectionhistoryimportwritten', 'recoverconnectionhistoryimports', 'retryconnectionhistoryimport'];
const providers = ['garmin', 'suunto', 'coros', 'wahoo'];
const choices = values => `(${values.map(value => `"${value}"`).join(' OR ')})`;
const group = ['metric.label.provider'];
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/connection-history-import.md#coordinator-monitoring-847';

export function buildConnectionHistoryMonitoring(project, channel) {
  validateTarget(project, channel);
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2"`;
  const base = `${runtime} resource.labels.service_name=${choices(SERVICES)} jsonPayload.message="[ConnectionHistory]" jsonPayload.telemetryVersion=1 jsonPayload.provider=${choices([...providers, 'unknown'])}`;
  const worker = 'resource.labels.service_name="processconnectionhistorytask"';
  const probe = `resource.labels.service_name="recoverconnectionhistoryimports" jsonPayload.provider=${choices(providers)}`;
  const metrics = [];
  function metric(key, selection, description, labels = ['provider'], field) {
    metrics.push({ name: `qs_connection_history_${key}_v1`, description: `[${OWNER}] ${description}`, filter: `${base} ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field?.endsWith('Ms') ? 'ms' : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: { bounds:
        field === 'durationMs' ? [0, 100, 1000, 10000, 60000, 300000, 360000]
          : field === 'ageLowerBoundMs' ? [0, 60000, 900000, 1800000, 3600000, 86400000] : [0, 1, 5, 10, 20],
      } } } : {}),
    });
  }
  metric('checkpoints', `${worker} jsonPayload.event="checkpoint" jsonPayload.outcome=${choices(['active', 'requested', 'processed', 'skipped', 'failed', 'expected_contention'])}`, 'Committed coordinator checkpoints only. Requested is submission, processed includes observed child processing (may include skipped scopes); neither is complete coverage or watch receipt.', ['provider', 'outcome']);
  metric('worker_attempts', `${worker} jsonPayload.event="worker_attempt" jsonPayload.outcome=${choices(['acknowledged', 'failed', 'expected_contention'])}`, 'Whole task attempts; ACK includes no-op/stale revisions and is not ingestion success.', ['outcome']);
  metric('worker_latency', `${worker} jsonPayload.event="worker_attempt" jsonPayload.durationMs>=0`, 'Whole task latency including initial read/claim and checkpoint.', [], 'durationMs');
  metric('processing_failures', `${worker} ((jsonPayload.event="worker_attempt" jsonPayload.outcome="failed") OR jsonPayload.event="operation_retry")`, 'Unexpected task failures or committed operation retry-budget increases; excludes capacity, subdivision, permission/cooldown and lifecycle skips.');
  metric('dispatch_attempts', `resource.labels.service_name=${choices(['onconnectionhistoryimportwritten', 'recoverconnectionhistoryimports'])} jsonPayload.event="dispatch_attempt" jsonPayload.outcome=${choices(['accepted', 'failed'])}`, 'Enqueue accepted (including deterministic deduplication) or failed. Accepted is not worker ACK.', ['provider', 'outcome']);
  metric('dispatch_failures', `resource.labels.service_name=${choices(['onconnectionhistoryimportwritten', 'recoverconnectionhistoryimports'])} ((jsonPayload.event="dispatch_attempt" jsonPayload.outcome="failed") OR (jsonPayload.event="recovery_run" jsonPayload.outcome="failed"))`, 'Immediate enqueue/startup or recovery failures; a candidate and whole-run failure can overlap.');
  metric('recovery_runs', 'resource.labels.service_name="recoverconnectionhistoryimports" jsonPayload.event="recovery_run" jsonPayload.outcome=("completed" OR "failed")', 'Existing once-per-minute recovery invocation outcomes; not ingestion success.', ['outcome']);
  metric('failed_runs', `${worker} jsonPayload.event="checkpoint" jsonPayload.outcome="failed"`, 'New committed terminal failed runs, not retained failures or duplicate ACKs. Explicit owner retry can create another terminal episode.');
  metric('queue_samples', `${probe} jsonPayload.event=("queue_sample" OR "queue_sample_unavailable")`, 'Four observation heartbeats every 15 minutes on the existing scheduler, including idle and unavailable samples.');
  metric('sampled_due', `${probe} jsonPayload.event="queue_sample" jsonPayload.dueSample>=0`, 'Eligible due coordinator sample lower bound, never complete backlog.', ['provider'], 'dueSample');
  metric('sampled_age', `${probe} jsonPayload.event="queue_sample" jsonPayload.ageLowerBoundMs>=0`, 'Delay since a sampled revision became due; not lifetime age of a long history range.', ['provider'], 'ageLowerBoundMs');
  metric('overdue_samples', `${probe} jsonPayload.event="queue_sample" jsonPayload.dueSample>0 jsonPayload.ageLowerBoundMs>=900000`, 'Positive eligible sample at least 15 minutes overdue; excludes active leases, retry/child/capacity and lifecycle waits.');
  metric('probe_failures', `${probe} (jsonPayload.event="queue_sample_unavailable" OR (jsonPayload.event="queue_sample" (jsonPayload.unknownSample>0 OR (jsonPayload.truncated=true NOT jsonPayload.dueSample:*))))`, 'Unknown/unavailable observations or saturated prefixes without a proven eligible count; never healthy zero.');
  metric('sample_truncated', `${probe} jsonPayload.event="queue_sample" jsonPayload.truncated=true`, 'Global sample cap reached. Positive lower bounds remain useful, unseen providers are not claimed idle.');

  const filter = (key, extra = '') => `metric.type="${metricType(key)}" ${runtime} ${extra}`.trim();
  const sum = (period, fields = group) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const policies = [];
  function threshold(key, count, period) {
    return [{ displayName: key, conditionThreshold: { filter: filter(key), aggregations: [sum(period)], comparison: 'COMPARISON_GT',
      thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } }];
  }
  function policy(id, title, severity, conditions, instructions) {
    policies.push({ displayName: `QS Connection history: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Connection history] ${title}`,
        links: [{ displayName: 'Queue Monitor', url: 'https://quantified-self.io/admin/queues' }, { displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` }],
        content: `${instructions}\n\n${runbook}\n\nCoordinator only, not downstream ingestion or Training delivery. Request submission, worker ACK and committed ingestion differ. Counts are observations/episodes, not unique imports. Never blindly replay, purge, alter retries or publish owners, run IDs, accounts, credentials, payloads or raw provider errors. Thresholds are initial operational values to tune from measured volume.` },
    });
  }
  policy('backlog', 'Sustained eligible backlog', 'ERROR', threshold('overdue_samples', 3, '3600s'), 'Three positive eligible samples at least 15 minutes overdue per provider within one hour. Bounded lower bounds, not total backlog; normal retry/capacity waits are excluded.');
  policy('dispatch', 'Repeated dispatch or recovery failures', 'ERROR', threshold('dispatch_failures', 3, '900s'), 'Three immediate enqueue or recovery failures per provider in 15 minutes. Whole-run and candidate failures may overlap; accepted duplicates are not failures.');
  policy('processing', 'Repeated processing failures', 'ERROR', threshold('processing_failures', 10, '900s'), 'Ten unexpected failed attempts or committed real retries per provider in 15 minutes. Pre-read failures retain unknown provider. Expected waits, skips and stale ACKs do not count.');
  policy('terminal', 'New failed import runs', 'WARNING', threshold('failed_runs', 3, '1800s'), 'Three newly committed terminal failed run episodes per provider in 30 minutes. Retained failed history and already processed ACKs do not count.');
  policy('telemetry', 'Observations unavailable', 'WARNING', threshold('probe_failures', 2, '3600s'), 'Two unknown/unavailable samples per provider in one hour. A capped excluded prefix cannot prove zero backlog; investigate before changing capacity or replaying.');
  policy('heartbeat', 'Required observation heartbeat missing', 'WARNING', providers.map(provider => ({ displayName: `${provider} heartbeat absent`, conditionAbsent: {
    filter: filter('queue_samples', `metric.labels.provider="${provider}"`), aggregations: [sum('900s')], duration: '3600s', trigger: { count: 1 },
  } })), 'No operational sample for one hour. All four provider groups emit when idle. Absence needs an initial metric series after activation; verify each group, not just logs. No-new-imports is not an outage.');

  const native = key => `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.queue_id="processConnectionHistoryTask"`;
  const run = key => `metric.type="run.googleapis.com/${key}" ${runtime} resource.labels.service_name=one_of(${SERVICES.map(s => `"${s}"`).join(', ')})`;
  const chart = (title, queryFilter, aggregation, unit = '1') => ({ title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter: queryFilter, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } });
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content: `Connection-history coordinator only. Submission != worker ACK != committed ingestion. Native queue/runtime metrics include expected waits and are diagnostic. Read-only observations every 15 minutes inspect at most 20 due runs; saturation/unknown data is not healthy zero. [Runbook](${runbook})` } },
    chart('Native coordinator queue depth', native('depth'), { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX', groupByFields: [] }),
    chart('Native task HTTP attempts — not ingestion', native('task_attempt_count'), sum('900s', ['metric.label.response_code'])),
    chart('Native dispatch delay p95 — includes retry waits', native('task_attempt_delays'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: [] }, 'ms'),
    chart('Four Gen 2 endpoint requests — response classes', run('request_count'), sum('900s', ['resource.label.service_name', 'metric.label.response_code_class'])),
    chart('Four Gen 2 endpoint latency p95', run('request_latencies'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['resource.label.service_name'] }, 'ms'),
    chart('Committed checkpoints — requested vs processed vs failed', filter('checkpoints'), sum('900s', [...group, 'metric.label.outcome'])),
    chart('Whole-task ACKs / failures', filter('worker_attempts'), sum('900s', ['metric.label.outcome'])),
    chart('Whole-worker latency p95', filter('worker_latency'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: [] }, 'ms'),
    chart('Enqueue accepted / failed — not ACK', filter('dispatch_attempts'), sum('900s', [...group, 'metric.label.outcome'])),
    chart('Recovery outcomes — not ingestion', filter('recovery_runs'), sum('900s', ['metric.label.outcome'])),
    ...[['processing_failures', 'Actual processing failures'], ['dispatch_failures', 'Startup / recovery failures'], ['failed_runs', 'New terminal failed episodes'], ['queue_samples', 'Operational heartbeats'], ['probe_failures', 'Unknown / unavailable samples'], ['sample_truncated', 'Bounded sample saturation']].map(([key, title]) => chart(title, filter(key), sum('1800s'))),
    ...[['sampled_due', 'Eligible due lower bound — hourly mean', '1'], ['sampled_age', 'Due-revision delay lower bound — hourly mean', 'ms']].map(([key, title, unit]) => chart(title, filter(key), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: group }, unit)),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Connection history', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
