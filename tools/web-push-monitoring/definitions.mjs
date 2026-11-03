import { validateTarget } from '../monitoring/target.mjs';
export const OWNER = 'qs-web-push-monitoring-v1';
export function buildWebPushMonitoring(project, channel) {
  validateTarget(project, channel);
  const runtime = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2" resource.labels.service_name="sendtestpushnotification"`;
  const name = 'qs_web_push_outcomes_v1';
  const filter = `metric.type="logging.googleapis.com/user/${name}" ${runtime}`;
  const aggregate = { alignmentPeriod: '900s', perSeriesAligner: 'ALIGN_SUM', crossSeriesReducer: 'REDUCE_SUM', groupByFields: [] };
  const runbook = 'https://github.com/jimmykane/quantified-self/blob/develop/docs/web-push-notifications.md#monitoring';
  return { project, metrics: [{ name, description: `[${OWNER}] Explicit self-test outcomes. Acceptance is not display or reading. Expected permission, throttling, disabled configuration and expired registrations are not service failures.`,
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
}
