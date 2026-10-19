import { validateTarget } from '../monitoring/target.mjs';

export const OWNER = 'qs-reparse-monitoring-v1';
export const TIERS = ['normal', 'heavy', 'route'];
export const SERVICES = ['processsportslibreparsetask', 'processsportslibreparseheavytask', 'processsportslibroutereparsetask',
  'schedulesportslibreparsescan', 'schedulesportslibroutereparsescan'];
export const metricType = key => `logging.googleapis.com/user/qs_reparse_${key}_v1`;
const choices = values => `(${values.map(value => `"${value}"`).join(' OR ')})`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/reparse-monitoring.md';

export function buildReparseMonitoring(project, channel) {
  validateTarget(project, channel);
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2"`;
  const base = `${runtime} resource.labels.service_name=${choices(SERVICES)} jsonPayload.message="[Reparse]" jsonPayload.telemetryVersion=1 jsonPayload.tier=${choices(TIERS)}`;
  const worker = `resource.labels.service_name=${choices(SERVICES.slice(0, 3))}`;
  const scanner = `resource.labels.service_name=${choices(SERVICES.slice(3))}`;
  const metrics = [];
  function metric(key, selection, description, labels = ['tier'], field) {
    metrics.push({ name: `qs_reparse_${key}_v1`, description: `[${OWNER}] ${description}`, filter: `${base} ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field?.endsWith('Ms') ? 'ms' : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: { bounds:
        field === 'durationMs' ? [0, 100, 1000, 10000, 60000, 300000, 960000, 1800000]
          : field === 'ageLowerBoundMs' ? [0, 300000, 3600000, 14400000, 21600000, 86400000] : [0, 1, 5, 10],
      } } } : {}),
    });
  }
  metric('worker_attempts', `${worker} jsonPayload.event="worker_attempt" jsonPayload.outcome=("acknowledged" OR "failed" OR "rollout_wait")`,
    'Whole invocations; ACK includes no-ops, skips and terminal/manual review. Not successful reprocessing.', ['tier', 'outcome']);
  metric('worker_latency', `${worker} jsonPayload.event="worker_attempt" jsonPayload.durationMs>=0`, 'Whole invocation latency including reads and persistence.', ['tier'], 'durationMs');
  metric('job_commits', `${worker} jsonPayload.event="job_commit" jsonPayload.outcome=("completed" OR "skipped" OR "superseded")`,
    'Successful job writes observed after persistence; skips/supersession are not rewritten activities or routes.', ['tier', 'outcome']);
  metric('enqueue_attempts', 'jsonPayload.event="enqueue_attempt" jsonPayload.outcome=("queued" OR "deduplicated" OR "failed")',
    'Actual task admission results, including normal-to-heavy routing. Deduplication is not an enqueue exception.', ['tier', 'outcome']);
  metric('scan_attempts', `${scanner} jsonPayload.event="scan_attempt" jsonPayload.outcome=("acknowledged" OR "failed")`,
    'Existing discovery invocations; acknowledged includes intentionally disabled and idle scans.', ['tier', 'outcome']);
  metric('queue_samples', `${scanner} jsonPayload.event=("queue_sample" OR "queue_sample_unavailable")`, 'Existing scanners observe three tiers even with discovery disabled.');
  metric('stalled_samples', `${scanner} jsonPayload.event="queue_sample" jsonPayload.pendingSample>0 jsonPayload.stalled=true`,
    'Positive eligible outstanding sample with no recent same-target/tier completion: one hour normal/route, six hours heavy.');
  metric('sampled_pending', `${scanner} jsonPayload.event="queue_sample" jsonPayload.pendingSample>=0`,
    'Bounded eligible job lower bound, not native task depth or a complete campaign count.', ['tier'], 'pendingSample');
  metric('sampled_age', `${scanner} jsonPayload.event="queue_sample" jsonPayload.ageLowerBoundMs>=0`,
    'Age since last job write/enqueue, only after scheduling, retry and processing grace.', ['tier'], 'ageLowerBoundMs');
  metric('probe_failures', `${scanner} (jsonPayload.event="queue_sample_unavailable" OR (jsonPayload.event="queue_sample" (jsonPayload.unknownSample>0 OR (jsonPayload.truncated=true NOT jsonPayload.pendingSample:*))))`,
    'Unknown/unavailable or saturated observations without a proven positive lower bound. Never a healthy zero.');
  const filter = (key, extra = '') => `metric.type="${metricType(key)}" ${runtime} ${extra}`.trim();
  const sum = (period, fields = ['metric.label.tier']) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const policies = [];
  function policy(id, title, key, extra, count, period, severity, explanation) {
    policies.push({ displayName: `QS Reparse: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR',
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      conditions: [{ displayName: title, conditionThreshold: { filter: filter(key, extra), aggregations: [sum(period)], comparison: 'COMPARISON_GT',
        thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } }],
      documentation: { mimeType: 'text/markdown', subject: `[QS Reparse] ${title}`,
        links: [{ displayName: 'Queue Monitor', url: 'https://quantified-self.io/admin/queues' }],
        content: `${explanation}\n\n[Runbook](${runbook})\n\nACK is not a successful rewrite. No-progress requires positive eligible work, not missing telemetry. Heavy depth alone is not critical. Never replay, reparse, purge, enable a campaign or change worker limits without separate approval. Keep private IDs, source paths and raw errors out of incidents. Initial thresholds require volume-based tuning. #543 owns the heavy admission cap.` } });
  }
  policy('worker', 'Repeated normal or route failures', 'worker_attempts', 'metric.labels.outcome="failed" AND metric.labels.tier=one_of("normal","route")', 5, '1800s', 'ERROR', 'Five exceptional attempts in 30 minutes per tier. Terminal input/manual-review ACKs and runtime-behind waits are excluded.');
  policy('heavy_worker', 'Repeated serialized heavy failures', 'worker_attempts', 'metric.labels.outcome="failed" metric.labels.tier="heavy"', 3, '21600s', 'WARNING', 'Three exceptional heavy attempts in six hours; preserve single-concurrency and the existing manual-heavy workflow.');
  policy('stall', 'Normal or route batch not progressing', 'stalled_samples', 'metric.labels.tier=one_of("normal","route")', 3, '3600s', 'ERROR', 'Three positive observations in one hour, with no completion for the same target/tier for at least one hour. Future scheduling and native backoff/deadlines are excluded.');
  policy('heavy_stall', 'Heavy batch not progressing', 'stalled_samples', 'metric.labels.tier="heavy"', 3, '7200s', 'WARNING', 'Three positive observations in two hours, each with six hours of eligible job age and no recent same-target heavy completion. Intentional serialization/depth alone never pages.');
  policy('enqueue', 'Repeated task admission failures', 'enqueue_attempts', 'metric.labels.outcome="failed"', 3, '3600s', 'ERROR', 'Three actual enqueue exceptions per tier in one hour. Existing deterministic task names returning false do not count as exceptions.');
  policy('scanner', 'Repeated discovery exceptions', 'scan_attempts', 'metric.labels.outcome="failed"', 3, '3600s', 'ERROR', 'Three scanner exceptions in an hour. Idle or disabled discovery is not a failure.');
  policy('telemetry', 'Queue observations unavailable', 'probe_failures', '', 2, '3600s', 'WARNING', 'Two unavailable or unknown samples per tier in an hour. This is observation health, not failed parsing; inspect index readiness/caps before acting. No unconditional absence policy is enabled for inactive campaigns.');
  const chart = (title, query, aggregation = sum('900s'), unit = '1') => ({ title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: {
    timeSeriesFilter: { filter: query, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } });
  const widgets = [{ title: 'Meaning and response', text: { format: 'MARKDOWN', content: `Normal, serialized heavy and route reparses are separate. Existing ten-minute scanners sample at most ten oldest jobs per root collection plus one cap sentinel, with five-second deadlines. No new scheduler, processing writes, progress collection, provider calls or reparses. Samples are lower bounds; ACK != rewrite. Disabled discovery does not cancel already queued tasks. [Runbook](${runbook})` } },
    ...['processSportsLibReparseTask', 'processSportsLibReparseHeavyTask', 'processSportsLibRouteReparseTask'].flatMap(queue => {
      const native = key => `metric.type="cloudtasks.googleapis.com/queue/${key}" resource.type="cloud_tasks_queue" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.queue_id="${queue}"`;
      return [chart(`${queue}: native depth (diagnostic only)`, native('depth'), { alignmentPeriod: '300s', perSeriesAligner: 'ALIGN_MAX', crossSeriesReducer: 'REDUCE_MAX', groupByFields: [] }),
        chart(`${queue}: native HTTP attempts (not rewrites)`, native('task_attempt_count'), sum('900s', ['metric.label.response_code'])),
        chart(`${queue}: native dispatch delay p95`, native('task_attempt_delays'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: [] }, 'ms')];
    }),
    ...['worker_attempts', 'job_commits', 'enqueue_attempts', 'scan_attempts'].map(key => chart(key, filter(key), sum('900s', ['metric.label.tier', 'metric.label.outcome']))),
    chart('Whole invocation latency p95', filter('worker_latency'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_PERCENTILE_95', crossSeriesReducer: 'REDUCE_MAX', groupByFields: ['metric.label.tier'] }, 'ms'),
    ...['queue_samples', 'stalled_samples', 'probe_failures'].map(key => chart(key, filter(key), sum('3600s'))),
    ...[['sampled_pending', '1'], ['sampled_age', 'ms']].map(([key, unit]) => chart(`${key}: hourly mean of observations`, filter(key), {
      alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: ['metric.label.tier'] }, unit)),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Sports Lib Reprocessing', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
