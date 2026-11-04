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
  const activityRuntime = runtime.replace('sendtestpushnotification', 'sendactivitysyncnotifications');
  const activityName = 'qs_activity_sync_push_outcomes_v1';
  const heartbeatName = 'qs_activity_sync_push_sweeps_v1';
  const overdueName = 'qs_activity_sync_push_overdue_v1';
  const activityBase = `resource.type=("cloud_run_revision" OR "cloud_function") resource.labels.project_id="${project}"`;
  const activityFilter = `metric.type="logging.googleapis.com/user/${activityName}" resource.type="cloud_run_revision" resource.labels.project_id="${project}"`;
  const legacyActivityFilter = activityFilter.replace('resource.type="cloud_run_revision"', 'resource.type="cloud_function"');
  const heartbeatFilter = `metric.type="logging.googleapis.com/user/${heartbeatName}" ${activityRuntime}`;
  const overdueFilter = `metric.type="logging.googleapis.com/user/${overdueName}" ${activityRuntime}`;
  bundle.metrics.push({ name: activityName,
    description: `[${OWNER}] New-activity notification attempts and admission/preparation failures, including Gen 1 legacy import workers. Accepted is transport acceptance, never display.`,
    filter: `${activityBase} jsonPayload.message="[ActivitySyncPush]" jsonPayload.telemetryVersion=1 jsonPayload.phase=("admission" OR "send" OR "sweep") jsonPayload.outcome=("accepted" OR "expired" OR "failed" OR "cancelled" OR "limited")`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: ['outcome', 'phase'].map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
    labelExtractors: { outcome: 'EXTRACT(jsonPayload.outcome)', phase: 'EXTRACT(jsonPayload.phase)' } });
  for (const [metricName, extra, description] of [
    [heartbeatName, '', 'Completed minute sweeps, including disabled and idle operation. Failures do not emit healthy heartbeats.'],
    [overdueName, ' jsonPayload.oldestDueAgeSeconds>=180', 'Positive bounded oldest-due observation after the sweep, at least three minutes overdue. Future grouping waits are excluded.'],
  ]) bundle.metrics.push({ name: metricName, description: `[${OWNER}] ${description}`,
    filter: `${activityRuntime} jsonPayload.message="[ActivitySyncPushSweep]" jsonPayload.telemetryVersion=1 jsonPayload.oldestDueAgeSeconds>=0${extra}`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: [] } });
  bundle.policies.push({ displayName: 'QS Web Push: Activity-sync sender health',
    userLabels: { managed_by: OWNER, policy_id: 'activity-sender' }, enabled: true, severity: 'WARNING', combiner: 'OR',
    notificationChannels: channel ? [channel] : [],
    conditions: [failureCondition('Repeated activity admission or sender failures', `${activityFilter} metric.labels.outcome="failed"`),
      failureCondition('Repeated legacy activity admission failures', `${legacyActivityFilter} metric.labels.outcome="failed"`),
      failureCondition('Repeated activity sender runtime failures', `metric.type="run.googleapis.com/request_count" ${activityRuntime} metric.labels.response_code_class="5xx"`),
      { displayName: 'Two overdue observations in five minutes', conditionThreshold: { filter: overdueFilter,
        aggregations: [{ ...aggregate, alignmentPeriod: '300s' }], comparison: 'COMPARISON_GT', thresholdValue: 1,
        duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } },
      { displayName: 'No completed sweep for fifteen minutes', conditionAbsent: { filter: heartbeatFilter,
        aggregations: [{ ...aggregate, alignmentPeriod: '300s' }], duration: '900s', trigger: { count: 1 } } }],
    alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
    documentation: { mimeType: 'text/markdown', subject: '[QS Web Push] Activity-sync sender health',
      content: `Verify the minute scheduler, private dueAt collection-group index, runtime, both flags and key pairing. The same worker emits bounded backlog observations and idle/disabled heartbeats; verify an initial metric series after activation because absence cannot bootstrap a never-seen series. Native 5xx covers startup failure. Category cancellation, histories, duplicates, rate limits, account deletion, disconnects and expired registrations are expected, not failures. Batches expire ten minutes after becoming due and are claimed before transport; no resend, dead letter or backlog replay is offered. Do not clear receipts or replay jobs. [Runbook](${runbook})` } });
  for (const [index, title, chartFilter, groups] of [
    [0, 'Activity-sync outcomes — attempts, not display', activityFilter, ['metric.label.outcome', 'metric.label.phase']],
    [1, 'Activity-sync overdue observations — excludes grouping wait', overdueFilter, []],
    [2, 'Activity-sync completed sweeps — includes idle and disabled', heartbeatFilter, []],
  ]) bundle.dashboard.mosaicLayout.tiles.push({ yPos: 16 + index * 4, width: 12, height: 4, widget: {
    title, xyChart: { dataSets: (index === 0 ? [chartFilter, legacyActivityFilter] : [chartFilter]).map(filter => ({ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: {
      filter, aggregation: { ...aggregate, groupByFields: groups } }, unitOverride: '1' } })), yAxis: { label: 'Count', scale: 'LINEAR' } },
  } });
  const deliveryRuntime = runtime.replace('sendtestpushnotification', 'sendactivitydeliverynotifications');
  const deliveryBase = `resource.type="cloud_run_revision" resource.labels.project_id="${project}" resource.labels.location="europe-west2"`;
  const deliveryName = 'qs_activity_delivery_push_outcomes_v1';
  const deliveryHeartbeat = 'qs_activity_delivery_push_sweeps_v1';
  const deliveryOverdue = 'qs_activity_delivery_push_overdue_v1';
  const deliveryFilter = `metric.type="logging.googleapis.com/user/${deliveryName}" ${deliveryBase}`;
  const deliveryHeartbeatFilter = `metric.type="logging.googleapis.com/user/${deliveryHeartbeat}" ${deliveryRuntime}`;
  const deliveryOverdueFilter = `metric.type="logging.googleapis.com/user/${deliveryOverdue}" ${deliveryRuntime}`;
  bundle.metrics.push({ name: deliveryName, description: `[${OWNER}] Activity delivery notification admission and send attempts. Acceptance is not device display.`,
    filter: `${deliveryBase} jsonPayload.message="[ActivityDeliveryPush]" jsonPayload.telemetryVersion=1 jsonPayload.phase=("admission" OR "send" OR "sweep") jsonPayload.outcome=("accepted" OR "expired" OR "failed" OR "cancelled" OR "limited")`,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: ['outcome', 'phase'].map(key => ({ key, valueType: 'STRING', description: `Fixed ${key} category` })) },
    labelExtractors: { outcome: 'EXTRACT(jsonPayload.outcome)', phase: 'EXTRACT(jsonPayload.phase)' } });
  for (const [name, extra] of [[deliveryHeartbeat, ''], [deliveryOverdue, ' jsonPayload.oldestDueAgeSeconds>=180']]) {
    bundle.metrics.push({ name, description: `[${OWNER}] Bounded delivery notification sweep health, including idle/disabled operation.`,
      filter: `${deliveryRuntime} jsonPayload.message="[ActivityDeliveryPushSweep]" jsonPayload.telemetryVersion=1 jsonPayload.oldestDueAgeSeconds>=0${extra}`,
      metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64', unit: '1', labels: [] } });
  }
  bundle.policies.push({ displayName: 'QS Web Push: Activity-delivery sender health', userLabels: { managed_by: OWNER, policy_id: 'delivery-sender' },
    enabled: true, severity: 'WARNING', combiner: 'OR', notificationChannels: channel ? [channel] : [],
    conditions: [failureCondition('Repeated delivery notification admission or send failures', `${deliveryFilter} metric.labels.outcome="failed"`),
      failureCondition('Repeated delivery notification runtime failures', `metric.type="run.googleapis.com/request_count" ${deliveryBase} resource.labels.service_name=one_of("sendactivitydeliverynotifications", "queueactivitysendnotification", "queueautomaticdeliverynotification") metric.labels.response_code_class="5xx"`),
      { displayName: 'Two overdue delivery observations in five minutes', conditionThreshold: { filter: deliveryOverdueFilter,
        aggregations: [{ ...aggregate, alignmentPeriod: '300s' }], comparison: 'COMPARISON_GT', thresholdValue: 1,
        duration: '60s', trigger: { count: 1 }, evaluationMissingData: 'EVALUATION_MISSING_DATA_INACTIVE' } },
      { displayName: 'No completed delivery sweep for fifteen minutes', conditionAbsent: { filter: deliveryHeartbeatFilter,
        aggregations: [{ ...aggregate, alignmentPeriod: '300s' }], duration: '900s', trigger: { count: 1 } } }],
    alertStrategy: { autoClose: '7200s', notificationPrompts: ['OPENED', 'CLOSED'] },
    documentation: { mimeType: 'text/markdown', subject: '[QS Web Push] Activity-delivery sender health',
      content: `Verify the delivery scheduler, deliveryDueAt collection-group index, unconditional switches and key pairing. Confirm an initial heartbeat series after deployment. Category/registration cancellation, disconnect, Stop, duplicates, caps and expired subscriptions are expected. Claims are never replayed after ambiguous sends. Existing activity-delivery monitoring owns provider retries, backlog and dead letters; these alerts concern notifications only. Do not clear receipts or expose identifiers, endpoints or raw errors. [Runbook](${runbook})` } });
  for (const [index, title, filter, groups] of [
    [0, 'Activity-delivery notification outcomes', deliveryFilter, ['metric.label.outcome', 'metric.label.phase']],
    [1, 'Activity-delivery overdue observations', deliveryOverdueFilter, []],
    [2, 'Activity-delivery completed sweeps', deliveryHeartbeatFilter, []],
  ]) bundle.dashboard.mosaicLayout.tiles.push({ yPos: 28 + index * 4, width: 12, height: 4, widget: { title,
    xyChart: { dataSets: [{ plotType: 'LINE', timeSeriesQuery: { timeSeriesFilter: { filter, aggregation: { ...aggregate, groupByFields: groups } }, unitOverride: '1' } }],
      yAxis: { label: 'Count', scale: 'LINEAR' } } } });
  return bundle;
}
