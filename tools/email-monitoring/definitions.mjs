import { validateTarget } from '../monitoring/target.mjs';

export const OWNER = 'qs-email-monitoring-v1';
export const SERVICES = ['dispatchmarketingcampaigns', 'trackmarketingdelivery', 'changemarketingcampaignstatus'];
export const metricType = key => `logging.googleapis.com/user/qs_email_${key}_v1`;
const choices = values => `(${values.map(value => `"${value}"`).join(' OR ')})`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/email-lifecycle.md#cloud-monitoring-835';
const sources = ['transactional', 'marketing'];

export function buildEmailMonitoring(project, channel) {
  validateTarget(project, channel);
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2"`;
  const base = `${runtime} resource.labels.service_name=${choices(SERVICES)} jsonPayload.message="[EmailDelivery]" jsonPayload.telemetryVersion=1`;
  const state = 'resource.labels.service_name="trackmarketingdelivery" jsonPayload.event="state_observed"';
  const sample = `resource.labels.service_name="dispatchmarketingcampaigns" jsonPayload.source=${choices(sources)}`;
  const metrics = [];
  function metric(key, selection, description, labels = [], field) {
    metrics.push({ name: `qs_email_${key}_v1`, description: `[${OWNER}] ${description}`, filter: `${base} ${selection}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: field ? 'DISTRIBUTION' : 'INT64', unit: field?.endsWith('Ms') ? 'ms' : '1',
        labels: labels.map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
      labelExtractors: Object.fromEntries(labels.map(key => [key, `EXTRACT(jsonPayload.${key})`])),
      ...(field ? { valueExtractor: `EXTRACT(jsonPayload.${field})`, bucketOptions: { explicitBuckets: { bounds: field.endsWith('Ms')
        ? [0, 60000, 900000, 1800000, 3600000, 86400000] : [0, 1, 5, 10, 20, 25] } } } : {}) });
  }
  metric('states', `${state} jsonPayload.source=${choices(sources)} jsonPayload.state=${choices(['queued', 'pending', 'processing', 'retry', 'smtp_accepted', 'smtp_partial', 'error', 'unknown'])}`,
    'Supported mail state-update observations from the existing tracker. Processing means the extension claimed work; SMTP acceptance is not inbox delivery or reading. Notifications are at-least-once, not unique messages.', ['source', 'state']);
  metric('smtp_failures', `${state} jsonPayload.source=${choices(sources)} jsonPayload.state=("error" OR "smtp_partial")`, 'New observed ERROR or partially SMTP-accepted attempts; not retained history.', ['source']);
  metric('operations', 'jsonPayload.event="operation" jsonPayload.operation=("dispatch" OR "tracking") jsonPayload.outcome=("completed" OR "failed")', 'Dispatcher/tracker invocation outcomes, not successful mail delivery.', ['operation', 'outcome']);
  metric('operation_failures', 'jsonPayload.event="operation" jsonPayload.operation=("dispatch" OR "tracking") jsonPayload.outcome="failed"', 'Actual operation exceptions, not normal caps, schedules, suppression or idle work.', ['operation']);
  metric('submissions', 'jsonPayload.event="operation" jsonPayload.operation="dispatch" jsonPayload.outcome="completed" jsonPayload.submitted>=0', 'Messages submitted by a completed dispatcher run (at most 25); not SMTP success.', [], 'submitted');
  metric('samples', `${sample} jsonPayload.event=("outbox_sample" OR "outbox_sample_unavailable")`, 'Two quarter-hour operational heartbeats, including idle or unavailable observations.', ['source']);
  metric('sampled_due', `${sample} jsonPayload.event="outbox_sample" jsonPayload.dueSample>=0`, 'Eligible submitted-mail sample lower bound; not total backlog or pending campaign audience.', ['source'], 'dueSample');
  metric('sampled_age', `${sample} jsonPayload.event="outbox_sample" jsonPayload.ageLowerBoundMs>=0`, 'Lower-bound wait age, or delay after a processing lease expired.', ['source'], 'ageLowerBoundMs');
  metric('overdue_samples', `${sample} jsonPayload.event="outbox_sample" jsonPayload.dueSample>0 jsonPayload.ageLowerBoundMs>=900000`, 'Positive submitted-mail observations at least 15 minutes overdue. Future processing leases are excluded.', ['source']);
  metric('probe_failures', `${sample} (jsonPayload.event="outbox_sample_unavailable" OR (jsonPayload.event="outbox_sample" (jsonPayload.unknownSample>0 OR (jsonPayload.truncated=true NOT jsonPayload.dueSample:*))))`, 'Unavailable, unknown or capped observations that cannot establish a healthy zero.', ['source']);
  metric('sample_truncated', `${sample} jsonPayload.event="outbox_sample" jsonPayload.truncated=true`, 'Probe reached its bounded prefix; positive counts remain lower bounds.', ['source']);
  const extension = `resource.labels.project_id="${project}" ((resource.type="cloud_function" resource.labels.function_name="ext-firestore-send-email-processQueue") OR (resource.type="cloud_run_revision" resource.labels.service_name="ext-firestore-send-email-processqueue"))`;
  metrics.push({ name: 'qs_email_runtime_errors_v1', description: `[${OWNER}] Native ERROR logs from the exact installed extension or email runtime. Observations, not unique failed messages. No error text/recipient extraction.`,
    // Expected callable Auth/validation/approval failures are not runtime outages.
    filter: `severity>=ERROR ((${extension}) OR (${runtime} resource.labels.service_name=${choices(['dispatchmarketingcampaigns', 'trackmarketingdelivery'])}))`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: [] }, labelExtractors: {} });

  const filter = (key, extra = '', resourceType = 'cloud_run_revision') => `metric.type="${metricType(key)}" resource.type="${resourceType}" resource.labels.project_id="${project}" ${extra}`.trim();
  const sum = (period, fields = []) => ({ alignmentPeriod: period, perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: fields });
  const policies = [];
  function threshold(key, count, period, groups = [], extra = '', resourceType = 'cloud_run_revision') {
    return [{ displayName: `${key} ${resourceType}${extra ? ' scoped' : ''}`, conditionThreshold: { filter: filter(key, extra, resourceType), aggregations: [sum(period, groups)],
      comparison: 'COMPARISON_GT', thresholdValue: count - 1, duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } }];
  }
  function policy(id, title, severity, conditions, explanation) {
    policies.push({ displayName: `QS Email: ${title}`, userLabels: { managed_by: OWNER, policy_id: id }, enabled: true, severity, combiner: 'OR', conditions,
      notificationChannels: channel ? [channel] : [], alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: `[QS Email] ${title}`, links: [{ displayName: 'Logs Explorer', url: `https://console.cloud.google.com/logs/query?project=${project}` }],
        content: `${explanation}\n\n[Runbook](${runbook})\n\nSubmission != extension processing != SMTP acceptance != recipient reading. Native log/attempt counts are not unique recipients. Campaign caps, schedules, pauses, suppression and no-recipient work are not outbox stalls. No alert email depends on the monitored extension: reuse the direct Alerts channel. Never blindly resend, change delivery states or purge mail. Do not publish addresses, templates, campaigns, bodies, IDs, unsubscribe tokens, credentials or raw errors. Initial thresholds require tuning from measured volume.` } });
  }
  policy('outbox', 'Sustained submitted-mail stall', 'ERROR', threshold('overdue_samples', 3, '3600s', ['metric.label.source']), 'Three positive observations at least 15 minutes overdue in one hour. A bounded read of actual mail excludes live processing leases; zero is a sample, not historical coverage. New QS mail starts PENDING in its original write. Pausing a campaign does not pause submitted mail.');
  policy('smtp', 'Repeated SMTP or delivery errors', 'ERROR', threshold('smtp_failures', 3, '900s', ['metric.label.source']), 'Three new observed ERROR/partial-SUCCESS attempts per fixed source in 15 minutes. Inspect supported private extension states; success does not guarantee inbox delivery.');
  policy('runtime', 'Repeated extension or runtime errors', 'ERROR', [
    ...threshold('runtime_errors', 3, '900s'), ...threshold('runtime_errors', 3, '900s', [], '', 'cloud_function'),
  ], 'Three native ERROR log entries per runtime generation from the exact mail extension or email runtimes in 15 minutes, including failures before a supported state can be committed. Separate Gen 1/Gen 2 conditions keep monitored-resource types explicit. No free-text extraction.');
  policy('dispatch', 'Repeated marketing dispatcher failures', 'ERROR', threshold('operation_failures', 3, '900s', [], 'metric.labels.operation="dispatch"'), 'Three actual dispatcher exceptions in 15 minutes. A zero-submission completed invocation and ordinary daily/schedule/consent deferrals do not alert.');
  policy('tracking', 'Repeated state-tracking failures', 'WARNING', threshold('operation_failures', 3, '900s', ['metric.label.operation'], 'metric.labels.operation="tracking"'), 'Three failures of existing marketing delivery tracking in 15 minutes. The tracker is not an SMTP sender; no new observer or monitoring collection exists.');
  policy('telemetry', 'Outbox observations unavailable', 'WARNING', threshold('probe_failures', 2, '3600s', ['metric.label.source']), 'Two unknown/unavailable observations in one hour. Malformed metadata or saturation is not zero backlog. Inspect original mail state before considering replay. Legacy mail without any delivery state is outside the indexed sample; never initialize or resend retained mail just to monitor it.');
  policy('heartbeat', 'Required outbox heartbeat missing', 'WARNING', sources.map(source => ({ displayName: `${source} heartbeat absent`, conditionAbsent: {
    filter: filter('samples', `metric.labels.source="${source}"`), aggregations: [sum('900s', ['metric.label.source'])], duration: '3600s', trigger: { count: 1 },
  } })), 'No operational heartbeat for one hour. Both source groups emit when idle. Verify initial post-activation series; absence of new emails is not an outage.');

  const chart = (title, query, aggregation = sum('900s'), unit = '1') => ({ title, xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter: query, aggregation }, unitOverride: unit } }], yAxis: { label: unit, scale: 'LINEAR' } } });
  const widgets = [{ title: 'Meaning and safe response', text: { format: 'MARKDOWN', content: `Firestore mail outbox, not Cloud Tasks. SMTP acceptance is not inbox delivery or reading. New QS mail begins PENDING with queue timestamps in its original write; one masked, read-only sample of at most 20 active mails runs every 15 minutes on the existing dispatcher. No extra collection, Function, automatic resend or purge. [Runbook](${runbook})` } },
    chart('Observed mail states — not opens', filter('states'), sum('900s', ['metric.label.source', 'metric.label.state'])),
    chart('SMTP / partial acceptance errors', filter('smtp_failures'), sum('900s', ['metric.label.source'])),
    chart('Dispatcher / tracker invocations', filter('operations'), sum('900s', ['metric.label.operation', 'metric.label.outcome'])),
    chart('Dispatcher submissions — mean per completed run', filter('submissions'), { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: [] }),
    chart('Native Gen 2 extension / runtime errors', filter('runtime_errors')),
    chart('Native Gen 1 extension errors', filter('runtime_errors', '', 'cloud_function')),
    ...[['samples', 'Observation heartbeats'], ['probe_failures', 'Unknown / unavailable observations'], ['sample_truncated', 'Bounded observation saturation'], ['overdue_samples', 'Overdue submitted-mail observations']].map(([key, title]) => chart(title, filter(key), sum('3600s', ['metric.label.source']))),
    ...[['sampled_due', 'Eligible mail lower bound — hourly mean', '1'], ['sampled_age', 'Eligible delay lower bound — hourly mean', 'ms']].map(([key, title, unit]) => chart(title, filter(key), { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_MEAN', groupByFields: ['metric.label.source'] }, unit)),
    chart('Gen 2 email endpoint HTTP requests — not SMTP success', `metric.type="run.googleapis.com/request_count" ${runtime} resource.labels.service_name=one_of(${SERVICES.map(s => `"${s}"`).join(', ')})`, sum('900s', ['resource.label.service_name', 'metric.label.response_code_class'])),
    chart('Extension Gen 1 executions — not SMTP success', `metric.type="cloudfunctions.googleapis.com/function/execution_count" resource.type="cloud_function" resource.labels.project_id="${project}" resource.labels.function_name="ext-firestore-send-email-processQueue"`, sum('900s', ['metric.label.status'])),
    chart('Extension Gen 2 requests — if installed generation supports them', `metric.type="run.googleapis.com/request_count" resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.service_name="ext-firestore-send-email-processqueue"`, sum('900s', ['metric.label.response_code_class'])),
  ];
  return { project, metrics, policies, dashboard: { displayName: 'QS Email delivery', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, index) => index === 0 ? { xPos: 0, yPos: 0, width: 12, height: 3, widget }
      : { xPos: (index - 1) % 2 * 6, yPos: 3 + Math.floor((index - 1) / 2) * 4, width: 6, height: 4, widget }),
  } } };
}
