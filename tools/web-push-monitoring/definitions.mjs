import { validateTarget } from '../monitoring/target.mjs';
export const OWNER = 'qs-web-push-monitoring-v1';
export function buildWebPushMonitoring(project, channel) {
  validateTarget(project, channel);
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.service_name="sendtestpushnotification"`;
  const name = 'qs_web_push_outcomes_v1';
  const filter = `metric.type="logging.googleapis.com/user/${name}" ${runtime}`;
  const aggregate = { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: [] };
  const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/web-push-notifications.md#monitoring';
  const bundle = { project, metrics: [{ name, description: `[${OWNER}] Explicit self-test outcomes. Acceptance is not display or reading. Expected permission, throttling, disabled configuration and expired registrations are not service failures.`,
    filter: `${runtime} jsonPayload.message="[WebPush]" jsonPayload.telemetryVersion=1 jsonPayload.outcome=("accepted" OR "expired" OR "failed")`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: [{ key: 'outcome', valueType: 'STRING', description: 'Fixed accepted, expired or failed category' }] },
    labelExtractors: { outcome: 'EXTRACT(jsonPayload.outcome)' } }],
    policies: [{ displayName: 'QS Web Push: Repeated self-test sender failures', userLabels: { managed_by: OWNER, policy_id: 'sender' },
      enabled: true, severity: 'WARNING', combiner: 'OR', notificationChannels: channel ? [channel] : [],
      conditions: [{ displayName: 'Three genuine sender failures in 15 minutes', conditionThreshold: {
        filter: `${filter} metric.labels.outcome="failed"`, aggregations: [aggregate], comparison: 'COMPARISON_GT', thresholdValue: 2,
        duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } }],
      alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
      documentation: { mimeType: 'text/markdown', subject: '[QS Web Push] Repeated sender failures',
        content: `Inspect configuration, key pairing and fixed sender outcomes. Never paste endpoints, keys, payloads or raw provider errors into tickets. Acceptance does not prove display. This is user-requested traffic; idle or absent telemetry is expected and does not page. There is no background queue, backlog, dead letter or scheduler. Do not resend automatically. [Runbook](${runbook})` } }],
    dashboard: { displayName: 'QS Web Push self-tests', labels: { [OWNER]: '' }, mosaicLayout: { columns: 12, tiles: [
      { width: 12, height: 4, widget: { title: 'Self-test outcomes — acceptance is not display', xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter,
        aggregation: { ...aggregate, groupByFields: ['metric.label.outcome'] } }, unitOverride: '1' } }], yAxis: { label: 'Outcomes', scale: 'LINEAR' } } } },
      { yPos: 4, width: 12, height: 4, widget: { title: 'Native sender requests', xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: {
        filter: `metric.type="run.googleapis.com/request_count" ${runtime}`, aggregation: aggregate }, unitOverride: '1' } }], yAxis: { label: 'Requests', scale: 'LINEAR' } } } },
    ] } } };
  const historyRuntime = runtime.replace('sendtestpushnotification', 'sendhistoryimportnotification');
  const historyName = 'qs_history_import_push_outcomes_v1';
  const historyFilter = `metric.type="logging.googleapis.com/user/${historyName}" ${historyRuntime}`;
  bundle.metrics.push({ name: historyName,
    description: `[${OWNER}] Explicit history-import completion attempts. Acceptance is not display; cancelled, expired and limited are expected lifecycle outcomes.`,
    filter: `${historyRuntime} jsonPayload.message="[HistoryImportPush]" jsonPayload.telemetryVersion=1 jsonPayload.outcome=("accepted" OR "expired" OR "failed" OR "cancelled" OR "limited")`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: [{ key: 'outcome', valueType: 'STRING', description: 'Fixed accepted, expired, failed, cancelled or limited category' }] },
    labelExtractors: { outcome: 'EXTRACT(jsonPayload.outcome)' } });
  const failureCondition = (displayName, failureFilter) => ({ displayName, conditionThreshold: {
    filter: failureFilter, aggregations: [aggregate], comparison: 'COMPARISON_GT', thresholdValue: 2,
    duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } });
  bundle.policies.push({ displayName: 'QS Web Push: Repeated history-import sender failures',
    userLabels: { managed_by: OWNER, policy_id: 'history-sender' }, enabled: true, severity: 'WARNING', combiner: 'OR',
    notificationChannels: channel ? [channel] : [],
    conditions: [failureCondition('Three history sender failures in 15 minutes', `${historyFilter} metric.labels.outcome="failed"`),
      failureCondition('Three history sender runtime failures in 15 minutes', `metric.type="run.googleapis.com/request_count" ${historyRuntime} metric.labels.response_code_class="5xx"`)],
    alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
    documentation: { mimeType: 'text/markdown', subject: '[QS Web Push] History-import sender failures',
      content: `Check both operational switches, key pairing, runtime permissions and fixed outcomes. Native 5xx covers crashes before outcome logging. Idle traffic, disabled configuration, contention, revocation, deletion, disconnects, rate caps and expired registrations must not page. Imports retain their existing coordinator monitoring. This trigger has no scheduler, notification outbox or dead-letter queue. Claims are intentionally not replayed after ambiguous sends or crashes. Never clear receipts or blindly resend; never paste endpoints, credentials, identifiers or raw errors into tickets. [Runbook](${runbook})` } });
  bundle.dashboard.displayName = 'QS Web Push';
  bundle.dashboard.mosaicLayout.tiles.push(
    { yPos: 8, width: 12, height: 4, widget: { title: 'History-import outcomes — attempts, not display', xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: {
      filter: historyFilter, aggregation: { ...aggregate, groupByFields: ['metric.label.outcome'] } }, unitOverride: '1' } }], yAxis: { label: 'Outcomes', scale: 'LINEAR' } } } },
    { yPos: 12, width: 12, height: 4, widget: { title: 'History-import sender native requests', xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: {
      filter: `metric.type="run.googleapis.com/request_count" ${historyRuntime}`, aggregation: { ...aggregate, groupByFields: ['metric.label.response_code_class'] } }, unitOverride: '1' } }], yAxis: { label: 'Requests', scale: 'LINEAR' } } } },
  );
  return bundle;
}
