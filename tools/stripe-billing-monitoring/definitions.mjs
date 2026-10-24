import { validateTarget } from '../monitoring/target.mjs';
export const OWNER = 'qs-stripe-billing-monitoring-v1';
export const SERVICES = ['stripebillingwebhook', 'createstripecheckoutsession', 'createstripeportallink', 'ext-firestore-stripe-payments-createportallink', 'processstripebillingtask', 'dispatchstripebillingjob', 'recoverstripebillingjobs', 'deletestripecustomerondocumentdeleted'];
export const EVENTS = ['accepted', 'processed', 'skipped', 'admission_failure', 'processing_failure', 'terminal_failure', 'checkout_failure', 'dispatch_failure', 'heartbeat', 'backlog_age', 'observation_unknown'];
export const metricType = key => `logging.googleapis.com/user/qs_stripe_billing_${key}_v1`;
const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/stripe-billing.md#monitoring';
export function buildStripeBillingMonitoring(project, channel) {
  validateTarget(project, channel);
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west3"`;
  const base = `${runtime} resource.labels.service_name=(${SERVICES.map(s => `"${s}"`).join(' OR ')}) jsonPayload.message="[StripeBilling]" jsonPayload.component="stripe_billing"`;
  const metrics = EVENTS.map(event => ({ name: `qs_stripe_billing_${event}_v1`, description: `[${OWNER}] ${event}; fixed billing observation without private labels. Accepted is durable ingress, processed is committed synchronization.`,
    filter: `${base} jsonPayload.event="${event}" jsonPayload.value>=0`,
    metricDescriptor: { metricKind: 'DELTA', valueType: event === 'backlog_age' ? 'DISTRIBUTION' : 'INT64', unit: event === 'backlog_age' ? 's' : '1', labels: [] }, labelExtractors: {},
    ...(event === 'backlog_age' ? { valueExtractor: 'EXTRACT(jsonPayload.value)', bucketOptions: { explicitBuckets: { bounds: [0, 60, 300, 900, 1800, 3600, 14400, 86400] } } } : {}) }));
  const filter = key => `metric.type="${metricType(key)}" ${runtime}`;
  const aggregation = { alignmentPeriod: '3600s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: [] };
  const policies = [];
  const policy = (id, title, condition, severity = 'ERROR') => policies.push({ displayName: `QS Stripe billing: ${title}`,
    enabled: true, severity, userLabels: { managed_by: OWNER, policy_id: id }, notificationChannels: channel ? [channel] : [], combiner: 'OR',
    alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] }, conditions: [{ displayName: title, ...condition }],
    documentation: { mimeType: 'text/markdown', content: `[Runbook](${runbook}). Enable only when native processing owns billing; verify initial heartbeat. Accepted webhook HTTP responses do not prove synchronization. Inspect safe failure codes and retained jobs; dry-run replay before any write. Do not print keys, payloads or customer identities. No automatic purge or replacement Stripe operation. Thresholds require tuning against observed volume.` } });
  for (const key of ['admission_failure', 'processing_failure', 'terminal_failure', 'checkout_failure', 'dispatch_failure', 'observation_unknown']) {
    policy(key, key.replaceAll('_', ' '), { conditionThreshold: { filter: filter(key), aggregations: [aggregation],
      comparison: 'COMPARISON_GT', thresholdValue: key === 'terminal_failure' ? 0 : 2, duration: '0s', trigger: { count: 1 } } }, key === 'observation_unknown' ? 'WARNING' : 'ERROR');
  }
  policy('backlog', 'Actionable backlog over one hour', { conditionThreshold: { filter: filter('backlog_age'), aggregations: [{ ...aggregation, perSeriesAligner: 'ALIGN_PERCENTILE_99', crossSeriesReducer: 'REDUCE_MAX' }],
    comparison: 'COMPARISON_GT', thresholdValue: 3600, duration: '0s', trigger: { count: 1 } } });
  policy('heartbeat', 'Native recovery heartbeat missing', { conditionAbsent: { filter: filter('heartbeat'), aggregations: [aggregation], duration: '7200s', trigger: { count: 1 } } }, 'WARNING');
  policy('runtime', 'Native billing HTTP failures', { conditionThreshold: {
    filter: `metric.type="run.googleapis.com/request_count" ${runtime} resource.labels.service_name=one_of(${SERVICES.filter(s => s !== 'processstripebillingtask').map(s => `"${s}"`).join(', ')}) metric.labels.response_code_class="5xx"`,
    aggregations: [{ ...aggregation, alignmentPeriod: '900s' }], comparison: 'COMPARISON_GT', thresholdValue: 2, duration: '0s', trigger: { count: 1 },
  } });
  const widgets = [{ title: 'Durable billing', text: { format: 'MARKDOWN', content: `Ingress acceptance and committed processing are separate. Expected contention, stale tasks, future retries and deletion skips do not increment failure counters. Backlog is a bounded lower-bound sample; capped/unavailable observations are unknown. [Runbook](${runbook})` } }, ...EVENTS.map(key => ({ title: key.replaceAll('_', ' '), xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter: filter(key), aggregation: key === 'backlog_age' ? { ...aggregation, perSeriesAligner: 'ALIGN_PERCENTILE_99', crossSeriesReducer: 'REDUCE_MAX' } : aggregation } } }], yAxis: { label: key === 'backlog_age' ? 'seconds' : 'observations', scale: 'LINEAR' } } }))];
  return { project, metrics, policies, dashboard: { displayName: 'QS Stripe billing', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12,
    tiles: widgets.map((widget, i) => ({ xPos: i % 2 * 6, yPos: Math.floor(i / 2) * 4, width: 6, height: 4, widget })) } } };
}
